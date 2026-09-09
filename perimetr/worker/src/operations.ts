// AI-операции: сборка контекста, callModel, санитайз, валидация правилами.
// Всё, что можно посчитать без модели, считается без неё.

import {
  type Analysis, type Fact, type Opportunity, type Profile, type PerimetrConfig,
  type Demand, type CheckContext, type FormatVariant,
  sanitizeAnalysis, sanitizeFact, sanitizeIngest, sanitizeResume, sanitizeLetter,
  sanitizeDiscoverItem, computeScore, reconcileBlockers, demoteUnverified,
  sourceHintFound, auditProfile, checkResume, checkLetter, applySwapResult, parseCefr,
} from '@perimetr/core';
import { type Env, ApiError, uid } from './env.ts';
import { callModel, mapWithConcurrency } from './ai.ts';
import { getPrompt, fillPrompt } from './prompts.ts';
import {
  ANALYSE_SCHEMA, AUDIT_SCHEMA, RESUME_SCHEMA, LETTER_SCHEMA,
  INGEST_SCHEMA, DISCOVER_SCHEMA, CLASSIFY_SCHEMA, SWAP_SCHEMA,
} from './schemas.ts';

export interface Ctx {
  env: Env; cfg: PerimetrConfig; prompts: Record<string, string>; userId: string;
}

/**
 * Стабильный префикс промпта: профиль и банк фактов в неизменном порядке.
 * Именно на нём работает кэширование входа со скидкой до 90 процентов (§10.2),
 * поэтому порядок и содержание префикса НЕ зависят от конкретного места.
 */
function stablePrefix(profile: Profile, facts: Fact[]): string {
  const confirmed = facts.filter(f => f.confirmed);
  const full = confirmed.filter(f => f.quantified);
  const compact = confirmed.filter(f => !f.quantified);
  return [
    'Ты работаешь с ОДНИМ кандидатом. Ниже профиль и банк фактов, они не меняются между запросами.',
    '',
    '=== ПРОФИЛЬ ===',
    profile.resume_text,
    profile.extras_text ? 'Свободные сведения: ' + profile.extras_text : '',
    '',
    '=== СТРУКТУРИРОВАННЫЕ ПОЛЯ ===',
    'Масштаб: ' + JSON.stringify(profile.scale ?? {}),
    'Право на работу: ' + JSON.stringify(profile.work_auth ?? []),
    'Языки (CEFR): ' + JSON.stringify(profile.languages ?? []),
    'Релокация: ' + JSON.stringify(profile.relocation ?? {}),
    'Перерывы: ' + JSON.stringify(profile.gaps ?? []),
    '',
    // Селективный дамп (приём twin): важное полностью, остальное строкой.
    '=== БАНК ФАКТОВ (подтверждённые, с числом) ===',
    ...full.map(f => [f.id, f.action, f.how ?? '', f.result ?? '', '[' + f.source_hint + ']'].join(' · ')),
    '',
    '=== БАНК ФАКТОВ (подтверждённые, без числа) ===',
    ...compact.map(f => f.id + ' · ' + f.action),
  ].filter(x => x !== '').join('\n');
}

/**
 * Классификатор (§10.2 в редакции 1.2): дешёвый вызов сужает внимание дорогого.
 * Кэш при этом цел — префикс не меняется, а результат едет СУФФИКСОМ как список
 * указателей, а не как выборка фактов.
 */
async function focusFactIds(ctx: Ctx, facts: Fact[], jd: string): Promise<string[]> {
  const confirmed = facts.filter(f => f.confirmed);
  if (confirmed.length <= 25) return confirmed.map(f => f.id);
  const index = confirmed.map(f => [f.id, f.action, f.role_title ?? ''].join(' · ')).join('\n');
  try {
    const { data } = await callModel<{ fact_ids: string[] }>(ctx.env, ctx.cfg, ctx.userId, {
      operation: 'classify',
      prefix: 'Ты отбираешь релевантные факты. Отвечай только id из предложенного списка.',
      instruction: fillPrompt(getPrompt(ctx.prompts, 'classify'), { FACTS_INDEX: index, JD: jd }),
      schema: CLASSIFY_SCHEMA, temperature: 0, maxOutputTokens: 400,
    });
    const known = new Set(confirmed.map(f => f.id));
    const picked = (data.fact_ids ?? []).filter(id => known.has(id));
    return picked.length ? picked : confirmed.map(f => f.id);
  } catch {
    // Классификатор — оптимизация, а не обязательный шаг: его отказ не должен
    // ронять разбор. Падаем на «рассмотри всё».
    return confirmed.map(f => f.id);
  }
}

