// Роутер воркера (§8). Один домен: perimetr.app отдаёт SPA, /api/* — сюда.
//
// Инварианты всего файла:
//   — user_id берётся ТОЛЬКО из сессии (§15.1), из тела запроса — никогда;
//   — каждая AI-операция сначала спрашивает бюджет (§10.9);
//   — ошибка отвечает единым форматом и никогда не оставляет кнопки навсегда
//     заблокированными (§16).

import {
  checkBudget, checkRunLimit, findDuplicate, reanalyseAfterProfileChange,
  computeScore, coverage, auditProfile, checkResume, checkLetter,
  type Demand, type Opportunity,
} from '@perimetr/core';
import { type Env, ApiError, json, errorResponse, nowIso, uid } from './env.ts';
import { authStart, authCallback, logout, requireSession } from './auth.ts';
import * as db from './store.ts';
import { PROMPT_META, DEFAULT_PROMPTS } from './prompts.ts';
import {
  type Ctx, runAudit, runAnalyse, runIngest, runResume, runLetter, runSwapTest,
  runDiscover, fetchJobPage, formatForCountry,
} from './operations.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
      return await route(request, env, url);
    } catch (e) {
      return errorResponse(e);
    }
  },

  // Consumer очереди прогонов (§9.1).
  async queue(batch: MessageBatch<{ run_id: string; user_id: string }>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try { await executeRun(env, msg.body.run_id, msg.body.user_id); } finally { msg.ack(); }
    }
  },
};

async function ctxFor(env: Env, userId: string): Promise<Ctx> {
  const [cfg, prompts] = await Promise.all([db.loadConfig(env), db.loadPromptOverrides(env)]);
  return { env, cfg, prompts, userId };
}

/** Бюджет спрашивается ПЕРЕД каждой AI-операцией (§10.9). */
async function assertBudget(env: Env, userId: string, ctx: Ctx): Promise<void> {
  const status = checkBudget(await db.usageThisMonth(env, userId), ctx.cfg);
  if (!status.allow) throw new ApiError('budget_exceeded', status.reason ?? 'Бюджет исчерпан', 429);
}

