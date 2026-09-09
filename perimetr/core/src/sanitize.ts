// Санитайз ответов модели: приведение к схеме и закрытым спискам.
//
// Structured Outputs гарантирует ФОРМУ ответа, но не то, что `bridge` — из
// восьми допустимых типов, `kind` блокера — из шести, а `fact_id` вообще
// существует. Перенос дисциплины из Help_me_clean (`family-core.js`) и
// twin-things (`catalog-core.js`): всё, что пришло от модели, проходит через
// чистую функцию, которая молча выбрасывает недопустимое и никогда не бросает.

import type {
  Analysis, Expectation, Blocker, Weight, Strength, GapClass, BridgeType,
  BlockerKind, FormatVariant, ResumeDoc, LetterDoc, Fact, ScaleTag, Cefr,
} from './types.ts';
import {
  BRIDGE_TYPES, BLOCKER_KINDS, FORMAT_VARIANTS, SCALE_TAGS, CEFR_ORDER,
} from './types.ts';

const str = (v: unknown, max = 4000): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const oneOf = <T extends string>(v: unknown, list: T[], fallback: T): T =>
  (list as string[]).includes(String(v)) ? (String(v) as T) : fallback;
const oneOfOrNull = <T extends string>(v: unknown, list: T[]): T | null =>
  (list as string[]).includes(String(v)) ? (String(v) as T) : null;

const WEIGHTS: Weight[] = ['must', 'important', 'nice'];
const STRENGTHS: Strength[] = ['strong', 'partial', 'gap'];

export function sanitizeExpectation(raw: unknown): Expectation | null {
  const o = (raw || {}) as Record<string, unknown>;
  const expectation = str(o.expectation, 400);
  if (!expectation) return null;
  const strength = oneOf(o.strength, STRENGTHS, 'gap');
  const gap_class = strength === 'gap'
    ? (oneOfOrNull(o.gap_class, ['hard', 'soft'] as const) ?? 'soft') as GapClass
    : (oneOfOrNull(o.gap_class, ['hard', 'soft'] as const) as GapClass);
  return {
    expectation,
    weight: oneOf(o.weight, WEIGHTS, 'important'),
    evidence: str(o.evidence, 600),
    fact_id: str(o.fact_id, 64) || null,
    source_hint: str(o.source_hint, 200),
    strength,
    gap_class,
    bridge: gap_class === 'soft' ? oneOfOrNull(o.bridge, BRIDGE_TYPES) : null,
    gap_answer: str(o.gap_answer, 400),
  };
}

export function sanitizeBlocker(raw: unknown): Blocker | null {
  const o = (raw || {}) as Record<string, unknown>;
  const kind = oneOfOrNull(o.kind, BLOCKER_KINDS);
  if (!kind) return null;                       // не из шести — не блокер
  return {
    kind: kind as BlockerKind,
    detail: str(o.detail, 400),
    resolvable_by_profile: bool(o.resolvable_by_profile),
    resolved: bool(o.resolved),
  };
}

/**
 * Разбор целиком. `score` намеренно НЕ берётся у модели — его считает воркер
 * (§10.4); здесь он обнуляется, чтобы забытый пересчёт был виден сразу.
 */
export function sanitizeAnalysis(raw: unknown): Analysis {
  const o = (raw || {}) as Record<string, unknown>;
  const expectations = arr(o.expectations)
    .map(sanitizeExpectation)
    .filter((x): x is Expectation => x !== null)
    .slice(0, 7);
  const objRaw = (o.objection || {}) as Record<string, unknown>;
  const risk = str(objRaw.risk, 400);
  return {
    expectations,
    blockers: arr(o.blockers).map(sanitizeBlocker).filter((x): x is Blocker => x !== null),
    score: 0,
    uvp: str(o.uvp, 800),
    objection: risk ? { risk, answer: str(objRaw.answer, 800) } : null,
    reconstructed: bool(o.reconstructed),
  };
}

export function sanitizeFact(raw: unknown, idFn: () => string): Fact | null {
  const o = (raw || {}) as Record<string, unknown>;
  const action = str(o.action, 300);
  const source_hint = str(o.source_hint, 200);
  // Без подтверждаемой цитаты факт не существует (§10.4a: «отбрасываются молча»).
  if (!action || !source_hint) return null;
  const metric_value = num(o.metric_value);
  return {
    id: str(o.id, 64) || idFn(),
    company: str(o.company, 160) || undefined,
    role_title: str(o.role_title, 160) || undefined,
    period_from: str(o.period_from, 20) || undefined,
    period_to: str(o.period_to, 20) || null,
    action,
    how: str(o.how, 400) || undefined,
    result: str(o.result, 400) || undefined,
    metric_value,
    metric_unit: str(o.metric_unit, 40) || null,
    scale_tags: arr(o.scale_tags).map(t => oneOfOrNull(t, SCALE_TAGS)).filter((x): x is ScaleTag => !!x),
    domain_tags: arr(o.domain_tags).map(t => str(t, 60)).filter(Boolean).slice(0, 8),
    quantified: metric_value != null || /\d/.test(str(o.result, 400)),
    source_hint,
    confirmed: false,          // подтверждает только пользователь (§10.4a)
  };
}

// ── Ingest (§10.8) ──────────────────────────────────────────────────────────
export interface IngestResult {
  company: string; role_title: string; city: string; country: string;
  industry: string; size: string; language: string; seniority: string;
  requirements: string[]; responsibilities: string[];
  contact_email: string; salary: string; posted_date: string;
  confidence: 'high' | 'medium' | 'low';
  is_job_posting: boolean;
}

