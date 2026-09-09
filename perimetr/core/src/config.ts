// Конфиг «Периметра» (ТЗ §10.1 в редакции 1.2): модели, пороги, стоп-листы и
// промпты — данные, а не константы в коде. Дефолты живут здесь, переопределения
// приходят из таблицы `config` и накладываются сверху (см. resolveConfig).
//
// Почему так, а не литералами по месту: ТЗ трижды обещает конфигурируемость —
// §10.1 (смена линейки моделей), §19 (ревизия порогов через две недели ручной
// оценки), Приложение Б (стоп-лист пополняется по замечаниям пользователя). При
// константах в исходнике каждое из трёх означает передеплой, и потому не будет
// сделано. Приём перенесён из twin (`prompts.js` + `admin.html`).

import type { Operation } from './types.ts';

// ── Модели (§10.1) ──────────────────────────────────────────────────────────
export interface ModelsConfig {
  discover: string;
  analyse: string;
  resume: string;
  letter: string;
  extract: string;
  audit: string;
  check: string;
  ingest: string;
  classify: string;
  /** Ступень ниже — куда деградировать при 429/503 (§10.1). */
  fallback: Record<string, string>;
  /** Сколько веб-запросов Discover делает одновременно (§9.1 в редакции 1.2). */
  maxConcurrency: number;
}

export const DEFAULT_MODELS: ModelsConfig = {
  discover: 'gpt-5.6-terra',
  analyse: 'gpt-5.6-sol',
  resume: 'gpt-5.6-terra',
  letter: 'gpt-5.6-terra',
  extract: 'gpt-5.6-luna',
  audit: 'gpt-5.6-sol',
  check: 'gpt-5.6-luna',
  ingest: 'gpt-5.6-luna',
  classify: 'gpt-5.6-luna',
  fallback: {
    'gpt-6-astra': 'gpt-5.6-sol',
    'gpt-5.6-sol': 'gpt-5.6-terra',
    'gpt-5.6-terra': 'gpt-5.6-luna',
  },
  maxConcurrency: 3,
};

/** Цены Standard за 1M токенов на сентябрь 2026 (§10.1). Тоже конфиг: линейка сменится. */
export interface Price { in: number; cached_in: number; out: number }
export const DEFAULT_PRICES: Record<string, Price> = {
  'gpt-6-astra': { in: 10.0, cached_in: 1.0, out: 50.0 },
  'gpt-5.6-sol': { in: 4.0, cached_in: 0.4, out: 20.0 },
  'gpt-5.6-terra': { in: 2.0, cached_in: 0.2, out: 12.0 },
  'gpt-5.6-luna': { in: 0.2, cached_in: 0.02, out: 1.2 },
};
/** Веб-поиск: $10 за 1000 вызовов плюс токены найденного (§10.1). */
export const DEFAULT_WEB_SEARCH_PER_CALL = 0.01;

// ── Пороги (§10.4a, §10.9, §10.10) ──────────────────────────────────────────
export interface Thresholds {
  /** §10.4a, §10.10 — доля буллитов/фактов с числом. */
  quantifiedShare: number;
  /** §10.4a — квантифицированных фактов на роль последних N лет. */
  quantifiedPerRole: number;
  recentRoleYears: number;
  /** §10.4 — отношение требуемого масштаба к имеющемуся. */
  scaleSoftRatio: number;      // ≤ этого — мягкий гэп
  scaleHardTeamRatio: number;  // ≥ этого по команде — жёсткий
  scaleHardBudgetRatio: number;// ≥ этого по бюджету — жёсткий
  /** §10.4a — перерыв, требующий причины (месяцы). */
  gapNeedsReasonMonths: number;
  /** §10.4 — перерыв без причины, дающий мягкий гэп (месяцы). */
  gapSoftMonths: number;
  /** §10.4, §10.4a — средний срок в роли (месяцы), ниже — мягкий гэп. */
  avgTenureMonths: number;
  /** §10.5 — опыт, с которого резюме двухстраничное. */
  twoPageYears: number;
  /** §10.5 — роли старше N лет сворачиваются в строку. */
  condenseRoleYears: number;
  /** §10.10 — оценка знаков на страницу резюме. */
  charsPerPage: number;
  maxResumePages: number;
  /** §10.5a — длины писем по веткам. */
  letterVacancy: [number, number];
  letterHypothesis: [number, number];
  /** §10.10 — сколько предложений должно сломаться в swap-тесте. */
  swapMinBroken: number;
  /** §10.10 — вхождений стоп-листа до перевода warn → block. */
  stoplistBlockAt: number;
  /** §10.10 — верхняя треть: сколько первых буллитов должны закрывать `must`. */
  topBullets: number;
  /** §10.4 — допустимое расхождение при поиске source_hint в тексте профиля. */
  sourceHintTolerance: number;
  /** §10.9 — месячный бюджет пользователя, USD. */
  monthlyBudgetUsd: number;
  budgetWarnAt: number;        // доля, на которой мягкое предупреждение
  /** §9.2 — прогоны поиска. */
  runsPerDay: number;
  runTimeoutMs: number;
  /** §12.4 — писем в сутки. */
  lettersPerDay: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  quantifiedShare: 0.6,
  quantifiedPerRole: 2,
  recentRoleYears: 10,
  scaleSoftRatio: 2,
  scaleHardTeamRatio: 3,
  scaleHardBudgetRatio: 10,
  gapNeedsReasonMonths: 6,
  gapSoftMonths: 12,
  avgTenureMonths: 24,
  twoPageYears: 10,
  condenseRoleYears: 15,
  charsPerPage: 3500,
  maxResumePages: 2,
  letterVacancy: [250, 350],
  letterHypothesis: [120, 180],
  swapMinBroken: 2,
  stoplistBlockAt: 3,
  topBullets: 3,
  sourceHintTolerance: 0.3,
  monthlyBudgetUsd: 15,
  budgetWarnAt: 0.8,
  runsPerDay: 10,
  runTimeoutMs: 5 * 60 * 1000,
  lettersPerDay: 10,
};