// ── Аудит профиля (§10.4a) ──────────────────────────────────────────────────
export async function runAudit(ctx: Ctx, profile: Profile, existing: Fact[]) {
  const { data, model, degraded } = await callModel<{
    facts: unknown[]; roles: unknown[]; questions: { about: string; question: string }[];
    recommendations: string[];
  }>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'audit',
    prefix: 'Ты разбираешь резюме руководителя на атомарные факты. Отвечай строго по схеме.',
    instruction: fillPrompt(getPrompt(ctx.prompts, 'audit'), {
      RESUME: profile.resume_text, EXTRAS: profile.extras_text,
    }),
    schema: AUDIT_SCHEMA, temperature: 0, maxOutputTokens: 6000,
  });

  const haystack = profile.resume_text + '\n' + profile.extras_text;
  const tol = ctx.cfg.thresholds.sourceHintTolerance;
  // Факт без подтверждённой цитаты отбрасывается МОЛЧА (§10.4a).
  const facts = (data.facts ?? [])
    .map(raw => sanitizeFact(raw, uid))
    .filter((f): f is Fact => f !== null && sourceHintFound(haystack, f.source_hint, tol));

  // Ранее подтверждённые факты переживают повторный аудит.
  const confirmedBefore = new Map(existing.filter(f => f.confirmed).map(f => [f.source_hint, f]));
  const merged = facts.map(f => {
    const prev = confirmedBefore.get(f.source_hint);
    return prev ? { ...f, id: prev.id, confirmed: true } : f;
  });

  const roles = (data.roles ?? []).map(r => {
    const o = r as Record<string, unknown>;
    return {
      company: String(o.company ?? ''), role_title: String(o.role_title ?? ''),
      from: String(o.from ?? ''), to: String(o.to ?? '') || null,
    };
  }).filter(r => r.from);

  const withRoles: Profile = { ...profile, roles: roles.length ? roles : profile.roles };
  const report = auditProfile(withRoles, merged, ctx.cfg.thresholds);
  return {
    facts: merged, roles, model, degraded,
    report: { ...report, questions: data.questions ?? [], recommendations: data.recommendations ?? [] },
  };
}

// ── Разбор (§10.4) ──────────────────────────────────────────────────────────
export async function runAnalyse(
  ctx: Ctx, profile: Profile, facts: Fact[], opp: Opportunity, demand: Demand,
): Promise<{ analysis: Analysis; model: string; degraded: boolean }> {
  const jd = opp.jd_text ?? '';
  const focus = await focusFactIds(ctx, facts, jd || (opp.role_title + ' @ ' + opp.company));

  const branch = jd
    ? 'У тебя ЕСТЬ текст вакансии. Ожидания ИЗВЛЕКАЙ из него и ранжируй по важности. Догадки запрещены: чего нет в тексте, того нет в ожиданиях.'
    : 'Текста вакансии НЕТ. Реконструируй ожидания по роли, отрасли, размеру компании и сигналу, и поставь reconstructed: true.';

  const location = [opp.city, opp.country].filter(Boolean).join(', ');
  const { data, model, degraded } = await callModel<Analysis>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'analyse',
    prefix: stablePrefix(profile, facts),
    instruction: fillPrompt(getPrompt(ctx.prompts, 'analyse'), {
      JD_BRANCH: branch,
      OPPORTUNITY: [
        'Компания: ' + opp.company,
        'Роль: ' + opp.role_title,
        opp.industry ? 'Отрасль: ' + opp.industry : '',
        location ? 'Локация: ' + location : '',
        opp.size ? 'Размер: ' + opp.size : '',
        opp.signal ? 'Сигнал: ' + opp.signal : '',
      ].filter(Boolean).join('\n'),
      JD: jd ? '=== ТЕКСТ ВАКАНСИИ ===\n' + jd : '',
      FOCUS: focus.join(', '),
    }),
    schema: ANALYSE_SCHEMA, temperature: 0.2, maxOutputTokens: 4000,
  });

  const analysis = sanitizeAnalysis(data);
  analysis.reconstructed = !jd;

  // Антигаллюцинация (§10.4): непроверенная цитата понижает ожидание до gap.
  const byId = new Map(facts.map(f => [f.id, f]));
  analysis.expectations = demoteUnverified(analysis.expectations, (hint, factId) => {
    if (factId) {
      const f = byId.get(factId);
      if (f && f.confirmed) return true;
    }
    return sourceHintFound(haystackOf(profile), hint, ctx.cfg.thresholds.sourceHintTolerance);
  });

  // Правила главнее модели.
  analysis.blockers = reconcileBlockers(analysis.blockers, demand, profile, ctx.cfg.thresholds);
  analysis.score = computeScore(analysis.expectations);
  return { analysis, model, degraded };
}

