/**
 * Twin AI Proxy Worker
 *
 * Sole job: proxy browser → OpenAI chat completions so the OpenAI key stays a
 * server-side secret instead of shipping in the static site. Every AI feature in
 * the app (chat, classifier, deep research, monthly suggestions, bulk import,
 * onboarding) POSTs to /ai.
 *
 *   POST /ai   — proxy OpenAI chat completions (browser → worker → OpenAI)
 *
 * The old email/Slack intake and Web Push endpoints (plus the hourly cron and
 * all Firestore/JWT/VAPID plumbing) were removed — they were unused/broken and
 * wrote to the legacy root `tasks/`. If intake is ever revived, bring it back as
 * its own worker that writes per-user under apps/twin/users/{uid}/...
 *
 * Required secret (wrangler secret put):
 *   OPENAI_API_KEY
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return cors('', 204, request);
    try {
      if (url.pathname === '/ai') return handleAI(request, env);
      return new Response('Not found', { status: 404 });
    } catch (e) {
      return cors(JSON.stringify({ error: e.message }), 500, request, 'application/json');
    }
  }
};

// ── /ai — OpenAI proxy ──────────────────────────────────────────────────────
async function handleAI(request, env) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const origin = request.headers.get('Origin') || '';
  if (!isAllowedOrigin(origin)) {
    return cors(JSON.stringify({ error: { message: 'Forbidden' } }), 403, request, 'application/json');
  }
  const body = await request.text();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
    body
  });
  return cors(await res.text(), res.status, request, 'application/json');
}

function isAllowedOrigin(origin) {
  // Origin is always present on cross-origin browser POSTs; requiring it blocks
  // headless abuse of the OpenAI key proxy, and hostname parsing prevents the
  // substring bypass (e.g. https://evil-localhost.example).
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' ||
      origin === 'https://natalyatsarapaeva-tech.github.io';
  } catch (_) { return false; }
}

function cors(body, status, request, contentType = 'text/plain') {
  const origin = request?.headers?.get('Origin') || '*';
  return new Response(body || null, {
    status,
    headers: {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
