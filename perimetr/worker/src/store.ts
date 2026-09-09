// Доступ к D1. Инвариант всего файла: user_id приходит ТОЛЬКО из сессии и
// присутствует в каждом запросе (§15.1). Функции здесь не принимают user_id из
// тела запроса — его им передаёт роутер после requireSession().

import {
  type Profile, type Fact, type Opportunity, type Analysis, type UsageEntry,
  type PerimetrConfig, resolveConfig, companyKey,
} from '@perimetr/core';
import { type Env, nowIso, uid } from './env.ts';

const j = <T>(raw: unknown, fallback: T): T => {
  if (typeof raw !== 'string' || !raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

// ── Конфиг (§10.1) ──────────────────────────────────────────────────────────
export async function loadConfig(env: Env): Promise<PerimetrConfig> {
  const rows = await env.DB.prepare('SELECT key, value FROM config').all<{ key: string; value: string }>();
  const overrides: Record<string, unknown> = {};
  for (const r of rows.results ?? []) {
    const parsed = j<unknown>(r.value, null);
    if (parsed == null) continue;
    if (r.key === 'MODELS') overrides.models = parsed;
    else if (r.key === 'THRESHOLDS') overrides.thresholds = parsed;
    else if (r.key === 'STOPLIST') overrides.stoplist = parsed;
  }
  return resolveConfig(overrides as never);
}

export async function loadPromptOverrides(env: Env): Promise<Record<string, string>> {
  const row = await env.DB.prepare("SELECT value FROM config WHERE key='PROMPTS'").first<{ value: string }>();
  return j<Record<string, string>>(row?.value, {});
}

export async function saveConfigKey(env: Env, key: string, value: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO config (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).bind(key, JSON.stringify(value), nowIso()).run();
}

// ── Профиль ─────────────────────────────────────────────────────────────────
export async function getProfile(env: Env, userId: string): Promise<Profile> {
  const r = await env.DB.prepare('SELECT * FROM profiles WHERE user_id=?').bind(userId)
    .first<Record<string, unknown>>();
  return {
    resume_text: String(r?.resume_text ?? ''),
    extras_text: String(r?.extras_text ?? ''),
    perimeter: String(r?.perimeter ?? ''),
    industries: String(r?.industries ?? ''),
    exclude: String(r?.exclude ?? ''),
    geo: String(r?.geo ?? ''),
    breadth: (r?.breadth as Profile['breadth']) ?? 'medium',
    languages: j(r?.languages, []),
    work_auth: j(r?.work_auth, []),
    relocation: j(r?.relocation, null),
    scale: j(r?.scale, null),
    years_exp: (r?.years_exp as number | null) ?? null,
    gaps: j(r?.gaps, []),
    roles: j(r?.roles, []),
    salary_range: String(r?.salary_range ?? ''),
    linkedin_url: String(r?.linkedin_url ?? ''),
    linkedin_complete: !!r?.linkedin_complete,
    photo_policy: (r?.photo_policy as Profile['photo_policy']) ?? 'auto',
  };
}

export async function saveProfile(env: Env, userId: string, p: Partial<Profile>): Promise<void> {
  const cur = await getProfile(env, userId);
  const n = { ...cur, ...p };
  await env.DB.prepare(
    `UPDATE profiles SET resume_text=?, extras_text=?, perimeter=?, industries=?, exclude=?,
       geo=?, breadth=?, languages=?, work_auth=?, relocation=?, scale=?, years_exp=?,
       gaps=?, roles=?, salary_range=?, linkedin_url=?, linkedin_complete=?, photo_policy=?, updated_at=?
     WHERE user_id=?`,
  ).bind(
    n.resume_text, n.extras_text, n.perimeter, n.industries, n.exclude, n.geo, n.breadth,
    JSON.stringify(n.languages), JSON.stringify(n.work_auth), JSON.stringify(n.relocation),
    JSON.stringify(n.scale), n.years_exp, JSON.stringify(n.gaps), JSON.stringify(n.roles ?? []),
    n.salary_range, n.linkedin_url, n.linkedin_complete ? 1 : 0, n.photo_policy, nowIso(), userId,
  ).run();
}

export async function saveAudit(env: Env, userId: string, audit: unknown): Promise<void> {
  await env.DB.prepare('UPDATE profiles SET audit=?, updated_at=? WHERE user_id=?')
    .bind(JSON.stringify(audit), nowIso(), userId).run();
}

export async function getAudit(env: Env, userId: string): Promise<unknown | null> {
  const r = await env.DB.prepare('SELECT audit FROM profiles WHERE user_id=?').bind(userId).first<{ audit: string }>();
  return j<unknown>(r?.audit, null);
}

// ── Банк фактов ─────────────────────────────────────────────────────────────
export async function listFacts(env: Env, userId: string): Promise<Fact[]> {
  const rows = await env.DB.prepare('SELECT * FROM facts WHERE user_id=? ORDER BY quantified DESC, created_at')
    .bind(userId).all<Record<string, unknown>>();
  return (rows.results ?? []).map(r => ({
    id: String(r.id), company: r.company as string, role_title: r.role_title as string,
    period_from: r.period_from as string, period_to: r.period_to as string,
    action: String(r.action), how: r.how as string, result: r.result as string,
    metric_value: r.metric_value as number | null, metric_unit: r.metric_unit as string | null,
    scale_tags: j(r.scale_tags, []), domain_tags: j(r.domain_tags, []),
    quantified: !!r.quantified, source_hint: String(r.source_hint), confirmed: !!r.confirmed,
  }));
}

export async function replaceFacts(env: Env, userId: string, facts: Fact[]): Promise<void> {
  const stmts = [env.DB.prepare('DELETE FROM facts WHERE user_id=? AND confirmed=0').bind(userId)];
  for (const f of facts) {
    stmts.push(env.DB.prepare(
      `INSERT OR REPLACE INTO facts (id,user_id,company,role_title,period_from,period_to,action,how,result,
        metric_value,metric_unit,scale_tags,domain_tags,quantified,source_hint,confirmed,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(f.id, userId, f.company ?? null, f.role_title ?? null, f.period_from ?? null, f.period_to ?? null,
      f.action, f.how ?? null, f.result ?? null, f.metric_value ?? null, f.metric_unit ?? null,
      JSON.stringify(f.scale_tags), JSON.stringify(f.domain_tags), f.quantified ? 1 : 0,
      f.source_hint, f.confirmed ? 1 : 0, nowIso()));
  }
  await env.DB.batch(stmts);
}

export async function patchFact(env: Env, userId: string, id: string, patch: Partial<Fact>): Promise<void> {
  const cur = (await listFacts(env, userId)).find(f => f.id === id);
  if (!cur) return;
  const n = { ...cur, ...patch };
  await env.DB.prepare(
    `UPDATE facts SET action=?, how=?, result=?, metric_value=?, metric_unit=?, quantified=?, confirmed=?
     WHERE id=? AND user_id=?`,
  ).bind(n.action, n.how ?? null, n.result ?? null, n.metric_value ?? null, n.metric_unit ?? null,
    n.metric_value != null || /\d/.test(String(n.result ?? '')) ? 1 : 0, n.confirmed ? 1 : 0, id, userId).run();
}

export async function deleteFact(env: Env, userId: string, id: string): Promise<void> {
  await env.DB.prepare('DELETE FROM facts WHERE id=? AND user_id=?').bind(id, userId).run();
}

// ── Места ───────────────────────────────────────────────────────────────────
const toOpportunity = (r: Record<string, unknown>): Opportunity => ({
  id: String(r.id), company: String(r.company), company_key: String(r.company_key),
  industry: r.industry as string, city: r.city as string, country: r.country as string,
  size: r.size as string, website: r.website as string,
  kind: r.kind as Opportunity['kind'], origin: r.origin as Opportunity['origin'],
  jd_text: r.jd_text as string | null, role_title: String(r.role_title),
  signal: r.signal as string, source_url: r.source_url as string, source_date: r.source_date as string,
  status: r.status as Opportunity['status'], score: r.score as number | null,
  channel: (r.channel as Opportunity['channel']) ?? 'cold', referral_name: r.referral_name as string | null,
  salary_hint: r.salary_hint as string | null,
  contact_name: r.contact_name as string | null, contact_title: r.contact_title as string | null,
  contact_email: r.contact_email as string | null, contact_linkedin: r.contact_linkedin as string | null,
  user_note: r.user_note as string | null, updated_at: String(r.updated_at),
});

export async function listOpportunities(
  env: Env, userId: string, filter: { status?: string; kind?: string } = {},
): Promise<Opportunity[]> {
  let sql = 'SELECT * FROM opportunities WHERE user_id=?';
  const binds: unknown[] = [userId];
  if (filter.status) { sql += ' AND status=?'; binds.push(filter.status); }
  else { sql += " AND status != 'archived'"; }
  if (filter.kind) { sql += ' AND kind=?'; binds.push(filter.kind); }
  sql += ' ORDER BY updated_at DESC LIMIT 500';
  const rows = await env.DB.prepare(sql).bind(...binds).all<Record<string, unknown>>();
  return (rows.results ?? []).map(toOpportunity);
}

export async function getOpportunity(env: Env, userId: string, id: string): Promise<Opportunity | null> {
  const r = await env.DB.prepare('SELECT * FROM opportunities WHERE id=? AND user_id=?')
    .bind(id, userId).first<Record<string, unknown>>();
  return r ? toOpportunity(r) : null;
}

export async function createOpportunity(
  env: Env, userId: string, o: Partial<Opportunity> & { company: string; role_title: string },
): Promise<string> {
  const id = o.id ?? uid();
  await env.DB.prepare(
    `INSERT INTO opportunities (id,user_id,company,company_key,industry,city,country,size,website,kind,origin,
      jd_text,jd_fetched_at,role_title,signal,source_url,source_date,status,channel,salary_hint,
      contact_name,contact_title,contact_email,contact_linkedin,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(id, userId, o.company, companyKey(o.company), o.industry ?? null, o.city ?? null,
    o.country ?? null, o.size ?? null, o.website ?? null, o.kind ?? 'vacancy', o.origin ?? 'manual_text',
    o.jd_text ?? null, o.jd_text ? nowIso() : null, o.role_title, o.signal ?? null,
    o.source_url ?? null, o.source_date ?? null, o.status ?? 'new', o.channel ?? 'cold',
    o.salary_hint ?? null, o.contact_name ?? null, o.contact_title ?? null,
    o.contact_email ?? null, o.contact_linkedin ?? null, nowIso(), nowIso()).run();
  return id;
}

const PATCHABLE = ['status', 'user_note', 'contact_name', 'contact_title', 'contact_email',
  'contact_linkedin', 'channel', 'referral_name', 'score', 'hard_blocker', 'kind', 'jd_text'] as const;

export async function patchOpportunity(
  env: Env, userId: string, id: string, patch: Record<string, unknown>,
): Promise<void> {
  const keys = Object.keys(patch).filter(k => (PATCHABLE as readonly string[]).includes(k));
  if (!keys.length) return;
  const set = keys.map(k => `${k}=?`).join(', ');
  const binds = keys.map(k => {
    const v = patch[k];
    return typeof v === 'object' && v !== null ? JSON.stringify(v) : v as never;
  });
  await env.DB.prepare(`UPDATE opportunities SET ${set}, updated_at=? WHERE id=? AND user_id=?`)
    .bind(...binds, nowIso(), id, userId).run();
}

// ── Разборы ─────────────────────────────────────────────────────────────────
export async function saveAnalysis(
  env: Env, userId: string, opportunityId: string, a: Analysis, demand: unknown, model: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO analyses (opportunity_id,user_id,expectations,uvp,objection,blockers,soft_gaps,demand,reconstructed,model,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(opportunityId, userId, JSON.stringify(a.expectations), a.uvp, JSON.stringify(a.objection),
    JSON.stringify(a.blockers), JSON.stringify([]), JSON.stringify(demand),
    a.reconstructed ? 1 : 0, model, nowIso()).run();
}

export async function getAnalysis(
  env: Env, userId: string, opportunityId: string,
): Promise<{ analysis: Analysis; demand: unknown } | null> {
  const r = await env.DB.prepare('SELECT * FROM analyses WHERE opportunity_id=? AND user_id=?')
    .bind(opportunityId, userId).first<Record<string, unknown>>();
  if (!r) return null;
  return {
    analysis: {
      expectations: j(r.expectations, []), uvp: String(r.uvp ?? ''),
      objection: j(r.objection, null), blockers: j(r.blockers, []),
      score: 0, reconstructed: !!r.reconstructed,
    },
    demand: j(r.demand, {}),
  };
}

// ── Документы ───────────────────────────────────────────────────────────────
export async function saveDocument(
  env: Env, userId: string, opportunityId: string,
  d: { kind: 'resume' | 'letter'; subject?: string; body: string; format_variant?: string;
       facts_used: string[]; checks: unknown; model?: string },
): Promise<string> {
  const prev = await env.DB.prepare(
    'SELECT MAX(version) AS v FROM documents WHERE opportunity_id=? AND kind=?',
  ).bind(opportunityId, d.kind).first<{ v: number | null }>();
  const id = uid();
  await env.DB.prepare(
    `INSERT INTO documents (id,opportunity_id,user_id,kind,version,subject,body,edited_by_user,
      format_variant,facts_used,checks,model,created_at)
     VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?)`,
  ).bind(id, opportunityId, userId, d.kind, (prev?.v ?? 0) + 1, d.subject ?? null, d.body,
    d.format_variant ?? null, JSON.stringify(d.facts_used), JSON.stringify(d.checks),
    d.model ?? null, nowIso()).run();
  return id;
}

export async function latestDocuments(env: Env, userId: string, opportunityId: string) {
  const rows = await env.DB.prepare(
    `SELECT * FROM documents WHERE opportunity_id=? AND user_id=? ORDER BY kind, version DESC`,
  ).bind(opportunityId, userId).all<Record<string, unknown>>();
  const seen = new Set<string>();
  return (rows.results ?? []).filter(r => {
    if (seen.has(String(r.kind))) return false;
    seen.add(String(r.kind));
    return true;
  }).map(r => ({
    id: String(r.id), kind: r.kind as 'resume' | 'letter', version: Number(r.version),
    subject: r.subject as string | null, body: String(r.body),
    edited_by_user: !!r.edited_by_user, format_variant: r.format_variant as string | null,
    facts_used: j<string[]>(r.facts_used, []), checks: j(r.checks, []), created_at: String(r.created_at),
  }));
}

// ── Учёт ────────────────────────────────────────────────────────────────────
export async function usageThisMonth(env: Env, userId: string): Promise<UsageEntry[]> {
  const from = new Date(); from.setUTCDate(1); from.setUTCHours(0, 0, 0, 0);
  const rows = await env.DB.prepare(
    'SELECT * FROM usage_log WHERE user_id=? AND created_at >= ? ORDER BY created_at DESC',
  ).bind(userId, from.toISOString()).all<Record<string, unknown>>();
  return (rows.results ?? []).map(r => ({
    operation: r.operation as UsageEntry['operation'], model: String(r.model),
    tokens_in: Number(r.tokens_in ?? 0), tokens_out: Number(r.tokens_out ?? 0),
    tool_calls: Number(r.tool_calls ?? 0), cost_usd: Number(r.cost_usd ?? 0),
    ok: !!r.ok, created_at: String(r.created_at),
  }));
}

export async function runsToday(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    'SELECT started_at, state FROM runs WHERE user_id=? ORDER BY started_at DESC LIMIT 50',
  ).bind(userId).all<{ started_at: string; state: string }>();
  return rows.results ?? [];
}