const haystackOf = (p: Profile) => p.resume_text + '\n' + p.extras_text;

// ── Ingest (§10.8) ──────────────────────────────────────────────────────────
const UA = 'PerimetrBot/1.0 (+https://perimetr.app/about)';

const blockedMessage = () =>
  'Страница закрыта для загрузки: так делают LinkedIn, Indeed и часть корпоративных ATS. '
  + 'Откройте её в браузере, скопируйте текст вакансии и вставьте во второе поле.';

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export async function fetchJobPage(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctrl.signal });
    if ([401, 403, 429].includes(res.status)) throw new ApiError('jd_fetch_blocked', blockedMessage(), 422);
    if (!res.ok) throw new ApiError('jd_fetch_failed', 'Страница не открылась. Вставьте текст вакансии.', 422);
    const raw = (await res.text()).slice(0, 2 * 1024 * 1024);
    const text = htmlToText(raw);
    if (text.length < 400) throw new ApiError('jd_fetch_blocked', blockedMessage(), 422);
    return text;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('jd_fetch_blocked', blockedMessage(), 422);
  } finally {
    clearTimeout(timer);
  }
}

/** Требования места для правил блокеров (§10.4). Извлекаются один раз при ingest. */
export function demandFromIngest(raw: Record<string, unknown>, country: string): Demand {
  const d = (raw.demand ?? {}) as Record<string, unknown>;
  const langRaw = String(d.language_required ?? '');
  const cefr = parseCefr(langRaw);
  const langName = langRaw.replace(/[A-C][12]/gi, '').replace(/[-]/g, ' ').trim();
  return {
    country: country || null,
    language: langName ? { lang: langName, min: cefr ?? 'C1', mandatory: d.language_mandatory === true } : null,
    sponsorship_offered: typeof d.sponsorship_offered === 'boolean' ? d.sponsorship_offered : null,
    scale: (d.team_size || d.budget)
      ? { team: (d.team_size as number) ?? null, budget: (d.budget as number) ?? null }
      : null,
    manages_managers: d.manages_managers === true,
    lead_without_authority: d.lead_without_authority === true,
    license: d.license_required ? { name: String(d.license_required), mandatory: d.license_mandatory === true } : null,
    salary_max: (d.salary_max as number) ?? null,
  };
}

export async function runIngest(ctx: Ctx, text: string) {
  const { data, model } = await callModel<Record<string, unknown>>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'ingest',
    prefix: 'Ты извлекаешь структуру вакансии из текста. Пустая строка вместо догадки.',
    instruction: fillPrompt(getPrompt(ctx.prompts, 'ingest'), { TEXT: text.slice(0, 30_000) }),
    schema: INGEST_SCHEMA, temperature: 0, maxOutputTokens: 2500,
  });
  const parsed = sanitizeIngest(data, text);
  return { parsed, demand: demandFromIngest(data, parsed.country), jd_text: text, model };
}

// ── Документы (§10.5, §10.5a, §10.10) ───────────────────────────────────────
const FORMAT_BY_COUNTRY: Record<string, FormatVariant> = {
  'united kingdom': 'uk_ie', uk: 'uk_ie', ireland: 'uk_ie', ирландия: 'uk_ie', великобритания: 'uk_ie',
  sweden: 'nordic_nl', norway: 'nordic_nl', denmark: 'nordic_nl', finland: 'nordic_nl',
  netherlands: 'nordic_nl', швеция: 'nordic_nl', нидерланды: 'nordic_nl',
  germany: 'de_at', austria: 'de_at', switzerland: 'de_at', германия: 'de_at', австрия: 'de_at',
};

