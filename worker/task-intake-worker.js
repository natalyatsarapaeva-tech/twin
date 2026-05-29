/**
 * Twin Task Intake Worker
 * Endpoints:
 *   POST /ai              — proxy OpenAI chat completions (browser → worker → OpenAI)
 *   POST /email           — Postmark inbound webhook → GPT → Firestore
 *   POST /slack           — Slack slash command /task → GPT → Firestore
 *   POST /test            — manual test task creation
 *   POST /push/subscribe  — store a Web Push subscription in Firestore
 *   POST /push/unsubscribe— remove a Web Push subscription
 *
 * Cron (every hour):
 *   Checks meta/notificationSettings, sends Web Push to all subscribers
 *   when a notification type's scheduled hour/day matches Stockholm time.
 *
 * Required secrets (wrangler secret put):
 *   OPENAI_API_KEY
 *   FIREBASE_PROJECT_ID      (natas-kitchen)
 *   FIREBASE_CLIENT_EMAIL    (service account)
 *   FIREBASE_PRIVATE_KEY     (full PEM)
 *   ALLOWED_SENDERS          (comma-separated emails for /email)
 *   POSTMARK_WEBHOOK_TOKEN   (optional)
 *   SLACK_SIGNING_SECRET     (optional)
 *   VAPID_PUBLIC_KEY         (base64url EC P-256 uncompressed point)
 *   VAPID_PRIVATE_KEY        (base64url PKCS8 EC P-256 private key)
 *   VAPID_SUBJECT            (mailto: contact, optional)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return cors('', 204, request);
    try {
      if (url.pathname === '/ai')               return handleAI(request, env);
      if (url.pathname === '/email')            return handleEmail(request, env);
      if (url.pathname === '/slack')            return handleSlack(request, env, ctx);
      if (url.pathname === '/test')             return handleTest(request, env);
      if (url.pathname === '/push/subscribe')   return handlePushSubscribe(request, env);
      if (url.pathname === '/push/unsubscribe') return handlePushUnsubscribe(request, env);
      return new Response('Not found', { status: 404 });
    } catch (e) {
      return cors(JSON.stringify({ error: e.message }), 500, request, 'application/json');
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAndSendNotifications(env));
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
  const ackResponse = new Response(
    JSON.stringify({ response_type: 'ephemeral', text: '⏳ Creating task…' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  ctx.waitUntil((async () => {
    const task = await parseTask(text, env);
    task.source = 'slack';
    await saveTask(task, env);
    if (responseUrl) {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_type: 'in_channel', text: `✅ Task created: *${task.title}*` })
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

// ── /push/subscribe ─────────────────────────────────────────────────────────
async function handlePushSubscribe(request, env) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const { deviceId, subscription } = await request.json();
  if (!deviceId || !subscription?.endpoint) {
    return cors('{"error":"missing fields"}', 400, request, 'application/json');
  }
  const token = await getFirebaseToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/pushSubscriptions/${deviceId}`;
  await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ fields: {
      endpoint: { stringValue: subscription.endpoint },
      p256dh:   { stringValue: subscription.keys?.p256dh || '' },
      auth:     { stringValue: subscription.keys?.auth || '' },
      createdAt:{ stringValue: new Date().toISOString() }
    }})
  });
  return cors('{"ok":true}', 200, request, 'application/json');
}

// ── /push/unsubscribe ────────────────────────────────────────────────────────
async function handlePushUnsubscribe(request, env) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const { deviceId } = await request.json();
  if (!deviceId) return cors('{"error":"missing deviceId"}', 400, request, 'application/json');
  const token = await getFirebaseToken(env);
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/pushSubscriptions/${deviceId}`,
    { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }
  );
  return cors('{"ok":true}', 200, request, 'application/json');
}

// ── Cron: check schedule and send push notifications ─────────────────────────
async function checkAndSendNotifications(env) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return;
  const token = await getFirebaseToken(env);

  const settingsDoc = await getFirestoreDoc('meta/notificationSettings', token, env);
  if (!settingsDoc) return;
  const settings = parseFirestoreDoc(settingsDoc);

  const { hour: currentHour, day: currentDay } = stockholmHourDay();

  const typesToSend = [];
  for (const type of ['todayTasks', 'weekAhead', 'weeklyReview']) {
    const cfg = settings[type];
    if (!cfg) continue;
    if (cfg.enabled && cfg.hour === currentHour && (cfg.days || []).includes(currentDay)) {
      typesToSend.push(type);
    }
  }
  if (!typesToSend.length) return;

  const subsData = await listFirestoreDocs('pushSubscriptions', token, env);
  if (!subsData.documents?.length) return;

  const tasksData = await listFirestoreDocs('tasks', token, env);
  const tasks = (tasksData.documents || []).map(parseFirestoreDoc);

  for (const type of typesToSend) {
    const notif = await buildNotification(type, tasks, env);
    if (!notif) continue;
    for (const subDoc of subsData.documents) {
      const f = subDoc.fields || {};
      const sub = {
        endpoint: f.endpoint?.stringValue || '',
        keys: { p256dh: f.p256dh?.stringValue || '', auth: f.auth?.stringValue || '' }
      };
      if (!sub.endpoint) continue;
      const result = await sendWebPush(sub, notif, env).catch(e => ({ status: 500 }));
      // Expired subscription — clean up
      if (result?.status === 410 || result?.status === 404) {
        const deviceId = subDoc.name.split('/').pop();
        await fetch(
          `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/pushSubscriptions/${deviceId}`,
          { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }
        ).catch(() => {});
      }
    }
  }
}

function stockholmHourDay() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Stockholm', hour: 'numeric', weekday: 'short', hourCycle: 'h23'
  }).formatToParts(new Date());
  const hour = Number(parts.find(p => p.type === 'hour').value);
  const dayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  const day = dayMap[parts.find(p => p.type === 'weekday').value] ?? 0;
  return { hour, day };
}

async function buildNotification(type, tasks, env) {
  const today = new Date().toISOString().split('T')[0];

  if (type === 'todayTasks') {
    const active = tasks.filter(t => t.status !== 'done');
    const due     = active.filter(t => t.nextAction === today || t.deadline === today);
    const overdue = active.filter(t => t.deadline && t.deadline < today);
    if (!due.length && !overdue.length) return null;
    const parts = [];
    if (due.length)     parts.push(`${due.length} task${due.length > 1 ? 's' : ''} for today`);
    if (overdue.length) parts.push(`${overdue.length} overdue`);
    return { title: 'Twin — Today', body: parts.join(' · '), url: './index.html?filter=today', tag: 'twin-today' };
  }

  if (type === 'weekAhead') {
    const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    const upcoming = tasks.filter(t =>
      t.status !== 'done' && t.nextAction && t.nextAction >= today && t.nextAction <= weekEndStr
    );
    if (!upcoming.length) return null;
    const names = upcoming.slice(0, 3).map(t => t.title).join(', ');
    const more  = upcoming.length > 3 ? ` +${upcoming.length - 3} more` : '';
    return {
      title: `Twin — ${upcoming.length} task${upcoming.length > 1 ? 's' : ''} this week`,
      body: names + more, url: './index.html', tag: 'twin-week'
    };
  }

  if (type === 'weeklyReview') {
    const week = 7 * 24 * 3600 * 1000;
    const done   = tasks.filter(t => t.status === 'done' && t.doneAt && new Date(t.doneAt) >= new Date(Date.now() - week));
    const active = tasks.filter(t => t.status !== 'done').slice(0, 10);
    const prompt = `2-sentence weekly review. Completed this week: ${done.map(t => t.title).join(', ') || 'nothing'}. Active tasks: ${active.map(t => t.title).join(', ')}. What was achieved and what's the main focus ahead?`;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o', max_tokens: 120, temperature: 0.7, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await res.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || 'Your weekly summary is ready.';
    return { title: 'Twin — Weekly Review', body: summary, url: './index.html', tag: 'twin-review' };
  }

  return null;
}

// ── Web Push: VAPID JWT + RFC 8291 aes128gcm encryption ──────────────────────
async function sendWebPush(subscription, notification, env) {
  const endpoint = subscription.endpoint;
  const audience = new URL(endpoint).origin;
  const jwt = await buildVapidJwt(audience, env);
  const payload = JSON.stringify({
    title: notification.title, body: notification.body,
    url: notification.url, tag: notification.tag
  });
  const encrypted = await encryptPayload(subscription, payload);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400'
    },
    body: encrypted
  });
  return { status: res.status };
}

async function buildVapidJwt(audience, env) {
  const now = Math.floor(Date.now() / 1000);
  const b64url = obj => btoa(JSON.stringify(obj)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const data = `${b64url({ typ:'JWT', alg:'ES256' })}.${b64url({ aud: audience, exp: now + 43200, sub: env.VAPID_SUBJECT || 'mailto:natalya.tsarapaeva@gmail.com' })}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', b64urlDecode(env.VAPID_PRIVATE_KEY).buffer,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(data));
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return `${data}.${sig64}`;
}

async function encryptPayload(subscription, plaintext) {
  const recipientPub = b64urlDecode(subscription.keys.p256dh);
  const authSecret   = b64urlDecode(subscription.keys.auth);

  const recipientKey = await crypto.subtle.importKey(
    'raw', recipientPub.buffer, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const ephemeralPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: recipientKey }, ephemeral.privateKey, 256)
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const hmac = async (key, data) => {
    const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
  };
  const cat = (...arrs) => {
    const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
    let i = 0; for (const a of arrs) { out.set(a, i); i += a.length; }
    return out;
  };
  const enc = s => new TextEncoder().encode(s);

  // RFC 8291 HKDF — two-step derivation using auth secret then content salt
  const prk  = await hmac(authSecret, sharedSecret);
  const ikm  = await hmac(prk,  cat(enc('WebPush: info\x00'), recipientPub, ephemeralPubRaw, new Uint8Array([1])));
  const prk2 = await hmac(salt, ikm);
  const cek  = (await hmac(prk2, cat(enc('Content-Encoding: aes128gcm\x00'), new Uint8Array([1])))).slice(0, 16);
  const iv   = (await hmac(prk2, cat(enc('Content-Encoding: nonce\x00'),     new Uint8Array([1])))).slice(0, 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 }, aesKey,
    cat(enc(plaintext), new Uint8Array([2])) // 0x02 = last record delimiter
  ));

  // Content header: salt(16) + rs(uint32be 4096) + keyid_len(1=65) + keyid(65) + ciphertext
  return cat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([65]), ephemeralPubRaw, ciphertext);
}

function b64urlDecode(str) {
  const b64 = (str + '==='.slice((str.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// ── Firestore REST helpers ───────────────────────────────────────────────────
async function getFirestoreDoc(path, token, env) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  return res.ok ? res.json() : null;
}

async function listFirestoreDocs(collection, token, env) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  return res.ok ? res.json() : {};
}

function parseFirestoreDoc(doc) {
  const obj = {};
  for (const [k, v] of Object.entries(doc.fields || {})) obj[k] = parseFirestoreVal(v);
  return obj;
}

function parseFirestoreVal(v) {
  if ('nullValue'    in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('stringValue'  in v) return v.stringValue;
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(parseFirestoreVal);
  if ('mapValue'     in v) return parseFirestoreDoc(v.mapValue);
  return null;
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
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
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
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/tasks/${task.id}`;
  const fields = {};
  for (const [k, v] of Object.entries(task)) fields[k] = firestoreValue(v);
  await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ fields })
  });
}

function firestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return { integerValue: v };
  if (typeof v === 'string')  return { stringValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(firestoreValue) } };
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
  const b64url = obj => btoa(JSON.stringify(obj)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const data = `${b64url({ alg:'RS256', typ:'JWT' })}.${b64url({
    iss: env.FIREBASE_CLIENT_EMAIL, sub: env.FIREBASE_CLIENT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore'
  })}`;

  const pem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
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
