// Проверки документов (§10.10). Тринадцать правил кодом, до показа пользователю.
//
// Уровни: block запрещает ПОКАЗАТЬ текст как результат генерации (сохранить свой
// текст пользователю никто не мешает), warn — замечание рядом с текстом, info —
// подсказка. Семантическая проверка (swap-тест) живёт в воркере: она требует
// вызова модели и потому здесь только принимает результат (`applySwapResult`).
//
// Всё в этом файле — чистые функции: тот же модуль импортируют и воркер, и SPA,
// поэтому счётчик слов на экране и проверка длины на сервере не могут разойтись
// (критерий приёмки 12).

import type {
  ResumeDoc, LetterDoc, CheckResult, Fact, Analysis, OpportunityKind, Profile, Blocker,
} from './types.ts';
import type { PerimetrConfig } from './config.ts';
import { DEFAULT_CONFIG } from './config.ts';
import {
  normalize, words, wordCount, findPhrase, containsPhrase, hasNumber,
  extractNumbers, sentences, paragraphs,
} from './text.ts';

export interface CheckContext {
  cfg?: PerimetrConfig;
  language?: string;
  facts?: Fact[];
  profile?: Profile | null;
  analysis?: Analysis | null;
  opportunity?: { company?: string; signal?: string | null; jd_text?: string | null } | null;
  /** Резюме под это же место — для сверки чисел письма (§10.10). */
  resume?: ResumeDoc | null;
  /**
   * Орфография (§10.10). Словаря в ядре нет и быть не должно: он большой,
   * языкозависимый и обновляется отдельно от логики. Воркер передаёт функцию;
   * без неё правило молча не выполняется, и это видно в отчёте (rule `spelling`
   * со статусом `info` «не проверено»), а не притворяется пройденным.
   */
  spellcheck?: ((text: string, lang: string) => string[]) | null;
}

const ok = (rule: string, message: string): CheckResult => ({ rule, level: 'info', message });

// ── Общие правила ───────────────────────────────────────────────────────────

/** Стоп-лист (Приложение Б). warn за вхождение, block от N вхождений. */
export function checkStoplist(text: string, ctx: CheckContext): CheckResult[] {
  const cfg = ctx.cfg ?? DEFAULT_CONFIG;
  const lang = ctx.language ?? 'en';
  const phrases = cfg.stoplist.phrases[lang] ?? cfg.stoplist.phrases.en ?? [];
  const hits: { phrase: string; at: number }[] = [];
  for (const p of phrases) {
    const at = findPhrase(text, p);
    if (at !== -1) hits.push({ phrase: p, at });
  }
  if (!hits.length) return [];
  const level = hits.length >= cfg.thresholds.stoplistBlockAt ? 'block' : 'warn';
  return hits.map(h => ({
    rule: 'stoplist',
    level: level as CheckResult['level'],
    message: `Фраза из стоп-листа: «${h.phrase}»`,
    locator: { kind: 'offset' as const, value: h.at },
  }));
}

/** Единственный источник: всё, на что ссылается документ, существует и подтверждено. */
export function checkSingleSource(factsUsed: string[] | undefined, ctx: CheckContext): CheckResult[] {
  const bank = new Map((ctx.facts || []).map(f => [f.id, f]));
  const out: CheckResult[] = [];
  for (const id of factsUsed || []) {
    const f = bank.get(id);
    if (!f) {
      out.push({ rule: 'single_source', level: 'block', message: `Факт ${id} не найден в банке фактов` });
    } else if (!f.confirmed) {
      out.push({ rule: 'single_source', level: 'block', message: `Факт «${f.action}» не подтверждён пользователем` });
    }
  }
  return out;
}

function checkSpelling(text: string, ctx: CheckContext): CheckResult[] {
  const lang = ctx.language ?? 'en';
  if (!ctx.spellcheck) {
    return [ok('spelling', 'Орфография не проверена: словарь не подключён')];
  }
  const bad = ctx.spellcheck(text, lang) || [];
  return bad.length
    ? [{ rule: 'spelling', level: 'warn', message: `Возможные опечатки: ${bad.slice(0, 8).join(', ')}` }]
    : [];
}

