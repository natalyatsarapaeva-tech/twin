// Бюджет и лимиты (§10.9, §9.2, §12.4).
//
// Перенос приёма из Help_me_clean (`limits-core.js`): решение возвращается ВМЕСТЕ
// с причиной, чтобы интерфейсу было что сказать, а не только с кодом ошибки.
// И второе правило оттуда же: ограничение снимает дорогое действие, но не ломает
// приложение — на 100% бюджета блокируются AI-операции, остальное работает.

import type { Operation, UsageEntry } from './types.ts';
import type { PerimetrConfig, Price } from './config.ts';
import { DEFAULT_CONFIG } from './config.ts';

export type BudgetLevel = 'ok' | 'warn' | 'stop';

export interface BudgetStatus {
  allow: boolean;
  level: BudgetLevel;
  spent: number;
  limit: number;
  share: number;
  /** Причина отказа — идёт в тело 429 и превращается в текст на экране. */
  reason: string | null;
  /** «Хватит примерно на 12 разборов или 30 писем» — понятнее процентов. */
  remaining: { operation: Operation; count: number }[];
}

/** Средняя стоимость операции — для перевода остатка бюджета в понятные единицы (§10.9). */
export const TYPICAL_COST: Partial<Record<Operation, number>> = {
  discover: 0.15,
  analyse: 0.03,
  resume: 0.015,
  letter: 0.01,
  audit: 0.075,
  ingest: 0.005,
  check: 0.003,
  extract: 0.002,
  classify: 0.001,
};

export function monthKey(d: Date | string = new Date()): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function spentInMonth(log: UsageEntry[], month = monthKey()): number {
  return (log || [])
    .filter(e => monthKey(e.created_at) === month)
    .reduce((sum, e) => sum + (e.cost_usd || 0), 0);
}

export function checkBudget(
  log: UsageEntry[],
  cfg: PerimetrConfig = DEFAULT_CONFIG,
  now = new Date(),
): BudgetStatus {
  const limit = cfg.thresholds.monthlyBudgetUsd;
  const spent = Number(spentInMonth(log, monthKey(now)).toFixed(4));
  const share = limit > 0 ? spent / limit : 0;
  const left = Math.max(0, limit - spent);
  const remaining = (['analyse', 'letter', 'resume', 'discover'] as Operation[])
    .map(op => ({ operation: op, count: Math.floor(left / (TYPICAL_COST[op] || 0.01)) }));

  if (share >= 1) {
    return {
      allow: false, level: 'stop', spent, limit, share, remaining,
      reason: `Месячный бюджет $${limit} израсходован. AI-операции остановлены до ${nextMonthLabel(now)}; всё остальное работает.`,
    };
  }
  if (share >= cfg.thresholds.budgetWarnAt) {
    return {
      allow: true, level: 'warn', spent, limit, share, remaining,
      reason: `Потрачено $${spent.toFixed(2)} из $${limit}. Остатка хватит примерно на ${remaining[0].count} разборов или ${remaining[1].count} писем.`,
    };
  }
  return { allow: true, level: 'ok', spent, limit, share, remaining, reason: null };
}

function nextMonthLabel(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return d.toISOString().slice(0, 10);
}

/** Стоимость вызова по токенам (§7 usage_log). Кэшированный вход считается отдельно. */
export function callCost(
  model: string,
  tokens: { in: number; cached_in?: number; out: number; web_search_calls?: number },
  cfg: PerimetrConfig = DEFAULT_CONFIG,
): number {
  const p: Price = cfg.prices[model] ?? { in: 0, cached_in: 0, out: 0 };
  const fresh = Math.max(0, tokens.in - (tokens.cached_in || 0));
  const cost =
    (fresh / 1e6) * p.in +
    ((tokens.cached_in || 0) / 1e6) * p.cached_in +
    (tokens.out / 1e6) * p.out +
    (tokens.web_search_calls || 0) * cfg.webSearchPerCall;
  return Number(cost.toFixed(6));
}

// ── Лимиты прогонов и писем (§9.2, §12.4) ───────────────────────────────────

export interface RateVerdict { allow: boolean; used: number; limit: number; reason: string | null }

function sameDay(a: string, now: Date): boolean {
  return String(a).slice(0, 10) === now.toISOString().slice(0, 10);
}

export function checkRunLimit(
  runsToday: { started_at: string; state: string }[],
  cfg: PerimetrConfig = DEFAULT_CONFIG,
  now = new Date(),
): RateVerdict {
  const today = (runsToday || []).filter(r => sameDay(r.started_at, now));
  const active = today.find(r => r.state === 'queued' || r.state === 'running');
  if (active) {
    return { allow: false, used: today.length, limit: cfg.thresholds.runsPerDay, reason: 'Прогон уже идёт — дождитесь его окончания' };
  }
  if (today.length >= cfg.thresholds.runsPerDay) {
    return { allow: false, used: today.length, limit: cfg.thresholds.runsPerDay, reason: `Сегодня уже ${today.length} прогонов из ${cfg.thresholds.runsPerDay}` };
  }
  return { allow: true, used: today.length, limit: cfg.thresholds.runsPerDay, reason: null };
}

export function checkLetterLimit(
  sentToday: { created_at: string }[],
  cfg: PerimetrConfig = DEFAULT_CONFIG,
  now = new Date(),
): RateVerdict {
  const today = (sentToday || []).filter(x => sameDay(x.created_at, now));
  const limit = cfg.thresholds.lettersPerDay;
  return today.length >= limit
    ? { allow: false, used: today.length, limit, reason: `Лимит ${limit} писем в сутки исчерпан. Холодное обращение работает как персональное письмо; как рассылка — не работает.` }
    : { allow: true, used: today.length, limit, reason: null };
}