async function body<T>(request: Request): Promise<T> {
  try { return await request.json() as T; } catch { return {} as T; }
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;
  const m = request.method;

  // ── Аутентификация (§8.1) ────────────────────────────────────────────────
  if (p === '/api/auth/start') return authStart(env, url);
  if (p === '/api/auth/callback') return authCallback(env, url);
  if (p === '/api/auth/logout' && m === 'POST') return logout(env, request);

  const userId = await requireSession(env, request);

  if (p === '/api/me') {
    const [user, profile] = await Promise.all([
      env.DB.prepare('SELECT email, name, spreadsheet_id, google_reauth_required FROM users WHERE id=?')
        .bind(userId).first<Record<string, unknown>>(),
      db.getProfile(env, userId),
    ]);
    return json({
      user: { email: user?.email, name: user?.name },
      profile_filled: profile.resume_text.trim().length > 0,
      spreadsheet_url: user?.spreadsheet_id ? `https://docs.google.com/spreadsheets/d/${user.spreadsheet_id}` : null,
      reauth_required: !!user?.google_reauth_required,
    });
  }

  // ── Профиль (§8.2) ───────────────────────────────────────────────────────
  if (p === '/api/profile' && m === 'GET') {
    const [profile, audit, facts] = await Promise.all([
      db.getProfile(env, userId), db.getAudit(env, userId), db.listFacts(env, userId),
    ]);
    return json({ profile, audit, facts });
  }
  if (p === '/api/profile' && m === 'PUT') {
    await db.saveProfile(env, userId, await body(request));
    const profile = await db.getProfile(env, userId);
    // Метрики аудита пересчитываются БЕЗ модели: это арифметика (§10.4a).
    const ctx = await ctxFor(env, userId);
    const facts = await db.listFacts(env, userId);
    const report = auditProfile(profile, facts, ctx.cfg.thresholds);
    await db.saveAudit(env, userId, report);
    return json({ profile, audit: report });
  }
  if (p === '/api/profile/audit' && m === 'POST') {
    const ctx = await ctxFor(env, userId);
    await assertBudget(env, userId, ctx);
    const profile = await db.getProfile(env, userId);
    if (!profile.resume_text.trim()) {
      throw new ApiError('profile_empty', 'Сначала вставьте резюме — аудиту нужен текст', 400);
    }
    const existing = await db.listFacts(env, userId);
    const res = await runAudit(ctx, profile, existing);
    await db.replaceFacts(env, userId, res.facts);
    if (res.roles.length) await db.saveProfile(env, userId, { roles: res.roles });
    await db.saveAudit(env, userId, res.report);
    return json({ audit: res.report, facts: res.facts, degraded: res.degraded });
  }
  if (p === '/api/profile/facts' && m === 'GET') return json(await db.listFacts(env, userId));
  if (p.startsWith('/api/profile/facts/')) {
    const id = p.split('/').pop()!;
    if (m === 'PATCH') { await db.patchFact(env, userId, id, await body(request)); return json({ ok: true }); }
    if (m === 'DELETE') { await db.deleteFact(env, userId, id); return json({ ok: true }); }
  }

  // ── Места (§8.3) ─────────────────────────────────────────────────────────
  if (p === '/api/opportunities' && m === 'GET') {
    return json(await db.listOpportunities(env, userId, {
      status: url.searchParams.get('status') ?? undefined,
      kind: url.searchParams.get('kind') ?? undefined,
    }));
  }
  if (p === '/api/opportunities' && m === 'POST') {
    const b = await body<{ company: string; role_title: string }>(request);
    if (!b.company || !b.role_title) throw new ApiError('bad_request', 'Нужны компания и роль', 400);
    const id = await db.createOpportunity(env, userId, { ...b, origin: 'manual_text', kind: 'hypothesis' });
    return json({ id }, 201);
  }
  if (p === '/api/opportunities/import' && m === 'POST') {
    const ctx = await ctxFor(env, userId);
    await assertBudget(env, userId, ctx);
    const b = await body<{ url?: string; text?: string }>(request);
    const text = b.text?.trim() || (b.url ? await fetchJobPage(b.url) : '');
    if (!text) throw new ApiError('bad_request', 'Нужна ссылка или текст вакансии', 400);
    const res = await runIngest(ctx, text);
    // Дедуп до создания (§10.8): предложить дополнить, а не плодить копии.
    const existing = (await db.listOpportunities(env, userId, {}))
      .map(o => ({ id: o.id, company_key: o.company_key, role_title: o.role_title }));
    const dup = res.parsed.company
      ? findDuplicate({ company: res.parsed.company, role_title: res.parsed.role_title }, existing)
      : null;
    return json({ parsed: res.parsed, demand: res.demand, jd_text: res.jd_text, duplicate_of: dup, source_url: b.url ?? null });
  }
  if (p === '/api/opportunities/import/confirm' && m === 'POST') {
    const b = await body<Record<string, unknown>>(request);
    const parsed = (b.parsed ?? {}) as Record<string, string>;
    if (!parsed.company || !parsed.role_title) throw new ApiError('bad_request', 'Нужны компания и роль', 400);
    // Гипотеза, по которой открылась вакансия: дополняем, а не дублируем (§10.8).
    if (b.duplicate_of) {
      await db.patchOpportunity(env, userId, String(b.duplicate_of), {
        jd_text: String(b.jd_text ?? ''), kind: 'vacancy',
      });
      return json({ id: b.duplicate_of, merged: true });
    }
    const id = await db.createOpportunity(env, userId, {
      company: parsed.company, role_title: parsed.role_title,
      city: parsed.city, country: parsed.country, industry: parsed.industry, size: parsed.size,
      kind: 'vacancy', origin: b.source_url ? 'manual_url' : 'manual_text',
      jd_text: String(b.jd_text ?? ''), source_url: b.source_url ? String(b.source_url) : undefined,
      salary_hint: parsed.salary, contact_email: parsed.contact_email || undefined,
    });
    if (b.demand) await env.KV.put(`demand:${id}`, JSON.stringify(b.demand), { expirationTtl: 60 * 60 * 24 * 365 });
    return json({ id }, 201);
  }

  const oppMatch = p.match(/^\/api\/opportunities\/([\w-]+)(\/[a-z]+)?$/);
  if (oppMatch) {
    const id = oppMatch[1];
    const action = oppMatch[2];
    const opp = await db.getOpportunity(env, userId, id);
    if (!opp) throw new ApiError('not_found', 'Место не найдено', 404);

    if (!action && m === 'GET') {
      const [stored, documents] = await Promise.all([
        db.getAnalysis(env, userId, id), db.latestDocuments(env, userId, id),
      ]);
      const analysis = stored ? { ...stored.analysis, score: computeScore(stored.analysis.expectations) } : null;
      return json({
        opportunity: opp, analysis, documents,
        coverage: analysis ? coverage(analysis.expectations) : null,
      });
    }
    if (!action && m === 'PATCH') {
      const patch = await body<Record<string, unknown>>(request);
      await db.patchOpportunity(env, userId, id, patch);
      // Снятие блокера пересчитывает разбор БЕЗ вызова модели (§8.3, критерий 5b).
      const stored = await db.getAnalysis(env, userId, id);
      if (stored) {
        const [profile, cfg] = await Promise.all([db.getProfile(env, userId), db.loadConfig(env)]);
        const next = reanalyseAfterProfileChange(stored.analysis, stored.demand as Demand, profile, cfg.thresholds);
        await db.saveAnalysis(env, userId, id, next, stored.demand, 'rules-only');
        return json({ ok: true, analysis: { ...next, score: computeScore(next.expectations) } });
      }
      return json({ ok: true });
    }
    if (!action && m === 'DELETE') {
      await db.patchOpportunity(env, userId, id, { status: 'archived' });
      return json({ ok: true });
    }

    if (action === '/analyse' && m === 'POST') {
      const ctx = await ctxFor(env, userId);
      await assertBudget(env, userId, ctx);
      const [profile, facts] = await Promise.all([db.getProfile(env, userId), db.listFacts(env, userId)]);
      const demand = await loadDemand(env, id, opp);
      const res = await runAnalyse(ctx, profile, facts, opp, demand);
      await db.saveAnalysis(env, userId, id, res.analysis, demand, res.model);
      await db.patchOpportunity(env, userId, id, {
        status: 'analysed', score: res.analysis.score,
        hard_blocker: res.analysis.blockers.length ? res.analysis.blockers : null,
      });
      return json({ analysis: res.analysis, coverage: coverage(res.analysis.expectations), degraded: res.degraded });
    }

    if ((action === '/resume' || action === '/letter') && m === 'POST') {
      const ctx = await ctxFor(env, userId);
      await assertBudget(env, userId, ctx);
      const stored = await db.getAnalysis(env, userId, id);
      if (!stored) throw new ApiError('no_analysis', 'Сначала разберите ожидания этого места', 409);
      const [profile, facts] = await Promise.all([db.getProfile(env, userId), db.listFacts(env, userId)]);
      const analysis = { ...stored.analysis, score: computeScore(stored.analysis.expectations) };
      const opts = await body<Record<string, never>>(request);

      if (action === '/resume') {
        const r = await runResume(ctx, profile, facts, opp, analysis, opts);
        const docId = await db.saveDocument(env, userId, id, {
          kind: 'resume', body: JSON.stringify(r.doc), format_variant: r.doc.format_variant,
          facts_used: r.doc.facts_used, checks: r.checks, model: r.model,
        });
        await db.patchOpportunity(env, userId, id, { status: 'drafted' });
        return json({ id: docId, doc: r.doc, checks: r.checks, degraded: r.degraded });
      }

      const l = await runLetter(ctx, profile, facts, opp, analysis, opts);
      // Ни одно письмо не показывается без swap-теста (§10.10, критерий 2 Этапа 2).
      const swap = await runSwapTest(ctx, l.doc.body, opp);
      const checks = [...l.checks, ...swap];
      const docId = await db.saveDocument(env, userId, id, {
        kind: 'letter', subject: l.doc.subject, body: l.doc.body,
        facts_used: l.doc.facts_used, checks, model: l.model,
      });
      await db.patchOpportunity(env, userId, id, { status: 'drafted' });
      return json({ id: docId, doc: l.doc, checks, degraded: l.degraded });
    }
  }

  // ── Документы (§8.4) ─────────────────────────────────────────────────────
  const docMatch = p.match(/^\/api\/documents\/([\w-]+)(\/check)?$/);
  if (docMatch && (m === 'PUT' || m === 'POST')) {
    const docId = docMatch[1];
    const row = await env.DB.prepare('SELECT * FROM documents WHERE id=? AND user_id=?')
      .bind(docId, userId).first<Record<string, unknown>>();
    if (!row) throw new ApiError('not_found', 'Документ не найден', 404);
    const b = await body<{ body?: string; subject?: string }>(request);
    const nextBody = b.body ?? String(row.body);

    const [profile, facts, cfg] = await Promise.all([
      db.getProfile(env, userId), db.listFacts(env, userId), db.loadConfig(env),
    ]);
    const opp = await db.getOpportunity(env, userId, String(row.opportunity_id));
    const stored = await db.getAnalysis(env, userId, String(row.opportunity_id));
    const analysis = stored ? stored.analysis : null;
    // Проверки перезапускаются автоматически после правки (§8.4).
    const checks = row.kind === 'resume'
      ? checkResume(JSON.parse(nextBody), { cfg, facts, profile, analysis })
      : checkLetter(
        { subject: b.subject ?? String(row.subject ?? ''), body: nextBody, word_count: 0, bridge_used: null, facts_used: [], language: 'ru' },
        opp?.kind ?? 'vacancy',
        { cfg, facts, profile, analysis, opportunity: opp ? { company: opp.company, signal: opp.signal, jd_text: opp.jd_text } : null },
      );

    if (m === 'PUT') {
      await env.DB.prepare('UPDATE documents SET body=?, subject=?, edited_by_user=1, checks=? WHERE id=? AND user_id=?')
        .bind(nextBody, b.subject ?? row.subject ?? null, JSON.stringify(checks), docId, userId).run();
    }
    return json({ checks });
  }

  // ── Прогоны (§8.4, §9) ───────────────────────────────────────────────────
  if (p === '/api/runs' && m === 'POST') {
    const cfg = await db.loadConfig(env);
    const limit = checkRunLimit(await db.runsToday(env, userId), cfg);
    if (!limit.allow) throw new ApiError('run_limit', limit.reason ?? 'Лимит прогонов', 429);
    const runId = uid();
    await env.DB.prepare('INSERT INTO runs (id,user_id,state,stage,started_at) VALUES (?,?,?,?,?)')
      .bind(runId, userId, 'queued', 'В очереди', nowIso()).run();
    await env.RUNS.send({ run_id: runId, user_id: userId });
    return json({ run_id: runId }, 202);
  }
  const runMatch = p.match(/^\/api\/runs\/([\w-]+)$/);
  if (runMatch && m === 'GET') {
    const r = await env.DB.prepare('SELECT * FROM runs WHERE id=? AND user_id=?')
      .bind(runMatch[1], userId).first();
    if (!r) throw new ApiError('not_found', 'Прогон не найден', 404);
    return json(r);
  }

  // ── Расходы (§8.6) ───────────────────────────────────────────────────────
  if (p === '/api/usage' && m === 'GET') {
    const [log, cfg] = await Promise.all([db.usageThisMonth(env, userId), db.loadConfig(env)]);
    const byOperation: Record<string, { count: number; cost: number; failed: number }> = {};
    for (const e of log) {
      const agg = byOperation[e.operation] ??= { count: 0, cost: 0, failed: 0 };
      agg.count++; agg.cost += e.cost_usd;
      if (!e.ok) agg.failed++;
    }
    return json({ ...checkBudget(log, cfg), byOperation, failed: log.filter(e => !e.ok).length });
  }

  // ── Конфиг (§10.1 в редакции 1.2) ────────────────────────────────────────
  // Не пользовательская настройка: доступ только владельцу приложения.
  if (p === '/api/admin/config') {
    if (m === 'GET') {
      const cfg = await db.loadConfig(env);
      const prompts = await db.loadPromptOverrides(env);
      return json({ config: cfg, prompts, promptDefaults: DEFAULT_PROMPTS, promptMeta: PROMPT_META });
    }
    if (m === 'PUT') {
      const b = await body<{ key: string; value: unknown }>(request);
      if (!['MODELS', 'THRESHOLDS', 'STOPLIST', 'PROMPTS'].includes(b.key)) {
        throw new ApiError('bad_request', 'Неизвестный ключ конфига', 400);
      }
      await db.saveConfigKey(env, b.key, b.value);
      return json({ ok: true });
    }
  }

  // ── Удаление аккаунта (§15.3) ────────────────────────────────────────────
  if (p === '/api/account/delete' && m === 'POST') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM documents WHERE user_id=?').bind(userId),
      env.DB.prepare('DELETE FROM analyses WHERE user_id=?').bind(userId),
      env.DB.prepare('DELETE FROM opportunities WHERE user_id=?').bind(userId),
      env.DB.prepare('DELETE FROM facts WHERE user_id=?').bind(userId),
      env.DB.prepare('DELETE FROM profiles WHERE user_id=?').bind(userId),
      env.DB.prepare('DELETE FROM usage_log WHERE user_id=?').bind(userId),
      env.DB.prepare('DELETE FROM runs WHERE user_id=?').bind(userId),
      env.DB.prepare('DELETE FROM users WHERE id=?').bind(userId),
    ]);
    // Google-таблица НЕ удаляется: она принадлежит пользователю (§15.3).
    return logout(env, request);
  }

  throw new ApiError('not_found', 'Неизвестный маршрут', 404);
}