// ── Резюме ──────────────────────────────────────────────────────────────────

/** Плоский список буллитов в порядке чтения — «верхняя треть» считается по нему. */
export function flatBullets(doc: ResumeDoc): string[] {
  return (doc.experience || []).flatMap(r => r.bullets || []);
}

export function resumeText(doc: ResumeDoc): string {
  return [
    doc.headline,
    ...(doc.summary || []),
    doc.facts_line,
    (doc.competencies || []).join(', '),
    ...(doc.experience || []).flatMap(r => [r.role_title, r.company, r.context_line, ...(r.bullets || [])]),
    ...(doc.education || []),
  ].filter(Boolean).join('\n');
}

export function checkResume(doc: ResumeDoc, ctx: CheckContext = {}): CheckResult[] {
  const cfg = ctx.cfg ?? DEFAULT_CONFIG;
  const th = cfg.thresholds;
  const out: CheckResult[] = [];
  const bullets = flatBullets(doc);
  const text = resumeText(doc);

  out.push(...checkStoplist(text, ctx));
  out.push(...checkSingleSource(doc.facts_used, ctx));

  // Квантификация: доля буллитов с числом.
  if (bullets.length) {
    const withNum = bullets.filter(hasNumber).length;
    const share = withNum / bullets.length;
    if (share < th.quantifiedShare) {
      out.push({
        rule: 'quantification', level: 'warn',
        message: `Буллитов с числом ${Math.round(share * 100)}% — норма от ${Math.round(th.quantifiedShare * 100)}%`,
      });
    }
    // …и не меньше N на роль последних лет.
    const cutoff = new Date().getFullYear() - th.recentRoleYears;
    for (const r of doc.experience || []) {
      if (r.condensed) continue;
      const year = Number(String(r.period_to || r.period_from || '').slice(0, 4));
      if (Number.isFinite(year) && year < cutoff) continue;
      const n = (r.bullets || []).filter(hasNumber).length;
      if (n < th.quantifiedPerRole) {
        out.push({
          rule: 'quantification_per_role', level: 'warn',
          message: `${r.company} · ${r.role_title}: буллитов с числом ${n}, нужно ${th.quantifiedPerRole}`,
        });
      }
    }
    // Буллиты без числа не идут подряд (§10.5, Приложение А п.3).
    for (let i = 1; i < bullets.length; i++) {
      if (!hasNumber(bullets[i]) && !hasNumber(bullets[i - 1])) {
        out.push({
          rule: 'bullets_without_number_adjacent', level: 'info',
          message: 'Два буллита без числа подряд',
          locator: { kind: 'bullet', value: i },
        });
        break;
      }
    }
  }

  // Верхняя треть: первые N буллитов закрывают ожидания веса `must`.
  const mustFactIds = new Set(
    (ctx.analysis?.expectations || [])
      .filter(e => e.weight === 'must' && e.fact_id)
      .map(e => e.fact_id as string),
  );
  if (mustFactIds.size && (doc.facts_used || []).length) {
    const top = (doc.facts_used || []).slice(0, th.topBullets);
    const covered = top.filter(id => mustFactIds.has(id)).length;
    if (covered === 0) {
      out.push({
        rule: 'top_third', level: 'warn',
        message: `Первые ${th.topBullets} буллита не закрывают ни одного ожидания веса must`,
        locator: { kind: 'bullet', value: 0 },
      });
    }
  }

  // Саммари подтверждено буллитами.
  const summary = doc.summary || [];
  if (summary.length) {
    if (summary.length > 3) {
      out.push({ rule: 'summary_length', level: 'warn', message: 'Саммари длиннее трёх строк' });
    }
    const support = doc.summary_support;
    if (!support || support.length !== summary.length) {
      out.push({
        rule: 'summary_supported', level: 'warn',
        message: 'Модель не разметила, какой буллит подтверждает каждое утверждение саммари',
      });
    } else {
      support.forEach((idx, i) => {
        if (idx == null || idx < 0 || idx >= bullets.length) {
          out.push({
            rule: 'summary_supported', level: 'warn',
            message: `Утверждение саммари не подтверждено буллитом: «${summary[i].slice(0, 60)}…»`,
            locator: { kind: 'paragraph', value: i },
          });
        }
      });
    }
  }

  // Строка фактов: право на работу, CEFR, релокация — если заполнены в профиле.
  const p = ctx.profile;
  if (p) {
    const line = normalize(doc.facts_line || '');
    const missing: string[] = [];
    if ((p.work_auth || []).length && !/work|author|permit|виз|прав|tillst/.test(line)) missing.push('право на работу');
    if ((p.languages || []).length && !(p.languages || []).some(l => line.includes(normalize(l.lang)))) missing.push('языки по CEFR');
    if (p.relocation && p.relocation.ready !== 'no' && !/reloc|переезд|релок|flytt/.test(line)) missing.push('готовность к релокации');
    if (p.linkedin_url && !line.includes('linkedin')) missing.push('LinkedIn');
    if (missing.length) {
      out.push({ rule: 'facts_line', level: 'info', message: `В строке фактов не хватает: ${missing.join(', ')}` });
    }
  }

  // Компетенции: без слов из запрещённого списка (§10.5 — «лидерство» показывается фактами).
  const banned = cfg.stoplist.bannedCompetencies[ctx.language ?? 'en'] ?? [];
  for (const c of doc.competencies || []) {
    for (const b of banned) {
      if (containsPhrase(c, b)) {
        out.push({ rule: 'competencies', level: 'warn', message: `В компетенциях слово «${b}» — покажите это результатом в буллите` });
      }
    }
  }
  if ((doc.competencies || []).length && ((doc.competencies || []).length < 6 || (doc.competencies || []).length > 10)) {
    out.push({ rule: 'competencies_count', level: 'info', message: 'Компетенций должно быть 6–10' });
  }

  // Длина: оценка по знакам на страницу.
  const chars = text.length;
  const pages = Math.max(1, Math.ceil(chars / th.charsPerPage));
  if (pages > th.maxResumePages) {
    out.push({ rule: 'length', level: 'warn', message: `Оценка объёма — ${pages} страницы, норма до ${th.maxResumePages}` });
  }

  // Персональные данные вне de_at (§10.5).
  if (doc.format_variant !== 'de_at') {
    // \b в JS определён через \w = [A-Za-z0-9_], поэтому с кириллицей он не
    // срабатывает вовсе. Границу задаём явно через Unicode-свойство буквы.
    const PERSONAL = /(?<!\p{L})(дата рождения|date of birth|born on|födelsedatum|marital status|семейное положение|гражданство|nationality)(?!\p{L})/iu;
    if (PERSONAL.test(text)) {
      out.push({ rule: 'personal_data', level: 'block', message: `Персональные данные недопустимы в формате ${doc.format_variant}` });
    }
  }

  out.push(...checkSpelling(text, ctx));
  return out;
}

