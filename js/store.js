// Авторизация + доступ к данным блокнотов Twin Tasks (много-ко-многим).
//
// Раньше приложение было single-user без входа: задачи лежали в коллекции
// tasks/ верхнего уровня, контекст — в contexts/, теги — в meta/tags.
// Теперь данные каждого блокнота вложены в notebooks/{nid}/… и доступны только
// участникам (Firestore rules). См. модель в js/twin-core.js.
import {
  db, doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where,
  auth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} from './firebase.js';
import {
  makeNotebookId, makeJoinCode, normalizeJoinCode, pickActiveNotebook,
  OWNER, EDITOR, DEFAULT_TAGS,
} from './twin-core.js';

export { normalizeJoinCode };

const ACTIVE_KEY = 'activeNotebookId';

let currentUser = null;
onAuthStateChanged(auth, user => { currentUser = user; });

let firstAuth = null;
export function initAuth() {
  if (!firstAuth) firstAuth = (async () => {
    // Завершаем возможный вход через redirect (мобильные/заблокированные попапы).
    try {
      const res = await getRedirectResult(auth);
      if (res?.user) { currentUser = res.user; await ensureUserDoc(); }
    } catch (e) { console.warn('getRedirectResult:', e?.code || e); }
    return await new Promise(resolve => {
      const off = onAuthStateChanged(auth, user => { off(); currentUser = user; resolve(user); });
    });
  })();
  return firstAuth;
}

export function currentUid() { return currentUser?.uid || null; }
export function currentUserEmail() { return currentUser?.email || ''; }
export function currentUserName() { return currentUser?.displayName || ''; }

// ── Вход/выход ──────────────────────────────────────────────────────────────
// Коды, при которых попап недоступен (мобильные, блокировщики) → уходим в redirect.
const POPUP_FALLBACK = new Set([
  'auth/popup-blocked',
  'auth/cancelled-popup-request',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
]);
// Возвращает cred при успехе попапа или null, если стартовал redirect (страница уйдёт).
export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  try {
    const cred = await signInWithPopup(auth, provider);
    currentUser = cred.user;
    await ensureUserDoc();
    return cred;
  } catch (e) {
    if (POPUP_FALLBACK.has(e?.code)) {
      await signInWithRedirect(auth, provider); // навигация уводит со страницы
      return null;
    }
    throw e;
  }
}
export async function signInEmail(email, pass) {
  const cred = await signInWithEmailAndPassword(auth, email, pass);
  currentUser = cred.user;
  await ensureUserDoc();
  return cred;
}
export async function registerEmail(email, pass) {
  const cred = await createUserWithEmailAndPassword(auth, email, pass);
  currentUser = cred.user;
  await ensureUserDoc();
  return cred;
}
export function signOutUser() { return signOut(auth); }

// Best-effort: создать профиль users/{uid}. НЕ роняем сам вход, если Firestore
// временно недоступен/правила не задеплоены — иначе успешная авторизация
// выглядит как «ошибка входа».
async function ensureUserDoc() {
  const uid = currentUid();
  if (!uid) return;
  try {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        displayName: currentUserName(), email: currentUserEmail(),
        createdAt: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.warn('ensureUserDoc (проверь firestore.rules):', e?.code || e);
  }
}

