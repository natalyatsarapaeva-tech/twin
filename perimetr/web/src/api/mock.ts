// Демо-режим: работает без Google, D1 и OpenAI, чтобы интерфейс можно было
// открыть и посмотреть.
//
// Важное свойство: подделаны ТОЛЬКО модель и база. Аудит профиля, совпадение,
// блокеры и проверки документов считает настоящее ядро @perimetr/core — то же,
// что в воркере. Поэтому демо не врёт: если снять блокер языка, он снимется по
// настоящему правилу, а не по заранее записанному ответу.

import {
  auditProfile, computeScore, coverage, checkLetter, checkResume,
  evaluateGaps, reanalyseAfterProfileChange, checkBudget, findDuplicate, companyKey,
  type Demand,
} from '@perimetr/core';
import type {
  Api, Profile, Fact, Opportunity, Analysis, OpportunityDetail,
  DocumentRecord, ImportResult, ParsedJob, RunState, UsageSummary, Me,
} from './types.ts';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Демо-кандидат ───────────────────────────────────────────────────────────
const RESUME = `Мария Ковалёва — VP Operations / Head of Supply Chain

Nordic Freight Group, Стокгольм — Head of Operations, 2021 — н.в.
Отвечаю за операции в Швеции, Дании и Финляндии. Вырастила операционную команду
с 8 до 25 человек, из них 4 менеджера, бюджет 4,2 млн EUR.
Сократила срок поставки на 40% за два квартала, перестроив планирование между
площадками. Вывела складскую сеть на единый WMS, экономия 620 тыс. EUR в год.
Удержала команду при реорганизации 2023 года: ушёл один человек из 25.

Baltic Logistics, Рига — Operations Manager, 2017 — 2021
Команда 8 человек. Запустила две новые площадки, вышли на плановый объём
за 5 месяцев вместо 9. Снизила долю просроченных отгрузок с 12% до 3%.

Kesko, Хельсинки — Supply Chain Analyst, 2014 — 2017
Аналитика S&OP. Построила модель прогноза спроса, точность выросла на 18%.

Образование: MSc Industrial Engineering, KTH, 2014.`;

const EXTRAS = `Выросла четверых менеджеров из специалистов — двое сейчас руководят
своими направлениями. Перерыв 2020–2021 — учёба, программа Executive в SSE.
Готова к релокации внутри ЕС, релокационный пакет не нужен.`;

let profile: Profile = {
  resume_text: RESUME,
  extras_text: EXTRAS,
  perimeter: 'VP Operations; Head of Supply Chain; Director of Logistics',
  industries: 'логистика, ритейл, производство',
  exclude: 'консалтинг, агентства',
  geo: 'Sweden, Germany',
  breadth: 'medium',
  languages: [{ lang: 'Russian', cefr: 'C2' }, { lang: 'English', cefr: 'C1' }, { lang: 'Swedish', cefr: 'B1' }],
  work_auth: [{ region: 'Sweden', status: 'permit' }, { region: 'EU', status: 'permit' }],
  relocation: { ready: 'yes', package_needed: false },
  scale: { team_max: 25, managers_max: 4, budget_max: 4_200_000, pnl: false, geo_scope: '3 страны', users_or_clients: '' },
  years_exp: 12,
  gaps: [{ from: '2020-02-01', to: '2021-01-01', reason: 'учёба, Executive-программа SSE' }],
  salary_range: '',
  linkedin_url: 'https://linkedin.com/in/mkovaleva',
  linkedin_complete: false,
  photo_policy: 'auto',
  roles: [
    { company: 'Nordic Freight Group', role_title: 'Head of Operations', from: '2021-02-01', to: null },
    { company: 'Baltic Logistics', role_title: 'Operations Manager', from: '2017-01-01', to: '2021-01-01' },
    { company: 'Kesko', role_title: 'Supply Chain Analyst', from: '2014-06-01', to: '2017-01-01' },
  ],
};