// ── Письмо ──────────────────────────────────────────────────────────────────

export function checkLetter(doc: LetterDoc, kind: OpportunityKind, ctx: CheckContext = {}): CheckResult[] {
  const cfg = ctx.cfg ?? DEFAULT_CONFIG;
  const th = cfg.thresholds;
  const out: CheckResult[] = [];
  const body = doc.body || '';

  out.push(...checkStoplist(body, ctx));
  out.push(...checkSingleSource(doc.facts_used, ctx));

  // Длина по ветке.
  const [lo, hi] = kind === 'vacancy' ? th.letterVacancy : th.letterHypothesis;
  const wc = wordCount(body);
  if (wc < lo || wc > hi) {
    out.push({
      rule: 'length', level: 'warn',
      message: `${wc} слов — ветка «${kind === 'vacancy' ? 'сопроводительное' : 'холодное'}» требует ${lo}–${hi}`,
    });
  }

  // Запрещённые начала.
  const first = sentences(body)[0] || '';
  for (const bad of cfg.stoplist.bannedOpenings) {
    if (normalize(first).startsWith(normalize(bad))) {
      out.push({
        rule: 'banned_opening', level: 'warn',
        message: `Шаблонное начало: «${bad}»`,
        locator: { kind: 'paragraph', value: 0 },
      });
      break;
    }
  }

  // Согласованность чисел: каждое число письма встречается в резюме или банке фактов.
  const known = new Set<string>();
  if (ctx.resume) for (const n of extractNumbers(resumeText(ctx.resume))) known.add(n);
  for (const f of ctx.facts || []) {
    if (f.metric_value != null) known.add(String(f.metric_value));
    for (const n of extractNumbers([f.result, f.action, f.how].filter(Boolean).join(' '))) known.add(n);
  }
  const companyText = [ctx.opportunity?.signal, ctx.opportunity?.jd_text].filter(Boolean).join(' ');
  const companyNumbers = new Set(extractNumbers(companyText));
  for (const n of extractNumbers(body)) {
    if (known.has(n) || companyNumbers.has(n)) continue;
    // Год в пределах живой памяти — почти всегда дата сигнала; всё равно требуем источник.
    out.push({
      rule: 'number_consistency', level: 'block',
      message: `Число ${n} есть в письме, но его нет ни в резюме под это место, ни в банке фактов, ни в сигнале`,
    });
  }

  // Факты о компании: именованные сущности письма должны быть в signal / jd_text.
  //
  // Существенная поправка: правило ищет утверждения О КОМПАНИИ, а письмо
  // наполовину состоит из утверждений О КАНДИДАТЕ. «Швеция», «WMS», названия
  // его прежних работодателей приходят из его же опыта, и требовать их наличия
  // в сигнале бессмысленно — так правило превращается в шум и его перестают
  // читать. Поэтому сущность считается объяснённой, если она есть ЛИБО в
  // сигнале и вакансии, ЛИБО в профиле и банке фактов кандидата.
  //
  // Числа проверены выше точно; сущности — приблизительно, поэтому warn, а не
  // block: ложный block прячет годный текст, а это дороже пропущенного замечания.
  if (companyText) {
    const candidateText = [
      ctx.profile?.resume_text, ctx.profile?.extras_text,
      ...(ctx.facts || []).flatMap(f => [f.action, f.how, f.result, f.company, f.role_title]),
      ctx.resume ? resumeText(ctx.resume) : '',
    ].filter(Boolean).join(' ');
    const known = normalize(
      companyText + ' ' + (ctx.opportunity?.company || '') + ' ' + candidateText,
    );
    for (const ent of namedEntities(body)) {
      if (!known.includes(normalize(ent))) {
        out.push({
          rule: 'company_facts', level: 'warn',
          message: `«${ent}» не встречается ни в сигнале и вакансии, ни в вашем профиле — проверьте, откуда это`,
        });
      }
    }
  }

  // Одна просьба (§10.10).
  //
  // ТЗ формулирует правило как «ровно одно вопросительное или побудительное
  // предложение В ПОСЛЕДНЕМ АБЗАЦЕ». Для ветки `hypothesis` это противоречит
  // самому же ТЗ: §10.5a требует, чтобы холодное письмо ЗАКАНЧИВАЛОСЬ указанием,
  // откуда взят контакт, и способом отказаться от дальнейших писем — то есть
  // после просьбы идёт ещё один абзац, и правило «последнего абзаца» ловит
  // отсутствие просьбы там, где она стоит правильно.
  //
  // Считаем по всему письму: требование по существу — «просьба ровно одна»,
  // и локатор показывает, где она найдена. Расхождение с буквой §10.10
  // намеренное и вынесено сюда, а не спрятано.
  const paras = paragraphs(body);
  const asks: { para: number; text: string }[] = [];
  paras.forEach((p, i) => {
    for (const sent of sentences(p)) if (isAsk(sent)) asks.push({ para: i, text: sent });
  });
  if (asks.length !== 1) {
    out.push({
      rule: 'single_ask', level: 'info',
      message: asks.length === 0
        ? 'В письме нет ни одной просьбы — закрывать нужно одной конкретной'
        : `Просьб в письме: ${asks.length}, нужна одна`,
      locator: { kind: 'paragraph', value: asks[0]?.para ?? Math.max(0, paras.length - 1) },
    });
  }

  // Блокер не упомянут (§10.5a): при неснятом блокере письмо его не касается.
  const unresolved = (ctx.analysis?.blockers || []).filter((b: Blocker) => !b.resolved);
  for (const b of unresolved) {
    for (const kw of BLOCKER_KEYWORDS[b.kind] || []) {
      if (containsPhrase(body, kw)) {
        out.push({
          rule: 'blocker_mentioned', level: 'warn',
          message: `Письмо касается неснятого блокера (${b.kind}): «${kw}»`,
        });
        break;
      }
    }
  }

  out.push(...checkSpelling(body, ctx));
  return out;
}