// ── Мои блокноты (индекс) + активный ────────────────────────────────────────
// Возвращает [{id, name, role, joinedAt}] из users/{uid}/notebooks.
export async function listMyNotebooks() {
  const uid = currentUid();
  if (!uid) return [];
  const snap = await getDocs(collection(db, 'users', uid, 'notebooks'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function getActiveNotebookId() { return localStorage.getItem(ACTIVE_KEY); }
export function setActiveNotebookId(nid) { localStorage.setItem(ACTIVE_KEY, nid); }

// Выбирает валидный активный блокнот из списка (сохранённый/первый/null).
export function resolveActiveNotebook(notebooks) {
  const active = pickActiveNotebook(notebooks, getActiveNotebookId());
  if (active) setActiveNotebookId(active);
  return active;
}

// ── Онбординг: создать блокнот / присоединиться по коду ──────────────────────
// Создаёт блокнот + запись владельца в members + индекс у пользователя +
// дефолтную таксономию тегов в meta/tags. Возвращает id нового блокнота.
export async function createNotebook(name) {
  const uid = currentUid();
  const nid = makeNotebookId(name);
  const now = new Date().toISOString();
  const title = (name || '').trim() || 'Мой блокнот';

  await setDoc(doc(db, 'notebooks', nid), {
    name: title, ownerUid: uid, joinCode: makeJoinCode(), createdAt: now,
  });
  await setDoc(doc(db, 'notebooks', nid, 'members', uid), {
    role: OWNER, addedBy: uid, joinedAt: now,
  });
  await setDoc(doc(db, 'users', uid, 'notebooks', nid), {
    role: OWNER, name: title, joinedAt: now,
  });
  // Дефолтная таксономия тегов нового блокнота.
  await setDoc(doc(db, 'notebooks', nid, 'meta', 'tags'), DEFAULT_TAGS);

  setActiveNotebookId(nid);
  return nid;
}

// Присоединение по коду: находит блокнот, пишет себя в members + индекс.
// Возвращает id блокнота или null, если код не найден.
export async function joinNotebookByCode(rawCode, role = EDITOR) {
  const uid = currentUid();
  const code = normalizeJoinCode(rawCode);
  if (code.length < 4) return null;
  const snap = await getDocs(query(collection(db, 'notebooks'), where('joinCode', '==', code)));
  if (!snap.docs.length) return null;
  const nb = snap.docs[0];
  const now = new Date().toISOString();
  await setDoc(doc(db, 'notebooks', nb.id, 'members', uid), {
    role, addedBy: uid, joinedAt: now,
  });
  await setDoc(doc(db, 'users', uid, 'notebooks', nb.id), {
    role, name: nb.data().name || 'Блокнот', joinedAt: now,
  });
  setActiveNotebookId(nb.id);
  return nb.id;
}

// При первом входе (нет ни одного блокнота) — создать личный и, при наличии,
// перенести legacy-данные (задачи/контекст/теги верхнего уровня) внутрь него.
export async function ensureFirstNotebook() {
  const mine = await listMyNotebooks();
  if (mine.length) return resolveActiveNotebook(mine);
  const nid = await createNotebook('Мой блокнот');
  await migrateLegacyData(nid);
  return getActiveNotebookId();
}

// ── Блокнот: переименование / метаданные ────────────────────────────────────
export async function renameNotebook(nid, name) {
  const uid = currentUid();
  const trimmed = (name || '').trim();
  if (!uid || !trimmed) return;
  await setDoc(doc(db, 'notebooks', nid), { name: trimmed }, { merge: true });
  await setDoc(doc(db, 'users', uid, 'notebooks', nid), { name: trimmed }, { merge: true });
}
export async function getNotebook(nid) {
  const snap = await getDoc(doc(db, 'notebooks', nid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ── Скоуп-хелперы: ссылки на данные активного блокнота ───────────────────────
// Страницы вместо doc(db,'tasks',id) вызывают taskDoc(nid,id) и т.п.
export function tasksCol(nid) { return collection(db, 'notebooks', nid, 'tasks'); }
export function taskDoc(nid, id) { return doc(db, 'notebooks', nid, 'tasks', id); }
export function ctxDoc(nid, name) { return doc(db, 'notebooks', nid, 'contexts', name); }
export function metaDoc(nid, name) { return doc(db, 'notebooks', nid, 'meta', name); }

// ── Разовая миграция legacy-данных (single-user → блокноты) ──────────────────
// Копирует коллекцию tasks/ и документы contexts/*, meta/* верхнего уровня
// внутрь notebooks/{nid}/…. Идемпотентна: ставит маркер meta/_migrated и не
// перезатирает уже перенесённые данные. Best-effort — не роняет вход при
// permission-denied (например, если legacy-коллекции уже закрыты правилами).
export async function migrateLegacyData(nid) {
  try {
    const marker = doc(db, 'notebooks', nid, 'meta', '_migrated');
    if ((await getDoc(marker)).exists()) return;

    // Задачи.
    const taskSnap = await getDocs(collection(db, 'tasks'));
    await Promise.allSettled(taskSnap.docs.map(d =>
      setDoc(doc(db, 'notebooks', nid, 'tasks', d.id), d.data())));

    // Контекст: user + все tag-* документы.
    const ctxSnap = await getDocs(collection(db, 'contexts'));
    await Promise.allSettled(ctxSnap.docs.map(d =>
      setDoc(doc(db, 'notebooks', nid, 'contexts', d.id), d.data())));

    // Мета: теги, настройки уведомлений и прочее (кроме служебного маркера).
    const metaSnap = await getDocs(collection(db, 'meta'));
    await Promise.allSettled(metaSnap.docs
      .filter(d => d.id !== '_migrated')
      .map(d => setDoc(doc(db, 'notebooks', nid, 'meta', d.id), d.data())));

    await setDoc(marker, { at: new Date().toISOString(), tasks: taskSnap.size });
  } catch (e) {
    console.warn('migrateLegacyData:', e?.code || e);
  }
}
