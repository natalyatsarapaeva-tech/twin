/**
 * Twin Task Intake Worker
 * Endpoints:
 *   POST /ai     — proxy OpenAI chat completions (browser → worker → OpenAI)
 *   POST /email  — Postmark inbound webhook → GPT → Firestore
 *   POST /slack  — Slack slash command /task → GPT → Firestore
 *   POST /test   — manual test task creation
 *
 * Required secrets (wrangler secret put):
 *   OPENAI_API_KEY
 *   FIREBASE_PROJECT_ID      (natas-kitchen)
 *   FIREBASE_CLIENT_EMAIL    (service account)
 *   FIREBASE_PRIVATE_KEY     (full PEM)
 *   ALLOWED_SENDERS          (comma-separated emails for /email)
 *   POSTMARK_WEBHOOK_TOKEN   (optional)
 *   SLACK_SIGNING_SECRET     (optional)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return cors('', 204, request);

    try {
      if (url.pathname === '/ai')    return handleAI(request, env);
      if (url.pathname === '/email') return handleEmail(request, env);
      if (url.pathname === '/slack') return handleSlack(request, env, ctx);
      if (url.pathname === '/test')  return handleTest(request, env);
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
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`
    },
    body
  });

  return cors(await res.text(), res.status, request, 'application/json');
}

function isAllowedOrigin(origin) {
  return !origin ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1') ||
    origin === 'https://natalyatsarapaeva-tech.github.io';
}

// ── /email — Postmark inbound ───────────────────────────────────────────────
async function handleEmail(request, env) {
  const body = await request.json();

  if (env.POSTMARK_WEBHOOK_TOKEN && body.Token !== env.POSTMARK_WEBHOOK_TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }

  const from = (body.FromFull?.Email || body.From || '').toLowerCase();
  const allowed = (env.ALLOWED_SENDERS || '').split(',').map(s => s.trim().toLowerCase());
  if (!allowed.includes(from)) return new Response('Sender not allowed', { status: 403 });

  const subject = body.Subject || '';
  const text = body.TextBody || body.StrippedTextReply || '';
  const task = await parseTask(`Subject: ${subject}\n\n${text}`, env);
  task.source = 'email';
  await saveTask(task, env);

  return new Response('OK', { status: 200 });
}

// ── /slack — slash command ──────────────────────────────────────────────────
async function handleSlack(request, env, ctx) {
  const body = await request.text();
  const params = new URLSearchParams(body);
  const text = params.get('text') || '';
  const responseUrl = params.get('response_url');

  // Ack immediately — Slack requires a response within 3 seconds
  const ackResponse = new Response(
    JSON.stringify({ response_type: 'ephemeral', text: '⏳ Creating task…' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  // Use ctx.waitUntil so the worker stays alive for GPT + Firestore after ack
  ctx.waitUntil((async () => {
    const task = await parseTask(text, env);
    task.source = 'slack';
    await saveTask(task, env);
    if (responseUrl) {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response_type: 'in_channel',
          text: `✅ Task created: *${task.title}*`
        })
      });
    }
  })());

  return ackResponse;
}

// ── /test ───────────────────────────────────────────────────────────────────
async function handleTest(request, env) {
  const body = await request.json().catch(() => ({}));
  const text = body.text || 'Test task from worker';
  const task = await parseTask(text, env);
  task.source = 'test';
  await saveTask(task, env);
  return new Response(JSON.stringify({ ok: true, task }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// ── GPT task parser ─────────────────────────────────────────────────────────
async function loadTagIds(env) {
  try {
    const token = await getFirebaseToken(env);
    const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/meta/tags`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    const extractIds = arr => (arr?.values || []).map(v => v.mapValue?.fields?.id?.stringValue).filter(Boolean);
    return [
      ...extractIds(data.fields?.work?.arrayValue),
      ...extractIds(data.fields?.personal?.arrayValue)
    ];
  } catch(e) {
    return ['dev','strategy','analytics','clients','leads','ux','kids','health','urgent','ideas','money','home','travel','rest','swedish'];
  }
}

async function parseTask(text, env) {
  const today = new Date().toISOString().split('T')[0];
  const tagIds = await loadTagIds(env);
  const prompt = `Extract a task from this text. Return ONLY JSON (no markdown):
{
  "title": "concise action title in English",
  "description": "details if any",
  "priority": "high|med|low|none",
  "deadline": "YYYY-MM-DD or null",
  "tags": ["one or two from: ${tagIds.join(',')}"],
  "status": "new"
}
Today: ${today}
Text: ${text}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({ model: 'gpt-4o', max_tokens: 300, temperature: 0, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await res.json();
  const raw = data.choices[0].message.content.trim()
    .replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
  const task = JSON.parse(raw);

  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return { id, ...task, subtasks: [], notes: '', createdAt: new Date().toISOString() };
}

// ── Firestore REST save ─────────────────────────────────────────────────────
async function saveTask(task, env) {
  const token = await getFirebaseToken(env);
  const project = env.FIREBASE_PROJECT_ID;
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/tasks/${task.id}`;

  const fields = {};
  for (const [k, v] of Object.entries(task)) {
    fields[k] = firestoreValue(v);
  }

  await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ fields })
  });
}

function firestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(firestoreValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = firestoreValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

// ── Firebase JWT auth ───────────────────────────────────────────────────────
async function getFirebaseToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    sub: env.FIREBASE_CLIENT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore'
  };

  const b64url = obj => btoa(JSON.stringify(obj))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const data = `${b64url(header)}.${b64url(payload)}`;

  const pem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${data}.${sig64}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const { access_token } = await tokenRes.json();
  return access_token;
}

// ── CORS helper ─────────────────────────────────────────────────────────────
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
