export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  RUNS: Queue;
  APP_ORIGIN: string;
  OPENAI_API_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TOKEN_ENC_KEY: string;
  SESSION_PEPPER: string;
}

/**
 * Единый формат ошибки (§8). Поля объявлены явно, без parameter properties:
 * так файл разбирается любым инструментом, включая `node --strip-types`,
 * и его можно импортировать в тестах ядра без сборки.
 */
export class ApiError extends Error {
  code: string;
  status: number;
  retry_after?: number;
  constructor(code: string, message: string, status = 400, retry_after?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retry_after = retry_after;
  }
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) {
    return json({ error: { code: e.code, message: e.message, retry_after: e.retry_after } }, e.status);
  }
  // Тело ошибки пользователю — без внутренностей; подробности только в логах,
  // и без резюме, писем и адресов (§14 «Логи»).
  console.error('unhandled', e instanceof Error ? e.message : String(e));
  return json({ error: { code: 'internal', message: 'Что-то пошло не так. Попробуйте ещё раз.' } }, 500);
}

export const nowIso = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