const f = (
  id: string, action: string, result: string, metric: number | null, unit: string,
  role: string, tags: Fact['scale_tags'], hint: string, confirmed = true,
): Fact => ({
  id, action, result, metric_value: metric, metric_unit: unit, role_title: role,
  scale_tags: tags, domain_tags: ['logistics'], quantified: metric != null,
  source_hint: hint, confirmed, how: '',
});

let facts: Fact[] = [
  f('f1', 'Вырастила операционную команду', 'с 8 до 25 человек, 4 менеджера', 25, 'человек', 'Head of Operations', ['team', 'managers'], 'команду с 8 до 25 человек'),
  f('f2', 'Сократила срок поставки', 'на 40% за два квартала', 40, '%', 'Head of Operations', [], 'срок поставки на 40%'),
  f('f3', 'Вывела складскую сеть на единый WMS', 'экономия 620 тыс. EUR в год', 620000, 'EUR', 'Head of Operations', ['budget'], 'единый WMS, экономия 620'),
  f('f4', 'Удержала команду при реорганизации', 'ушёл 1 человек из 25', 1, 'человек', 'Head of Operations', ['team'], 'ушёл один человек из 25'),
  f('f5', 'Запустила две новые площадки', 'плановый объём за 5 месяцев вместо 9', 5, 'месяцев', 'Operations Manager', [], 'плановый объём за 5 месяцев'),
  f('f6', 'Снизила долю просроченных отгрузок', 'с 12% до 3%', 3, '%', 'Operations Manager', [], 'просроченных отгрузок с 12% до 3%'),
  f('f7', 'Построила модель прогноза спроса', 'точность выросла на 18%', 18, '%', 'Supply Chain Analyst', [], 'точность выросла на 18%'),
  f('f8', 'Вырастила четверых менеджеров из специалистов', 'двое руководят своими направлениями', 4, 'менеджера', 'Head of Operations', ['managers'], 'четверых менеджеров из специалистов'),
  f('f9', 'Отвечала за операции в трёх странах', 'Швеция, Дания, Финляндия', null, '', 'Head of Operations', ['geo'], 'операции в Швеции, Дании и Финляндии'),
];

// ── Демо-места ──────────────────────────────────────────────────────────────
const opp = (o: Partial<Opportunity> & { id: string; company: string; role_title: string }): Opportunity => ({
  company_key: companyKey(o.company), kind: 'vacancy', origin: 'discovered',
  status: 'new', channel: 'cold', updated_at: new Date().toISOString(), ...o,
} as Opportunity);

let opportunities: Opportunity[] = [
  opp({
    id: 'o1', company: 'Instabox', role_title: 'VP Operations', industry: 'логистика последней мили',
    city: 'Стокгольм', country: 'Sweden', size: '900+', kind: 'vacancy', status: 'analysed', score: 78,
    source_url: 'https://example.com/jobs/instabox-vp-ops',
    jd_text: 'We are looking for a VP Operations to lead our Nordic operations...',
    signal: 'Расширение в Данию, объявлено в июне 2026',
  }),
  opp({
    id: 'o2', company: 'Zalando Logistics SE', role_title: 'Director of Fulfilment', industry: 'e-commerce',
    city: 'Берлин', country: 'Germany', size: '5000+', kind: 'vacancy', status: 'analysed', score: 64,
    source_url: 'https://example.com/jobs/zalando-dir-fulfilment',
    jd_text: 'Fließend Deutsch erforderlich. Verantwortung für ein Team von 60 Mitarbeitenden...',
    signal: 'Новый распределительный центр под Лейпцигом, август 2026',
  }),
  opp({
    id: 'o3', company: 'Polarbröd', role_title: 'Head of Supply Chain', industry: 'производство продуктов',
    city: 'Умео', country: 'Sweden', size: '400', kind: 'hypothesis', status: 'new',
    source_url: 'https://example.com/news/polarbrod-expansion',
    source_date: '2026-07-14',
    signal: 'Запуск второй линии после пожара на основном заводе, июль 2026 — операционка обычно не успевает за производством',
  }),
  opp({
    id: 'o4', company: 'Budbee', role_title: 'Head of Network Operations', industry: 'доставка',
    city: 'Стокгольм', country: 'Sweden', size: '600', kind: 'hypothesis', status: 'new',
    source_url: 'https://example.com/news/budbee-series-c',
    source_date: '2026-05-22',
    signal: 'Раунд Series C в мае 2026, заявлен выход на три новых рынка',
  }),
  opp({
    id: 'o5', company: 'Oda', role_title: 'VP Supply Chain', industry: 'онлайн-продукты',
    city: 'Осло', country: 'Norway', size: '1200', kind: 'vacancy', status: 'new',
    source_url: 'https://example.com/jobs/oda-vp-sc',
    signal: 'Реорганизация цепочки поставок после смены CEO, апрель 2026',
  }),
];