export function formatForCountry(country?: string | null): FormatVariant {
  return FORMAT_BY_COUNTRY[String(country ?? '').toLowerCase().trim()] ?? 'intl';
}

function formatRules(v: FormatVariant): string {
  const rules: Record<FormatVariant, string> = {
    intl: 'Международный формат: без фото, без даты рождения, семейного положения и гражданства.',
    uk_ie: 'UK и Ирландия: без фото и личных данных (антидискриминационная практика), две страницы это норма.',
    nordic_nl: 'Скандинавия и Нидерланды: без фото, допустима короткая строка о личном.',
    de_at: 'DACH: фото уместно, дата и место рождения только с явного согласия пользователя.',
    europass: 'Структура Europass.',
  };
  return rules[v] + ' Одна колонка, стандартные заголовки, без таблиц, текстбоксов, иконок и шкал навыков.';
}

function documentLanguage(opp: Opportunity): string {
  const c = String(opp.country ?? '').toLowerCase();
  if (/sweden|швеция|sverige/.test(c)) return 'sv';
  if (/russia|россия/.test(c)) return 'ru';
  return 'en';
}

export async function runResume(
  ctx: Ctx, profile: Profile, facts: Fact[], opp: Opportunity, analysis: Analysis,
  opts: { format_variant?: FormatVariant; pages?: 1 | 2 } = {},
) {
  const variant = opts.format_variant ?? formatForCountry(opp.country);
  const pages = opts.pages ?? ((profile.years_exp ?? 0) >= ctx.cfg.thresholds.twoPageYears ? 2 : 1);
  const lang = documentLanguage(opp);
  const where = [opp.city, opp.country].filter(Boolean).join(', ');

  const { data, model, degraded } = await callModel<Record<string, unknown>>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'resume',
    prefix: stablePrefix(profile, facts),
    instruction: fillPrompt(getPrompt(ctx.prompts, 'resume'), {
      OPPORTUNITY: [opp.company, opp.role_title, where].filter(Boolean).join(' · '),
      EXPECTATIONS: analysis.expectations
        .map(e => '[' + e.weight + '] ' + e.expectation + ' -> ' + e.evidence).join('\n'),
      FORMAT: formatRules(variant), PAGES: pages, LANG: lang,
    }),
    schema: RESUME_SCHEMA, temperature: 0.2, maxOutputTokens: 5000,
  });

  const doc = sanitizeResume({ ...data, format_variant: variant, language: lang }, variant);
  const checks = checkResume(doc, { cfg: ctx.cfg, language: lang, facts, profile, analysis });
  return { doc, checks, model, degraded };
}

export async function runLetter(
  ctx: Ctx, profile: Profile, facts: Fact[], opp: Opportunity, analysis: Analysis,
  opts: { tone?: 'neutral' | 'direct' | 'warm' } = {},
) {
  const isVacancy = opp.kind === 'vacancy';
  const range = isVacancy ? ctx.cfg.thresholds.letterVacancy : ctx.cfg.thresholds.letterHypothesis;
  const lang = documentLanguage(opp);
  const softest = analysis.expectations.find(e => e.gap_class === 'soft' && e.bridge);

  const branch = isVacancy
    ? 'Напиши СОПРОВОДИТЕЛЬНОЕ письмо, пять блоков в фиксированном порядке: (1) крючок с конкретикой компании и релевантным фактом с числом; (2) 2-3 достижения под ожидания веса must, формулировки отличаются от резюме, числа совпадают; (3) мост, закрывающий главный мягкий гэп, без оправданий; (4) почему эта компания и почему сейчас, сюда встраивается ответ на возражение; (5) спокойный клоуз с одной конкретной просьбой.'
    : 'Напиши ХОЛОДНОЕ первое письмо руководителю: наблюдение о компании, видимое снаружи, с датой сигнала; затем проблема, которую такое событие обычно порождает, и факт кандидата с числом, доказывающий, что он её решал; затем предложение короткого разговора. Роль можно назвать как ещё не существующую. В конце укажи, откуда взят контакт и как отказаться от дальнейших писем. Пересказ резюме, список компетенций и вложения запрещены.';

  const channelLine = opp.channel === 'cold'
    ? 'холодная подача'
    : (opp.channel === 'referral' ? 'referral' : 'тёплый контакт')
      + '; представляет: ' + (opp.referral_name ?? '') + ' — назови его в ПЕРВОМ предложении';

  const { data, model, degraded } = await callModel<Record<string, unknown>>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'letter',
    prefix: stablePrefix(profile, facts),
    instruction: fillPrompt(getPrompt(ctx.prompts, 'letter'), {
      BRANCH: branch,
      OPPORTUNITY: [
        opp.company + ' · ' + opp.role_title,
        opp.signal ? 'Сигнал: ' + opp.signal : '',
        opp.jd_text ? 'Из вакансии: ' + opp.jd_text.slice(0, 4000) : '',
      ].filter(Boolean).join('\n'),
      EXPECTATIONS: analysis.expectations.filter(e => e.weight === 'must')
        .map(e => e.expectation + ' -> ' + e.evidence).join('\n'),
      BRIDGE: softest ? softest.bridge + ': ' + softest.gap_answer : 'мягких гэпов нет, дай абзац о масштабе или траектории',
      OBJECTION: analysis.objection ? analysis.objection.risk + ' -> ' + analysis.objection.answer : '',
      CHANNEL: channelLine,
      TONE: opts.tone ?? 'neutral',
      WORDS: range[0] + '-' + range[1],
      LANG: lang,
    }),
    schema: LETTER_SCHEMA, temperature: 0.4, maxOutputTokens: 1600,
  });

  const doc = sanitizeLetter({ ...data, language: lang });
  const checkCtx: CheckContext = {
    cfg: ctx.cfg, language: lang, facts, profile, analysis,
    opportunity: { company: opp.company, signal: opp.signal, jd_text: opp.jd_text },
  };
  const checks = checkLetter(doc, opp.kind, checkCtx);
  return { doc, checks, model, degraded };
}