const BLOCKER_KEYWORDS: Record<string, string[]> = {
  work_auth: ['sponsorship', 'visa', 'work permit', 'спонсорство', 'виза', 'разрешение на работу', 'arbetstillstånd'],
  language: ['language', 'fluent', 'язык', 'свободно владею', 'språk'],
  license: ['license', 'certification', 'лицензия', 'сертификат', 'licens'],
  scale: ['scale', 'team size', 'масштаб', 'размер команды'],
  no_people_mgmt: ['managing people', 'people management', 'управление людьми'],
  salary: ['salary', 'compensation', 'зарплат', 'вилка', 'lön'],
};

/** Просьба: вопрос или предложение с маркером обращения. */
function isAsk(sentence: string): boolean {
  if (/\?\s*$/.test(sentence.trim())) return true;
  const n = normalize(sentence);
  return ASK_MARKERS.some(m => n.includes(normalize(m)));
}
const ASK_MARKERS = [
  'let me know', 'would you be open', 'are you open', 'happy to share', 'i can walk you',
  'предлагаю', 'готов обсудить', 'готова обсудить', 'давайте', 'буду признателен', 'буду признательна',
  'hör gärna av dig', 'jag föreslår',
];

/**
 * Приблизительное выделение именованных сущностей: слова с заглавной буквы не в
 * начале предложения, длиннее двух символов. Грубо и намеренно — задача не
 * разметить текст, а поймать «Series B в 2024» и «их платформу Hermes», которых
 * нет в сигнале.
 */
