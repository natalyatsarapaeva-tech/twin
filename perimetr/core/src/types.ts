// Доменные типы «Периметра» (ТЗ §7, §10). Ровно те поля, которые описаны в ТЗ;
// ничего «на будущее» — лишнее поле в типе становится лишним полем в промпте.

// ── Профиль (§7 profiles) ────────────────────────────────────────────────────
export type Cefr = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export const CEFR_ORDER: Cefr[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export type WorkAuthStatus = 'citizen' | 'permit' | 'needs_sponsorship';
export interface WorkAuth { region: string; status: WorkAuthStatus }

export interface LanguageLevel { lang: string; cefr: Cefr }

export interface Relocation { ready: 'yes' | 'no' | 'conditional'; package_needed: boolean }

export interface Scale {
  team_max?: number | null;
  managers_max?: number | null;
  budget_max?: number | null;
  pnl?: boolean;
  geo_scope?: string;
  users_or_clients?: string;
}

export interface CareerGap { from: string; to: string; reason?: string }

export interface RoleDates { company?: string; role_title?: string; from: string; to: string | null }

export type PhotoPolicy = 'auto' | 'never' | 'always';

export interface Profile {
  resume_text: string;
  extras_text: string;
  perimeter: string;
  industries: string;
  exclude: string;
  geo: string;
  breadth: 'narrow' | 'medium' | 'wide';
  languages: LanguageLevel[];
  work_auth: WorkAuth[];
  relocation: Relocation | null;
  scale: Scale | null;
  years_exp: number | null;
  gaps: CareerGap[];
  salary_range: string;
  linkedin_url: string;
  linkedin_complete: boolean;
  photo_policy: PhotoPolicy;
  roles?: RoleDates[];        // даты ролей — из резюме, нужны прогрессии и перерывам
}

// ── Банк фактов (§7 facts, §10.4a) ──────────────────────────────────────────
export type ScaleTag = 'team' | 'managers' | 'budget' | 'pnl' | 'geo' | 'users';
export const SCALE_TAGS: ScaleTag[] = ['team', 'managers', 'budget', 'pnl', 'geo', 'users'];

export interface Fact {
  id: string;
  company?: string;
  role_title?: string;
  period_from?: string;
  period_to?: string | null;
  action: string;
  how?: string;
  result?: string;
  metric_value?: number | null;
  metric_unit?: string | null;
  scale_tags: ScaleTag[];
  domain_tags: string[];
  quantified: boolean;
  source_hint: string;
  confirmed: boolean;
}

// ── Место (§7 opportunities) ────────────────────────────────────────────────
export type OpportunityKind = 'vacancy' | 'hypothesis';
export type OpportunityOrigin = 'discovered' | 'manual_url' | 'manual_text' | 'sheet';
export type OpportunityStatus =
  | 'new' | 'analysed' | 'drafted' | 'sent' | 'replied' | 'interview' | 'rejected' | 'archived';
export type Channel = 'cold' | 'warm' | 'referral';

export interface Opportunity {
  id: string;
  company: string;
  company_key: string;
  industry?: string;
  city?: string;
  country?: string;
  size?: string;
  website?: string;
  kind: OpportunityKind;
  origin: OpportunityOrigin;
  jd_text?: string | null;
  role_title: string;
  signal?: string;
  source_url?: string;
  source_date?: string;
  status: OpportunityStatus;
  score?: number | null;
  channel: Channel;
  referral_name?: string | null;
  salary_hint?: string | null;
  contact_name?: string | null;
  contact_title?: string | null;
  contact_email?: string | null;
  contact_linkedin?: string | null;
  user_note?: string | null;
  updated_at: string;
}

// ── Разбор (§10.4) ──────────────────────────────────────────────────────────
export type Weight = 'must' | 'important' | 'nice';
export type Strength = 'strong' | 'partial' | 'gap';
export type GapClass = 'hard' | 'soft' | null;

export type BridgeType =
  | 'transferable_metrics' | 'trajectory' | 'explained_gap' | 'grouped_roles'
  | 'deliberate_choice' | 'analogous_tools' | 'relocation_ready' | 'results_over_years';
export const BRIDGE_TYPES: BridgeType[] = [
  'transferable_metrics', 'trajectory', 'explained_gap', 'grouped_roles',
  'deliberate_choice', 'analogous_tools', 'relocation_ready', 'results_over_years',
];

export type BlockerKind = 'work_auth' | 'license' | 'language' | 'no_people_mgmt' | 'scale' | 'salary';
export const BLOCKER_KINDS: BlockerKind[] = [
  'work_auth', 'license', 'language', 'no_people_mgmt', 'scale', 'salary',
];

export interface Expectation {
  expectation: string;
  weight: Weight;
  evidence: string;
  fact_id: string | null;
  source_hint: string;
  strength: Strength;
  gap_class: GapClass;
  bridge: BridgeType | null;
  gap_answer: string;
}

export interface Blocker {
  kind: BlockerKind;
  detail: string;
  resolvable_by_profile: boolean;
  resolved?: boolean;
}

export interface Analysis {
  expectations: Expectation[];
  blockers: Blocker[];
  score: number;
  uvp: string;
  objection: { risk: string; answer: string } | null;
  reconstructed: boolean;
}

// ── Документы (§7 documents, §10.10) ────────────────────────────────────────
export type DocumentKind = 'resume' | 'letter';
export type FormatVariant = 'intl' | 'uk_ie' | 'nordic_nl' | 'de_at' | 'europass';
export const FORMAT_VARIANTS: FormatVariant[] = ['intl', 'uk_ie', 'nordic_nl', 'de_at', 'europass'];

export type CheckLevel = 'block' | 'warn' | 'info';
export interface CheckResult {
  rule: string;
  level: CheckLevel;
  message: string;
  /** Куда прыгать в тексте: индекс буллита, номер абзаца, позиция вхождения. */
  locator?: { kind: 'bullet' | 'paragraph' | 'offset'; value: number } | null;
}

/** Структурированное резюме (§10.5 — порядок секций фиксирован). */
export interface ResumeDoc {
  headline: string;
  summary: string[];              // 2–3 строки
  facts_line: string;
  competencies: string[];         // 6–10 терминов
  experience: ResumeRole[];
  education: string[];
  format_variant: FormatVariant;
  language: string;
  facts_used: string[];
  /**
   * §10.10 «саммари подтверждено»: для каждой строки саммари — индекс буллита в
   * плоском списке, который её подтверждает, или null. Размечает модель в
   * структурированном ответе; проверка только сверяет, что null-ов нет.
   */
  summary_support?: (number | null)[];
  /** §10.5 — переключатель «длительность ролей в годах» при перерывах. */
  durations_in_years?: boolean;
}
export interface ResumeRole {
  company: string;
  role_title: string;
  period_from: string;
  period_to: string | null;
  context_line: string;           // масштаб: команда, бюджет, гео
  bullets: string[];
  condensed?: boolean;            // роль старше 15 лет — одной строкой
}

export interface LetterDoc {
  subject: string;
  body: string;
  word_count: number;
  bridge_used: BridgeType | null;
  facts_used: string[];
  language: string;
}

// ── Учёт (§7 usage_log, §10.9) ──────────────────────────────────────────────
export type Operation =
  | 'discover' | 'analyse' | 'resume' | 'letter' | 'extract' | 'audit' | 'check' | 'ingest' | 'classify';
export const OPERATIONS: Operation[] = [
  'discover', 'analyse', 'resume', 'letter', 'extract', 'audit', 'check', 'ingest', 'classify',
];

export interface UsageEntry {
  operation: Operation;
  model: string;
  tokens_in: number;
  tokens_out: number;
  tool_calls: number;
  cost_usd: number;
  ok: boolean;              // §4.3.2 — неудачные вызовы тоже пишутся
  created_at: string;
}