// Требования мест — то, что в проде извлекает ingest (§10.8) и хранит воркер.
const demands: Record<string, Demand> = {
  o1: { country: 'Sweden', scale: { team: 40 }, manages_managers: true },
  // Зато вот здесь — настоящий жёсткий блокер: немецкий обязателен, у неё его нет.
  o2: {
    country: 'Germany', manages_managers: true, scale: { team: 60 },
    language: { lang: 'German', min: 'C1', mandatory: true },
  },
  o3: { country: 'Sweden', scale: { team: 15 } },
  o4: { country: 'Sweden', scale: { team: 30 }, manages_managers: true },
  o5: { country: 'Norway', scale: { team: 45 }, manages_managers: true },
};

const exp = (
  expectation: string, weight: 'must' | 'important' | 'nice', evidence: string,
  fact_id: string | null, hint: string, strength: 'strong' | 'partial' | 'gap',
  gap: 'hard' | 'soft' | null = null, bridge: Analysis['expectations'][0]['bridge'] = null, answer = '',
) => ({ expectation, weight, evidence, fact_id, source_hint: hint, strength, gap_class: gap, bridge, gap_answer: answer });

const analyses: Record<string, Analysis> = {
  o1: {
    expectations: [
      exp('Управление операциями в нескольких скандинавских странах', 'must', 'Операции в Швеции, Дании и Финляндии в Nordic Freight', 'f9', 'операции в Швеции, Дании и Финляндии', 'strong'),
      exp('Команда от 40 человек с менеджерами в подчинении', 'must', 'Команда 25 человек, 4 менеджера', 'f1', 'команду с 8 до 25 человек', 'partial', 'soft', 'trajectory', 'Рост команды втрое за три года и управление менеджерами, а не только специалистами'),
      exp('Сокращение операционных издержек с измеримым результатом', 'must', 'Единый WMS, экономия 620 тыс. EUR в год', 'f3', 'единый WMS, экономия 620', 'strong'),
      exp('Опыт быстрого масштабирования сети', 'important', 'Две площадки на плановый объём за 5 месяцев вместо 9', 'f5', 'плановый объём за 5 месяцев', 'strong'),
      exp('Шведский язык на рабочем уровне', 'important', 'Swedish B1', null, '', 'partial', 'soft', 'analogous_tools', 'B1 и рабочий английский; в Nordic Freight операционные встречи шли на английском'),
      exp('Опыт в last-mile', 'nice', 'Опыт в грузовой логистике, не в последней миле', null, '', 'gap', 'soft', 'transferable_metrics', 'Метрики срока и просрочки читаются одинаково в обеих моделях'),
    ],
    blockers: [], score: 0,
    uvp: 'Единственный кандидат с подтверждённым опытом одновременного управления операциями в трёх скандинавских странах и доказанным сокращением срока поставки на 40% — ровно та задача, которая возникает при выходе в Данию.',
    objection: { risk: 'Не потянет масштаб: у нас 40+ человек, у неё 25', answer: 'Команда выросла с 8 до 25 под её управлением, и в ней уже четыре менеджера — это управление руководителями, а не специалистами' },
    reconstructed: false,
  },
  o2: {
    expectations: [
      exp('Свободный немецкий', 'must', 'Немецкий в профиле отсутствует', null, '', 'gap', 'hard'),
      exp('Управление командой от 60 человек', 'must', 'Команда 25 человек, 4 менеджера', 'f1', 'команду с 8 до 25 человек', 'partial', 'soft', 'trajectory', 'Траектория роста команды и управление менеджерами'),
      exp('Опыт e-commerce fulfilment', 'must', 'Опыт грузовой и складской логистики', 'f3', 'единый WMS, экономия 620', 'partial', 'soft', 'transferable_metrics', 'Метрики WMS и срока переносятся между моделями'),
      exp('Оптимизация складских процессов', 'important', 'Единый WMS, экономия 620 тыс. EUR в год', 'f3', 'единый WMS, экономия 620', 'strong'),
      exp('Работа в матричной структуре', 'nice', 'Три страны, четыре менеджера', 'f8', 'четверых менеджеров из специалистов', 'strong'),
    ],
    blockers: [], score: 0,
    uvp: 'Складская трансформация с подтверждённой экономией 620 тыс. EUR в год и опыт запуска площадок вдвое быстрее плана.',
    objection: { risk: 'Язык: без немецкого не сможет работать со складским персоналом', answer: '' },
    reconstructed: false,
  },
};

