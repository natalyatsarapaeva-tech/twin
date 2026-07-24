// Чистая логика «Блокнотов» Twin Tasks (без Firebase — тестируется в Node).
//
// Блокнот (Notebook) — это отдельный каталог задач со своей таксономией тегов
// и AI-контекстом. У пользователя может быть несколько блокнотов, в любой можно
// пригласить других людей по коду (много-ко-многим).
//
// Модель Firestore:
//   users/{uid}                     — профиль {displayName, email, createdAt}
//   users/{uid}/notebooks/{nid}     — индекс «мои блокноты» {role, name, joinedAt}
//   notebooks/{nid}                 — {name, ownerUid, joinCode, createdAt}
//   notebooks/{nid}/members/{uid}   — источник прав {role, addedBy, joinedAt}
//   notebooks/{nid}/tasks/{id}      — задачи (раньше — коллекция tasks/ верхнего уровня)
//   notebooks/{nid}/contexts/*      — user | tag-* (раньше — contexts/)
//   notebooks/{nid}/meta/*          — tags | notificationSettings (раньше — meta/)
// Роли MVP: owner | editor (viewer — отдельная волна).

// ── Роли ──────────────────────────────────────────────────────────────────
export const ROLES = ['owner', 'editor'];
export const OWNER = 'owner';
export const EDITOR = 'editor';

export function isValidRole(role) { return ROLES.includes(role); }
// Может править задачи/теги/контекст (owner и editor).
export function canEditTasks(role) { return role === OWNER || role === EDITOR; }
// Может управлять участниками и удалять блокнот (только владелец).
export function canManageNotebook(role) { return role === OWNER; }

// ── Коды присоединения ──────────────────────────────────────────────────────
// 6 символов без визуально похожих (I/L/O/0/1).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeJoinCode(rand = Math.random) {
  return Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)]).join('');
}
export function normalizeJoinCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ── Идентификаторы ──────────────────────────────────────────────────────────
// Id блокнота: слаг имени + случайный хвост (уникальность без счётчиков).
export function makeNotebookId(name, rand = Math.random) {
  const slug = String(name || 'notebook').toLowerCase()
    .replace(/[^а-яёa-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'notebook';
  return `${slug}-${Math.floor(rand() * 1e9).toString(36)}`;
}

// ── Активный блокнот ────────────────────────────────────────────────────────
// Выбирает валидный активный блокнот: сохранённый, если он ещё в списке;
// иначе первый; иначе null. `notebooks` — массив {id, ...}.
export function pickActiveNotebook(notebooks, savedId) {
  if (!Array.isArray(notebooks) || notebooks.length === 0) return null;
  if (savedId && notebooks.some(n => n.id === savedId)) return savedId;
  return notebooks[0].id;
}

// ── Таксономия тегов по умолчанию для нового блокнота ────────────────────────
// Совпадает с DEFAULT_TAGS, зашитыми в HTML-страницах, — чтобы новый блокнот
// сразу имел рабочий набор тегов work/personal.
export const DEFAULT_TAGS = {
  work: [
    { id: 'dev', label: 'Dev', emoji: '💻' }, { id: 'strategy', label: 'Strategy', emoji: '🎯' },
    { id: 'analytics', label: 'Analytics', emoji: '📊' }, { id: 'clients', label: 'Clients', emoji: '🤝' },
    { id: 'leads', label: 'Leads', emoji: '📣' }, { id: 'ux', label: 'UX', emoji: '🎨' },
  ],
  personal: [
    { id: 'kids', label: 'Kids', emoji: '👶' }, { id: 'health', label: 'Health', emoji: '💚' },
    { id: 'urgent', label: 'Urgent', emoji: '🚨' }, { id: 'ideas', label: 'Ideas', emoji: '💡' },
    { id: 'money', label: 'Money', emoji: '💰' }, { id: 'home', label: 'Home', emoji: '🏠' },
    { id: 'travel', label: 'Travel', emoji: '✈️' }, { id: 'rest', label: 'Rest', emoji: '🌊' },
    { id: 'swedish', label: 'Swedish', emoji: '🇸🇪' },
  ],
};