export function sanitizeIngest(raw: unknown, jdText: string): IngestResult {
  const o = (raw || {}) as Record<string, unknown>;
  const email = str(o.contact_email, 200);
  return {
    company: str(o.company, 200),
    role_title: str(o.role_title, 200),
    city: str(o.city, 120),
    country: str(o.country, 120),
    industry: str(o.industry, 120),
    size: str(o.size, 60),
    language: str(o.language, 20),
    seniority: str(o.seniority, 60),
    requirements: arr(o.requirements).map(x => str(x, 400)).filter(Boolean).slice(0, 30),
    responsibilities: arr(o.responsibilities).map(x => str(x, 400)).filter(Boolean).slice(0, 30),
    // §10.6 — адрес принимается, только если он буквально есть в тексте вакансии.
    contact_email: email && jdText.toLowerCase().includes(email.toLowerCase()) ? email : '',
    salary: str(o.salary, 120),
    posted_date: str(o.posted_date, 20),
    confidence: oneOf(o.confidence, ['high', 'medium', 'low'] as const, 'low'),
    is_job_posting: o.is_job_posting !== false,
  };
}

// ── Discover (§10.3) ────────────────────────────────────────────────────────
export interface DiscoverItem {
  company: string; website: string; industry: string; city: string; country: string;
  size: string; kind: 'vacancy' | 'hypothesis'; role_title: string;
  signal: string; signal_date: string; source_url: string; why_fit: string;
  contact: { name: string; title: string; email: string; linkedin: string } | null;
}

/**
 * §10.6 «Правило контактов»: любой адрес от модели, не подтверждённый ссылкой,
 * обнуляется. Правдоподобный несуществующий адрес хуже пустого поля — он
 * расходует попытку и создаёт ложное ощущение работы. Имя и должность
 * сохраняются только вместе с `source_url`.
 */
export function sanitizeDiscoverItem(raw: unknown): DiscoverItem | null {
  const o = (raw || {}) as Record<string, unknown>;
  const company = str(o.company, 200);
  const role_title = str(o.role_title, 200);
  const source_url = str(o.source_url, 600);
  if (!company || !role_title) return null;
  const kind = oneOf(o.kind, ['vacancy', 'hypothesis'] as const, 'hypothesis');
  const signal = str(o.signal, 600);
  // Гипотеза обязана опираться на датированный сигнал (§10.3) — иначе это не гипотеза.
  if (kind === 'hypothesis' && (!signal || !str(o.signal_date, 20) || !source_url)) return null;
  const c = (o.contact || {}) as Record<string, unknown>;
  const contact = source_url
    ? { name: str(c.name, 160), title: str(c.title, 160), email: '', linkedin: str(c.linkedin, 400) }
    : null;
  return {
    company, website: str(o.website, 400), industry: str(o.industry, 120),
    city: str(o.city, 120), country: str(o.country, 120), size: str(o.size, 60),
    kind, role_title, signal, signal_date: str(o.signal_date, 20), source_url,
    why_fit: str(o.why_fit, 600),
    contact: contact && (contact.name || contact.linkedin) ? contact : null,
  };
}

// ── Документы ───────────────────────────────────────────────────────────────

export function sanitizeResume(raw: unknown, fallbackVariant: FormatVariant = 'intl'): ResumeDoc {
  const o = (raw || {}) as Record<string, unknown>;
  return {
    headline: str(o.headline, 200),
    summary: arr(o.summary).map(x => str(x, 400)).filter(Boolean).slice(0, 3),
    facts_line: str(o.facts_line, 400),
    competencies: arr(o.competencies).map(x => str(x, 60)).filter(Boolean).slice(0, 10),
    experience: arr(o.experience).map(r => {
      const e = (r || {}) as Record<string, unknown>;
      return {
        company: str(e.company, 200),
        role_title: str(e.role_title, 200),
        period_from: str(e.period_from, 20),
        period_to: str(e.period_to, 20) || null,
        context_line: str(e.context_line, 400),
        bullets: arr(e.bullets).map(b => str(b, 500)).filter(Boolean).slice(0, 6),
        condensed: bool(e.condensed),
      };
    }).filter(r => r.company || r.role_title),
    education: arr(o.education).map(x => str(x, 300)).filter(Boolean),
    format_variant: oneOf(o.format_variant, FORMAT_VARIANTS, fallbackVariant),
    language: str(o.language, 20) || 'en',
    facts_used: arr(o.facts_used).map(x => str(x, 64)).filter(Boolean),
    summary_support: arr(o.summary_support).map(num).slice(0, 3),
    durations_in_years: bool(o.durations_in_years),
  };
}

export function sanitizeLetter(raw: unknown): LetterDoc {
  const o = (raw || {}) as Record<string, unknown>;
  const body = str(o.body, 8000);
  return {
    subject: str(o.subject, 200),
    body,
    word_count: body ? body.split(/\s+/).filter(Boolean).length : 0,
    bridge_used: oneOfOrNull(o.bridge_used, BRIDGE_TYPES),
    facts_used: arr(o.facts_used).map(x => str(x, 64)).filter(Boolean),
    language: str(o.language, 20) || 'en',
  };
}

/** CEFR из свободной строки: «German C1», «немецкий — с1». Не угадывает «fluent». */
export function parseCefr(v: unknown): Cefr | null {
  const m = String(v ?? '').toUpperCase().match(/\b([ABC][12])\b/);
  return m && (CEFR_ORDER as string[]).includes(m[1]) ? (m[1] as Cefr) : null;
}