export function namedEntities(text: string): string[] {
  const out = new Set<string>();
  for (const sent of sentences(text)) {
    const toks = sent.split(/\s+/);
    toks.forEach((tok, i) => {
      const clean = tok.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (i === 0 || clean.length < 3) return;
      if (!/^\p{Lu}/u.test(clean)) return;
      if (COMMON_CAPS.has(normalize(clean))) return;
      out.add(clean);
    });
  }
  return [...out];
}
const COMMON_CAPS = new Set([
  'i', 'the', 'a', 'an', 'my', 'your', 'we', 'you', 'it', 'this', 'that',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
]);

// ── Swap-тест (§10.10) — результат приходит из воркера ──────────────────────

export interface SwapResult {
  /** Предложения, потерявшие смысл при подмене компании и роли. */
  broken: string[];
  /** Фразы, похожие на написанные без знания компании. */
  generic: string[];
}

export function applySwapResult(res: SwapResult, cfg: PerimetrConfig = DEFAULT_CONFIG): CheckResult[] {
  const out: CheckResult[] = [];
  const n = (res.broken || []).length;
  if (n < cfg.thresholds.swapMinBroken) {
    out.push({
      rule: 'swap_test', level: 'block',
      message: `Swap-тест: при подмене компании ломается ${n} предложений из ${cfg.thresholds.swapMinBroken} — письмо шаблонное`,
    });
  }
  for (const g of res.generic || []) {
    out.push({ rule: 'swap_generic', level: 'info', message: `Похоже на написанное без знания компании: «${g}»` });
  }
  return out;
}

// ── Свод ────────────────────────────────────────────────────────────────────

export function worstLevel(results: CheckResult[]): 'block' | 'warn' | 'info' | 'ok' {
  if (results.some(r => r.level === 'block')) return 'block';
  if (results.some(r => r.level === 'warn')) return 'warn';
  if (results.some(r => r.level === 'info')) return 'info';
  return 'ok';
}

/** Можно ли показать текст как результат генерации (§10.10). */
export function canPresent(results: CheckResult[]): boolean {
  return !results.some(r => r.level === 'block');
}
