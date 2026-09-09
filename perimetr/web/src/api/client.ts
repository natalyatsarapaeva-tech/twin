// Клиент API воркера. Мутирующие запросы несут CSRF-заголовок из
// non-HttpOnly cookie (double submit, §5.3).

import type { Api } from './types.ts';

function csrf(): string {
  const hit = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('csrf='));
  return hit ? hit.slice(5) : '';
}

export class ApiFailure extends Error {
  code: string;
  retryAfter?: number;
  constructor(code: string, message: string, retryAfter?: number) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const res = await fetch(`/api${path}`, {
    ...init,
    method,
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(['GET', 'HEAD'].includes(method) ? {} : { 'X-Perimetr-CSRF': csrf() }),
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string; retry_after?: number } }).error;
    throw new ApiFailure(e?.code ?? 'unknown', e?.message ?? 'Что-то пошло не так', e?.retry_after);
  }
  return data as T;
}

const post = <T>(p: string, body?: unknown) =>
  call<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined });

export const httpApi: Api = {
  me: () => call('/me'),
  getProfile: () => call('/profile'),
  saveProfile: patch => call('/profile', { method: 'PUT', body: JSON.stringify(patch) }),
  runAudit: () => post('/profile/audit'),
  patchFact: (id, patch) => call(`/profile/facts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteFact: id => call(`/profile/facts/${id}`, { method: 'DELETE' }),
  listOpportunities: () => call('/opportunities'),
  getOpportunity: id => call(`/opportunities/${id}`),
  patchOpportunity: (id, patch) => call(`/opportunities/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  archiveOpportunity: id => call(`/opportunities/${id}`, { method: 'DELETE' }),
  importJob: input => post('/opportunities/import', input),
  confirmImport: r => post('/opportunities/import/confirm', r),
  analyse: id => post(`/opportunities/${id}/analyse`),
  makeResume: id => post(`/opportunities/${id}/resume`),
  makeLetter: (id, tone) => post(`/opportunities/${id}/letter`, { tone }),
  saveDocument: (id, patch) => call(`/documents/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  startRun: () => post('/runs'),
  getRun: id => call(`/runs/${id}`),
  usage: () => call('/usage'),
};