/** Требования места: из ingest (KV) либо реконструкция по стране (§10.4). */
async function loadDemand(env: Env, oppId: string, opp: Opportunity): Promise<Demand> {
  const raw = await env.KV.get(`demand:${oppId}`);
  if (raw) { try { return JSON.parse(raw) as Demand; } catch { /* ниже */ } }
  return { country: opp.country ?? null };
}

// ── Фоновый прогон (§9.1) ───────────────────────────────────────────────────
const STAGES = [
  'Формирую поисковые запросы',
  'Ищу открытые вакансии',
  'Ищу компании с сигналами',
  'Проверяю на дубли',
  'Записываю в таблицу',
];

async function setStage(env: Env, runId: string, stage: string): Promise<void> {
  await env.DB.prepare('UPDATE runs SET state=?, stage=? WHERE id=?').bind('running', stage, runId).run();
}

async function executeRun(env: Env, runId: string, userId: string): Promise<void> {
  try {
    const ctx = await ctxFor(env, userId);
    const profile = await db.getProfile(env, userId);
    await setStage(env, runId, STAGES[0]);

    const existing = await db.listOpportunities(env, userId, {});
    await setStage(env, runId, STAGES[1]);
    const found = await runDiscover(ctx, profile, existing.map(o => o.company), 8);

    await setStage(env, runId, STAGES[3]);
    const index = existing.map(o => ({ id: o.id, company_key: o.company_key, role_title: o.role_title }));
    let added = 0;
    for (const item of found) {
      if (!item) continue;
      if (findDuplicate({ company: item.company, role_title: item.role_title }, index)) continue;
      const id = await db.createOpportunity(env, userId, {
        company: item.company, role_title: item.role_title, kind: item.kind,
        origin: 'discovered', industry: item.industry, city: item.city, country: item.country,
        size: item.size, website: item.website, signal: item.signal,
        source_url: item.source_url, source_date: item.signal_date,
        contact_name: item.contact?.name || undefined,
        contact_title: item.contact?.title || undefined,
        contact_linkedin: item.contact?.linkedin || undefined,
      });
      index.push({ id, company_key: item.company, role_title: item.role_title });
      added++;
    }
    await env.DB.prepare('UPDATE runs SET state=?, stage=?, found=?, added=?, finished_at=? WHERE id=?')
      .bind('done', 'Готово', found.length, added, nowIso(), runId).run();
  } catch (e) {
    await env.DB.prepare('UPDATE runs SET state=?, error=?, finished_at=? WHERE id=?')
      .bind('failed', e instanceof Error ? e.message : 'Прогон не удался', nowIso(), runId).run();
  }
}