// Блокеры считает НАСТОЯЩЕЕ правило ядра, а не заранее записанный ответ.
function withBlockers(id: string, a: Analysis): Analysis {
  const next = reanalyseAfterProfileChange(a, demands[id] ?? {}, profile);
  return { ...next, score: computeScore(next.expectations) };
}

let documents: Record<string, DocumentRecord[]> = {};

const usageLog = [
  { operation: 'audit' as const, model: 'gpt-5.6-sol', tokens_in: 12000, tokens_out: 3100, tool_calls: 0, cost_usd: 0.11, ok: true, created_at: new Date(Date.now() - 5 * 864e5).toISOString() },
  { operation: 'discover' as const, model: 'gpt-5.6-terra', tokens_in: 22000, tokens_out: 4200, tool_calls: 6, cost_usd: 0.16, ok: true, created_at: new Date(Date.now() - 4 * 864e5).toISOString() },
  { operation: 'analyse' as const, model: 'gpt-5.6-sol', tokens_in: 18000, tokens_out: 2200, tool_calls: 0, cost_usd: 0.036, ok: true, created_at: new Date(Date.now() - 3 * 864e5).toISOString() },
  { operation: 'analyse' as const, model: 'gpt-5.6-sol', tokens_in: 17500, tokens_out: 2100, tool_calls: 0, cost_usd: 0.034, ok: true, created_at: new Date(Date.now() - 2 * 864e5).toISOString() },
  { operation: 'letter' as const, model: 'gpt-5.6-terra', tokens_in: 9000, tokens_out: 700, tool_calls: 0, cost_usd: 0.011, ok: true, created_at: new Date(Date.now() - 864e5).toISOString() },
  { operation: 'letter' as const, model: 'gpt-5.6-terra', tokens_in: 0, tokens_out: 0, tool_calls: 0, cost_usd: 0, ok: false, created_at: new Date(Date.now() - 3600e3).toISOString() },
];

let runs: Record<string, RunState> = {};