/** Swap-тест (§10.10): подмену делает КОД, вопрос задаётся модели. */
export async function runSwapTest(ctx: Ctx, body: string, opp: Opportunity) {
  let swapped = body.split(opp.company).join('Vertigo Systems').split(opp.role_title).join('Head of Widgets');
  if (opp.contact_name) swapped = swapped.split(opp.contact_name).join('Alex Doe');
  const { data } = await callModel<{ broken: string[]; generic: string[] }>(ctx.env, ctx.cfg, ctx.userId, {
    operation: 'check',
    prefix: 'Ты проверяешь письмо на шаблонность. Отвечай строго по схеме.',
    instruction: fillPrompt(getPrompt(ctx.prompts, 'check'), { LETTER: swapped }),
    schema: SWAP_SCHEMA, temperature: 0, maxOutputTokens: 800,
  });
  return applySwapResult({ broken: data.broken ?? [], generic: data.generic ?? [] }, ctx.cfg);
}

// ── Discover (§10.3, §9.1) ──────────────────────────────────────────────────
function splitPerimeter(perimeter: string, max: number): string[] {
  const parts = String(perimeter || '').split(/[;\n]/).map(s => s.trim()).filter(Boolean);
  return parts.length ? parts.slice(0, max) : [perimeter || 'подходящие руководящие роли'];
}

export async function runDiscover(ctx: Ctx, profile: Profile, known: string[], count = 8) {
  // Запросы идут ПУЛОМ, а не последовательно: §14 требует p95 < 180 с, и
  // последовательный обход шести веб-запросов в него не укладывается (§4.3.3).
  const angles = splitPerimeter(profile.perimeter, ctx.cfg.models.maxConcurrency * 2);
  const perAngle = Math.ceil(count / angles.length) + 1;
  const batches = await mapWithConcurrency(angles, ctx.cfg.models.maxConcurrency, async angle => {
    try {
      const { data } = await callModel<{ items: unknown[] }>(ctx.env, ctx.cfg, ctx.userId, {
        operation: 'discover',
        prefix: 'Кандидат ищет работу. Профиль: ' + profile.resume_text.slice(0, 6000),
        instruction: fillPrompt(getPrompt(ctx.prompts, 'discover'), {
          PERIMETER: angle, GEO: profile.geo, EXCLUDE: profile.exclude,
          KNOWN: known.join(', '), BREADTH: profile.breadth, COUNT: perAngle,
        }),
        schema: DISCOVER_SCHEMA, temperature: 0.5, maxOutputTokens: 4000, webSearch: true,
      });
      return data.items ?? [];
    } catch {
      return [];    // один неудачный угол не роняет прогон целиком
    }
  });
  return batches.flat().map(sanitizeDiscoverItem).filter(Boolean);
}
