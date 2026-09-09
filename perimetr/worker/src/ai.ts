// Контракт вызова модели — один на все операции (§10.2 в редакции 1.2).
//
//   callModel → schema → parse → retry(1) → sanitize → validate → log(usage)
//
// Здесь живут первые четыре ступени и учёт; sanitize/validate — чистые функции
// из @perimetr/core, потому что их гоняют тесты без сети.
//
// Правила ТЗ, реализованные буквально:
//   §10.2  только Responses API со Structured Outputs, strict: true
//   §10.2  профиль в начале промпта и неизменен между вызовами → кэш входа
//   §10.2  store: false — история не хранится на стороне OpenAI
//   §10.2  таймаут 120 с, AbortController обязателен
//   §10.1  429/503 → 3 попытки с задержкой 2/8/20 с → модель ступенью ниже
//   §16    невалидный JSON → один повтор с уточнением схемы
//   §4.3.2 неудачные вызовы тоже пишутся в usage_log

import {
  type PerimetrConfig, type Operation, callCost, degradeModel, modelFor, parseJsonObject,
} from '@perimetr/core';
import { type Env, ApiError, nowIso, uid } from './env.ts';

const TIMEOUT_MS = 120_000;
const BACKOFF_MS = [2_000, 8_000, 20_000];

export interface CallOptions {
  operation: Operation;
  /** Стабильный префикс промпта (профиль, банк фактов) — кэшируется. */
  prefix: string;
  /** Переменная часть: место, вакансия, указатели классификатора. */
  instruction: string;
  schema: { name: string; schema: Record<string, unknown> };
  temperature?: number;
  maxOutputTokens?: number;
  webSearch?: boolean;
}

export interface CallResult<T> {
  data: Partial<T>;
  model: string;
  /** Пришлось деградировать на младшую модель — видно на карточке (§13.2). */
  degraded: boolean;
  cost_usd: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function callModel<T>(
  env: Env, cfg: PerimetrConfig, userId: string, opts: CallOptions,
): Promise<CallResult<T>> {
  let model = modelFor(cfg, opts.operation);
  let degraded = false;

  for (let attempt = 0; ; attempt++) {
    try {
      const { text, usage } = await once(env, model, opts, /* remindSchema */ false);
      let data = parseJsonObject<T>(text);

      // Ровно один повтор при невалидном JSON, с уточнением схемы (§16).
      if (!Object.keys(data).length) {
        const retry = await once(env, model, opts, true);
        data = parseJsonObject<T>(retry.text);
        usage.tokens_in += retry.usage.tokens_in;
        usage.tokens_out += retry.usage.tokens_out;
        if (!Object.keys(data).length) {
          await logUsage(env, userId, opts.operation, model, usage, cfg, false, 'invalid_json');
          throw new ApiError('model_invalid_json', 'Модель вернула ответ, который не удалось разобрать. Попробуйте ещё раз.', 502);
        }
      }

      const cost = await logUsage(env, userId, opts.operation, model, usage, cfg, true);
      return { data, model, degraded, cost_usd: cost };
    } catch (e) {
      const transient = e instanceof TransientError;
      if (!transient) throw e;

      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      // Попытки исчерпаны — ступень ниже (§10.1).
      const lower = degradeModel(cfg, model);
      if (lower && !degraded) {
        model = lower;
        degraded = true;
        continue;
      }
      await logUsage(env, userId, opts.operation, model,
        { tokens_in: 0, tokens_out: 0, tool_calls: 0 }, cfg, false, e.message);
      throw new ApiError('openai_rate_limited', 'Модель сейчас перегружена. Попробуйте через минуту.', 503, 60);
    }
  }
}

class TransientError extends Error {}

interface RawUsage { tokens_in: number; tokens_out: number; tool_calls: number; cached_in?: number }

async function once(
  env: Env, model: string, opts: CallOptions, remindSchema: boolean,
): Promise<{ text: string; usage: RawUsage }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      model,
      // Профиль первым и неизменным блоком — на нём работает кэш входа (§10.2).
      input: [
        { role: 'system', content: opts.prefix },
        {
          role: 'user',
          content: remindSchema
            ? `${opts.instruction}\n\nОТВЕТ — СТРОГО ОДИН JSON-объект по схеме «${opts.schema.name}». Без markdown, без пояснений.`
            : opts.instruction,
        },
      ],
      text: {
        format: { type: 'json_schema', name: opts.schema.name, schema: opts.schema.schema, strict: true },
      },
      temperature: opts.temperature ?? 0.2,
      max_output_tokens: opts.maxOutputTokens ?? 4000,
      store: false,
    };
    if (opts.webSearch) body.tools = [{ type: 'web_search' }];

    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (res.status === 429 || res.status === 503 || res.status === 500) {
      throw new TransientError(`openai_${res.status}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ApiError('openai_error', 'Сервис модели ответил ошибкой', 502, undefined);
      // detail намеренно не попадает пользователю и не логируется целиком:
      // в нём может оказаться кусок промпта, то есть резюме (§14 «Логи»).
    }
    const data = await res.json() as {
      output_text?: string;
      output?: { content?: { text?: string }[] }[];
      usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    };
    const text = data.output_text
      ?? data.output?.flatMap(o => o.content ?? []).map(c => c.text ?? '').join('')
      ?? '';
    return {
      text,
      usage: {
        tokens_in: data.usage?.input_tokens ?? 0,
        tokens_out: data.usage?.output_tokens ?? 0,
        cached_in: data.usage?.input_tokens_details?.cached_tokens ?? 0,
        tool_calls: opts.webSearch ? 1 : 0,
      },
    };
  } catch (e) {
    if (e instanceof ApiError || e instanceof TransientError) throw e;
    if ((e as Error).name === 'AbortError') throw new TransientError('timeout');
    throw new TransientError((e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

async function logUsage(
  env: Env, userId: string, operation: Operation, model: string,
  usage: RawUsage, cfg: PerimetrConfig, ok: boolean, error?: string,
): Promise<number> {
  const cost = callCost(model, {
    in: usage.tokens_in, cached_in: usage.cached_in, out: usage.tokens_out,
    web_search_calls: usage.tool_calls,
  }, cfg);
  await env.DB.prepare(
    `INSERT INTO usage_log (id, user_id, operation, model, tokens_in, tokens_out, tool_calls, cost_usd, ok, error, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(uid(), userId, operation, model, usage.tokens_in, usage.tokens_out,
    usage.tool_calls, cost, ok ? 1 : 0, error ?? null, nowIso()).run();
  return cost;
}

/**
 * Пул с ограничением параллелизма (§9.1 в редакции 1.2).
 * Шесть веб-запросов последовательно не укладываются в p95 < 180 с (§14), а
 * шесть одновременно ловят 429. Величина — из конфига, не из литерала.
 */
export async function mapWithConcurrency<T, R>(
  items: T[], limit: number, fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