export const mockApi: Api = {
  async me(): Promise<Me> {
    await delay(120);
    return {
      user: { email: 'maria@example.com', name: 'Мария Ковалёва' },
      profile_filled: profile.resume_text.trim().length > 0,
      spreadsheet_url: 'https://docs.google.com/spreadsheets/d/demo',
      reauth_required: false,
    };
  },

  async getProfile() {
    await delay(140);
    return { profile, audit: auditProfile(profile, facts), facts };
  },

  async saveProfile(patch) {
    await delay(200);
    profile = { ...profile, ...patch };
    return { profile, audit: auditProfile(profile, facts) };
  },

  async runAudit() {
    await delay(1500);   // аудит в проде идёт до минуты — этап должен быть видно
    return { audit: auditProfile(profile, facts), facts };
  },

  async patchFact(id, patch) {
    await delay(90);
    facts = facts.map(x => (x.id === id ? { ...x, ...patch } : x));
  },

  async deleteFact(id) {
    await delay(90);
    facts = facts.filter(x => x.id !== id);
  },

  async listOpportunities() {
    await delay(160);
    return opportunities.filter(o => o.status !== 'archived').map(o => {
      const a = analyses[o.id];
      return a ? { ...o, score: withBlockers(o.id, a).score } : o;
    });
  },

  async getOpportunity(id): Promise<OpportunityDetail> {
    await delay(180);
    const o = opportunities.find(x => x.id === id)!;
    const raw = analyses[id];
    const analysis = raw ? withBlockers(id, raw) : null;
    return {
      opportunity: o, analysis, documents: documents[id] ?? [],
      coverage: analysis ? coverage(analysis.expectations) : null,
    };
  },

  async patchOpportunity(id, patch) {
    await delay(120);
    opportunities = opportunities.map(o => (o.id === id ? { ...o, ...patch, updated_at: new Date().toISOString() } : o));
    const raw = analyses[id];
    return raw ? { analysis: withBlockers(id, raw) } : {};
  },

  async archiveOpportunity(id) {
    await delay(120);
    opportunities = opportunities.map(o => (o.id === id ? { ...o, status: 'archived' } : o));
  },

  async importJob(input): Promise<ImportResult> {
    await delay(1200);
    if (input.url && !input.text) {
      // Ровно то, что делают LinkedIn и Indeed (§10.8) — ветка не аварийная.
      if (/linkedin|indeed/i.test(input.url)) {
        throw Object.assign(new Error(
          'Страница закрыта для загрузки: так делают LinkedIn, Indeed и часть корпоративных ATS. '
          + 'Откройте её в браузере, скопируйте текст вакансии и вставьте во второе поле.'), { code: 'jd_fetch_blocked' });
      }
    }
    const text = input.text ?? 'Head of Logistics, Stockholm. We are looking for an experienced operations leader...';
    const parsed: ParsedJob = {
      company: 'Apotea', role_title: 'Head of Logistics', city: 'Стокгольм', country: 'Sweden',
      industry: 'e-commerce', size: '1000+', language: 'sv', seniority: 'Head',
      requirements: ['Опыт управления складом от 30 человек', 'Шведский на рабочем уровне', 'WMS'],
      responsibilities: ['Складские операции', 'Планирование сети'],
      contact_email: '', salary: '', posted_date: '2026-09-01',
      confidence: 'high', is_job_posting: true,
    };
    const dup = findDuplicate({ company: parsed.company, role_title: parsed.role_title },
      opportunities.map(o => ({ id: o.id, company_key: o.company_key, role_title: o.role_title })));
    return { parsed, jd_text: text, duplicate_of: dup, source_url: input.url ?? null };
  },

  async confirmImport(r) {
    await delay(300);
    const id = 'o' + (opportunities.length + 1);
    opportunities = [opp({
      id, company: r.parsed.company, role_title: r.parsed.role_title,
      city: r.parsed.city, country: r.parsed.country, industry: r.parsed.industry,
      size: r.parsed.size, kind: 'vacancy', origin: r.source_url ? 'manual_url' : 'manual_text',
      jd_text: r.jd_text, source_url: r.source_url ?? undefined, status: 'new',
    }), ...opportunities];
    demands[id] = { country: r.parsed.country };
    return { id };
  },

  async analyse(id) {
    await delay(2200);
    const base = analyses[id] ?? analyses.o1;
    analyses[id] = base;
    const a = withBlockers(id, base);
    opportunities = opportunities.map(o => (o.id === id ? { ...o, status: 'analysed', score: a.score } : o));
    return { analysis: a, coverage: coverage(a.expectations) };
  },

  async makeResume(id) {
    await delay(1800);
    const o = opportunities.find(x => x.id === id)!;
    const doc = {
      headline: o.role_title,
      summary: [
        'Операционный руководитель с опытом управления цепочкой поставок в трёх скандинавских странах.',
        'Команда до 25 человек и четырёх менеджеров, бюджет 4,2 млн EUR.',
      ],
      summary_support: [0, 1],
      facts_line: 'Разрешение на работу в ЕС — спонсорство не требуется · English C1, Swedish B1, Russian C2 · готова к релокации · linkedin.com/in/mkovaleva',
      competencies: ['S&OP', 'WMS', 'Планирование сети', 'Бюджетирование', 'Lean', 'Запуск площадок', 'KPI операций'],
      experience: [
        {
          company: 'Nordic Freight Group', role_title: 'Head of Operations',
          period_from: '2021-02', period_to: null,
          context_line: 'Команда 25 человек, 4 менеджера, бюджет 4,2 млн EUR, 3 страны',
          bullets: [
            'Сократила срок поставки на 40% за два квартала, перестроив планирование между площадками',
            'Вывела складскую сеть на единый WMS — экономия 620 тыс. EUR в год',
            'Вырастила команду с 8 до 25 человек, из них 4 менеджера',
            'Удержала команду при реорганизации 2023 года: ушёл 1 человек из 25',
          ], condensed: false,
        },
        {
          company: 'Baltic Logistics', role_title: 'Operations Manager',
          period_from: '2017-01', period_to: '2021-01',
          context_line: 'Команда 8 человек',
          bullets: [
            'Запустила две площадки — плановый объём за 5 месяцев вместо 9',
            'Снизила долю просроченных отгрузок с 12% до 3%',
          ], condensed: false,
        },
      ],
      education: ['MSc Industrial Engineering, KTH, 2014'],
      format_variant: 'nordic_nl' as const, language: 'sv',
      facts_used: ['f2', 'f3', 'f1', 'f4', 'f5', 'f6'],
    };
    const checks = checkResume(doc, { language: 'ru', facts, profile, analysis: analyses[id] ?? null });
    const rec: DocumentRecord = {
      id: 'd-' + id + '-r', kind: 'resume', version: 1, subject: null,
      body: JSON.stringify(doc), edited_by_user: false, format_variant: doc.format_variant,
      facts_used: doc.facts_used, checks, created_at: new Date().toISOString(),
    };
    documents[id] = [...(documents[id] ?? []).filter(d => d.kind !== 'resume'), rec];
    return { doc, checks };
  },

  async makeLetter(id) {
    await delay(1900);
    const o = opportunities.find(x => x.id === id)!;
    const body = o.kind === 'hypothesis'
      ? `В июле 2026 вы запустили вторую линию после пожара на основном заводе. По опыту такой запуск на квартал ломает планирование: производство выходит на объём раньше, чем под него перестроена отгрузка, и просрочка появляется там, где её никогда не было.

Я проходила такой переход в сети похожего размера. Сократила срок поставки на 40% за два квартала, перестроив планирование между площадками, и снизила долю просроченных отгрузок с 12% до 3%.

Роли под это у вас, насколько видно снаружи, пока нет. Возможно, она и не нужна. Но если вопрос уже обсуждается, предлагаю короткий разговор минут на двадцать на следующей неделе.

Ваш контакт я взяла со страницы руководства на сайте компании. Если такие письма вам не нужны, ответьте одним словом, и я больше не побеспокою.`
      : `Вы объявили о расширении в Данию в июне 2026, и это ровно тот момент, когда операционка в трёх странах перестаёт складываться из трёх национальных операций. Я вела именно такую конфигурацию — Швеция, Дания, Финляндия — и сократила срок поставки на 40% за два квартала.

Что я приношу под ваши требования: единый WMS вместо трёх складских контуров с экономией 620 тыс. EUR в год; запуск двух площадок с выходом на плановый объём за 5 месяцев вместо 9; команда, выросшая с 8 до 25 человек, из них четыре менеджера.

Про масштаб скажу прямо: в вашей вакансии 40+ человек, у меня было 25. Но эти 25 выросли из восьми под моим управлением, и четверо из них — руководители, то есть я управляю менеджерами, а не только специалистами. Разница между 25 и 40 здесь про темп найма, а не про тип работы.

Почему Instabox и почему сейчас: датский рынок последней мили устроен иначе, чем шведский, и ошибка на старте стоит года. Мне интересно именно это окно, а не роль вообще.

Предлагаю разговор на двадцать минут на неделе с 15 сентября.`;
    const doc = { subject: o.kind === 'hypothesis' ? 'Отгрузка после запуска второй линии' : 'Операции в трёх странах — 20 минут?', body };
    const checks = checkLetter(
      { ...doc, word_count: 0, bridge_used: 'trajectory', facts_used: ['f2', 'f3', 'f1'], language: 'ru' },
      o.kind,
      { language: 'ru', facts, profile, analysis: analyses[id] ?? null,
        opportunity: { company: o.company, signal: o.signal, jd_text: o.jd_text } },
    );
    const rec: DocumentRecord = {
      id: 'd-' + id + '-l', kind: 'letter', version: 1, subject: doc.subject,
      body: doc.body, edited_by_user: false, format_variant: null,
      facts_used: ['f2', 'f3', 'f1'], checks, created_at: new Date().toISOString(),
    };
    documents[id] = [...(documents[id] ?? []).filter(d => d.kind !== 'letter'), rec];
    return { doc, checks };
  },

  async saveDocument(id, patch) {
    await delay(250);
    let out: DocumentRecord | undefined;
    for (const list of Object.values(documents)) {
      const hit = list.find(d => d.id === id);
      if (hit) out = hit;
    }
    if (!out) return { checks: [] };
    const oppId = Object.keys(documents).find(k => documents[k].some(d => d.id === id))!;
    const o = opportunities.find(x => x.id === oppId)!;
    out.body = patch.body ?? out.body;
    out.subject = patch.subject ?? out.subject;
    out.edited_by_user = true;
    out.checks = out.kind === 'letter'
      ? checkLetter({ subject: out.subject ?? '', body: out.body, word_count: 0, bridge_used: null, facts_used: out.facts_used, language: 'ru' },
        o.kind, { language: 'ru', facts, profile, analysis: analyses[oppId] ?? null,
          opportunity: { company: o.company, signal: o.signal, jd_text: o.jd_text } })
      : checkResume(JSON.parse(out.body), { language: 'ru', facts, profile, analysis: analyses[oppId] ?? null });
    return { checks: out.checks };
  },

  async startRun() {
    const id = 'run-' + Date.now();
    runs[id] = { id, state: 'queued', stage: 'В очереди', found: 0, added: 0, error: null };
    const stages = ['Формирую поисковые запросы', 'Ищу открытые вакансии', 'Ищу компании с сигналами', 'Проверяю на дубли', 'Записываю в таблицу'];
    stages.forEach((s, i) => setTimeout(() => { runs[id] = { ...runs[id], state: 'running', stage: s }; }, 700 * (i + 1)));
    setTimeout(() => { runs[id] = { ...runs[id], state: 'done', stage: 'Готово', found: 7, added: 3 }; }, 700 * (stages.length + 1));
    return { run_id: id };
  },

  async getRun(id) {
    await delay(60);
    return runs[id];
  },

  async usage(): Promise<UsageSummary> {
    await delay(140);
    const status = checkBudget(usageLog);
    const byOperation: UsageSummary['byOperation'] = {};
    for (const e of usageLog) {
      const agg = byOperation[e.operation] ??= { count: 0, cost: 0, failed: 0 };
      agg.count++; agg.cost += e.cost_usd;
      if (!e.ok) agg.failed++;
    }
    return { ...status, byOperation, failed: usageLog.filter(e => !e.ok).length };
  },
};

/** Демо-профиль без структурированных полей — для показа онбординга с нуля. */
export function resetToBlankProfile(): void {
  profile = {
    ...profile, resume_text: '', extras_text: '', perimeter: '', geo: '',
    languages: [], work_auth: [], scale: null, relocation: null, gaps: [], roles: [],
    linkedin_url: '', linkedin_complete: false, years_exp: null,
  };
  facts = [];
}

/** Демо-профиль без немецкого — блокер на месте o2 виден сразу. */
export function demoProfile(): Profile { return profile; }