// ── Стоп-лист (Приложение Б) ────────────────────────────────────────────────
// По языкам документа. Добавление шведского — правка данных, не кода.
export interface Stoplist {
  phrases: Record<string, string[]>;
  bannedOpenings: string[];
  /** §10.5 — слова, запрещённые в списке компетенций резюме. */
  bannedCompetencies: Record<string, string[]>;
}

export const DEFAULT_STOPLIST: Stoplist = {
  phrases: {
    en: [
      'proven track record', 'results-driven', 'results-oriented', 'detail-oriented',
      'team player', 'dynamic professional', 'passionate about', 'thought leader',
      'go-getter', 'think outside the box', 'synergy', 'synergies',
      'seasoned professional', 'hard-working', 'self-starter', 'hit the ground running',
      'i am writing to express my interest', 'i am thrilled to apply', 'i am excited to apply',
      'i believe i would be a great fit', 'i look forward to the opportunity',
      'strong communication skills', 'fast-paced environment',
    ],
    ru: [
      'командный игрок', 'результативный лидер', 'нацеленность на результат',
      'стрессоустойчивость', 'коммуникабельность', 'ответственность и пунктуальность',
      'богатый опыт', 'проверенный трек-рекорд', 'меня заинтересовала ваша вакансия',
      'буду рад стать частью команды', 'буду рада стать частью команды',
      'обладаю лидерскими качествами',
    ],
    sv: [
      'resultatinriktad', 'driven lagspelare', 'prestigelös', 'brinner för',
      'jag söker härmed tjänsten', 'gedigen erfarenhet', 'stresstålig',
      'social och utåtriktad',
    ],
  },
  bannedOpenings: [
    'i am writing', 'my name is', 'please find attached',
    'меня заинтересовала', 'меня зовут',
    'jag söker', 'mitt namn är',
  ],
  bannedCompetencies: {
    en: ['leadership', 'communication', 'teamwork', 'problem solving'],
    ru: ['лидерство', 'коммуникация', 'работа в команде', 'решение проблем'],
    sv: ['ledarskap', 'kommunikation', 'teamwork'],
  },
};

// ── Собранный конфиг ────────────────────────────────────────────────────────
export interface PerimetrConfig {
  models: ModelsConfig;
  prices: Record<string, Price>;
  webSearchPerCall: number;
  thresholds: Thresholds;
  stoplist: Stoplist;
}

export const DEFAULT_CONFIG: PerimetrConfig = {
  models: DEFAULT_MODELS,
  prices: DEFAULT_PRICES,
  webSearchPerCall: DEFAULT_WEB_SEARCH_PER_CALL,
  thresholds: DEFAULT_THRESHOLDS,
  stoplist: DEFAULT_STOPLIST,
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/**
 * Эффективный конфиг = дефолт + переопределения. Переопределение частичное:
 * подвинуть один порог не значит переписать всю таблицу. Неизвестные ключи
 * игнорируются — конфиг правится человеком, и опечатка не должна ронять воркер.
 */
export function resolveConfig(overrides?: DeepPartial<PerimetrConfig> | null): PerimetrConfig {
  if (!overrides) return DEFAULT_CONFIG;
  return {
    models: { ...DEFAULT_MODELS, ...(overrides.models as object || {}),
      fallback: { ...DEFAULT_MODELS.fallback, ...((overrides.models as ModelsConfig)?.fallback || {}) } },
    prices: { ...DEFAULT_PRICES, ...(overrides.prices as object || {}) },
    webSearchPerCall: overrides.webSearchPerCall ?? DEFAULT_WEB_SEARCH_PER_CALL,
    thresholds: { ...DEFAULT_THRESHOLDS, ...(overrides.thresholds as object || {}) },
    stoplist: {
      phrases: { ...DEFAULT_STOPLIST.phrases, ...(overrides.stoplist as Stoplist)?.phrases },
      bannedOpenings: (overrides.stoplist as Stoplist)?.bannedOpenings ?? DEFAULT_STOPLIST.bannedOpenings,
      bannedCompetencies: {
        ...DEFAULT_STOPLIST.bannedCompetencies,
        ...(overrides.stoplist as Stoplist)?.bannedCompetencies,
      },
    },
  };
}

/** Модель ступенью ниже для деградации при 429/503 (§10.1). null — деградировать некуда. */
export function degradeModel(cfg: PerimetrConfig, model: string): string | null {
  return cfg.models.fallback[model] ?? null;
}

/** Модель, назначенная операции (§10.1). */
export function modelFor(cfg: PerimetrConfig, op: Operation): string {
  return (cfg.models as unknown as Record<string, string>)[op] ?? cfg.models.classify;
}
