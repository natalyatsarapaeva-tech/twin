// store.js — Firebase init + Google auth gate + per-user Firestore namespacing.
//
// Imported as an ES module by every page. Replaces the per-file Firebase config
// block. All app data lives under  apps/twin/users/{uid}/...  — a top-level
// app namespace (APP_ROOT) so Twin is fully isolated inside the shared
// `natas-kitchen` Firebase project, and then a per-user subtree so each Google
// account gets its own isolated store.
//
// The trick: the pages keep calling collection(db,'tasks') / doc(db,'contexts','user')
// as if data were at the root. The wrapped collection()/doc() exported here
// transparently rewrite that to apps/twin/users/{uid}/... — so no call site in
// the pages had to change. UID must be resolved (login done) before any of them
// run, which requireAuth() guarantees by gating the page bootstrap.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import {
  getFirestore,
  collection as _collection,
  doc as _doc,
  getDoc, getDocs, setDoc, deleteDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

// ══ FIREBASE CONFIG ══
const firebaseConfig = {
  apiKey: "AIzaSyD1uWPrp12lvpyBzXCOq9IrMuTU4uOTRao",
  authDomain: "natas-kitchen.firebaseapp.com",
  projectId: "natas-kitchen",
  storageBucket: "natas-kitchen.firebasestorage.app",
  messagingSenderId: "756908196325",
  appId: "1:756908196325:web:e8bab3aac2a322f9436f0c"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// Top-level namespace for THIS app inside the shared Firebase project. Every
// path is rooted here, isolating Twin from any sibling app in `natas-kitchen`.
// Change the second segment if you ever rename/rehome the app.
const APP_ROOT = ['apps', 'twin'];

// Owner of the legacy single-user data that lives at the Firestore root.
// Only this account triggers the one-time migration into its per-user store.
const OWNER_EMAIL = 'natalya.tsarapaeva@gmail.com';

let UID = null;
function currentUid() { return UID; }
function requireUid() {
  if (!UID) throw new Error('store: no authenticated user yet — call requireAuth() first');
  return UID;
}
// Full path prefix to the current user's store: apps/twin/users/{uid}
function userRoot() { return [...APP_ROOT, 'users', requireUid()]; }

// ── Per-user path namespacing ───────────────────────────────────────────────
// Drop-in replacements for firestore's collection()/doc(): they prepend
// apps/twin/users/{uid} to whatever path segments the caller passes.
const collection = (dbArg, ...segs) => _collection(dbArg, ...userRoot(), ...segs);
const doc        = (dbArg, ...segs) => _doc(dbArg, ...userRoot(), ...segs);

// ── Auth gate UI ────────────────────────────────────────────────────────────
const GOOGLE_G = '<svg class="ag-g" viewBox="0 0 48 48" aria-hidden="true">'
  + '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
  + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
  + '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
  + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>'
  + '</svg>';

function injectStyles() {
  if (document.getElementById('auth-style')) return;
  const s = document.createElement('style');
  s.id = 'auth-style';
  s.textContent = `
  #auth-gate{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:20px;padding:24px;text-align:center;
    background:linear-gradient(135deg,#3d5a7a 0%,#2e4a6a 100%);
    font-family:'DM Sans',sans-serif;}
  #auth-gate .ag-icon{font-size:56px;}
  #auth-gate h1{font-family:'Spectral',serif;font-weight:600;font-size:30px;color:#fff;line-height:1.2;}
  #auth-gate p{color:#c8dcf0;font-size:15px;max-width:320px;line-height:1.5;}
  #auth-gate button{display:inline-flex;align-items:center;gap:11px;background:#fff;color:#1e2d3d;
    border:none;border-radius:14px;padding:13px 22px;font-family:'DM Sans',sans-serif;
    font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.22);transition:transform .15s;}
  #auth-gate button:hover:not(:disabled){transform:translateY(-1px);}
  #auth-gate button:disabled{opacity:.6;cursor:default;}
  #auth-gate .ag-g{width:20px;height:20px;display:block;}
  #auth-gate .ag-err{color:#ffd7d7;font-size:13px;min-height:16px;max-width:320px;}
  #auth-chip{position:fixed;top:10px;right:10px;z-index:99998;display:flex;align-items:center;gap:8px;
    background:rgba(255,255,255,.92);border:1px solid #dce5ef;border-radius:20px;padding:4px 6px 4px 10px;
    box-shadow:0 2px 8px rgba(61,90,122,.18);font-family:'DM Sans',sans-serif;font-size:12px;color:#3d5a7a;
    -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}
  #auth-chip img{width:24px;height:24px;border-radius:50%;object-fit:cover;}
  #auth-chip .ac-name{max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}
  #auth-chip button{background:none;border:none;color:#6b83a0;cursor:pointer;font-size:15px;padding:2px 5px;line-height:1;border-radius:8px;}
  #auth-chip button:hover{color:#c05a5a;background:#f0f4f8;}
  `;
  document.head.appendChild(s);
}

async function doSignIn() {
  const btn = document.getElementById('ag-btn');
  const err = document.getElementById('ag-err');
  if (btn) btn.disabled = true;
  if (err) err.textContent = '';
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    // onAuthStateChanged handler takes it from here.
  } catch (e) {
    if (btn) btn.disabled = false;
    if (err) err.textContent = (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')
      ? '' : (e.message || 'Sign-in failed');
  }
}

function showLoginGate(errMsg) {
  injectStyles();
  let g = document.getElementById('auth-gate');
  if (!g) {
    g = document.createElement('div');
    g.id = 'auth-gate';
    g.innerHTML = `
      <div class="ag-icon">🧠</div>
      <h1>Twin</h1>
      <p>Your personal AI task manager. Sign in with Google to access your tasks.</p>
      <button id="ag-btn">${GOOGLE_G}<span>Continue with Google</span></button>
      <div class="ag-err" id="ag-err"></div>`;
    document.body.appendChild(g);
    document.getElementById('ag-btn').addEventListener('click', doSignIn);
  }
  g.style.display = 'flex';
  const err = document.getElementById('ag-err');
  if (err) err.textContent = errMsg || '';
}

function hideLoginGate() {
  const g = document.getElementById('auth-gate');
  if (g) g.style.display = 'none';
}

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function showUserChip(user) {
  injectStyles();
  let c = document.getElementById('auth-chip');
  if (!c) { c = document.createElement('div'); c.id = 'auth-chip'; document.body.appendChild(c); }
  const photo = user.photoURL
    ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : '';
  const name = esc(user.displayName || user.email || 'Account');
  c.innerHTML = `${photo}<span class="ac-name" title="${name}">${name}</span>`
    + `<button id="ac-out" title="Sign out">⎋</button>`;
  document.getElementById('ac-out').addEventListener('click', async () => {
    try { await signOut(auth); } catch (e) { /* ignore */ }
    location.reload();
  });
}

// ── Public: gate the page bootstrap on a signed-in user ──────────────────────
// Resolves with the Firebase user once signed in. While signed out it shows the
// login gate and waits. Sign-out (from the chip) reloads the page, which brings
// the gate back cleanly.
let _resolved = false;
function requireAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (user) {
        UID = user.uid;
        hideLoginGate();
        showUserChip(user);
        if (!_resolved) { _resolved = true; resolve(user); }
      } else {
        UID = null;
        showLoginGate();
      }
    });
  });
}

// ── One-time migration of legacy root data into the owner's per-user store ────
// Copies root  tasks/  contexts/  meta/  documents to apps/twin/users/{uid}/...
// the first time the owner signs in. Copy (not move): the root docs are left
// untouched. Runs before the page loads data, guarded by a flag doc so it only
// happens once.
async function migrateIfOwner(user) {
  try {
    if (!user || user.email !== OWNER_EMAIL) return user;
    const dest = [...APP_ROOT, 'users', user.uid];
    const flagRef = _doc(db, ...dest, 'meta', '_migration');
    const flag = await getDoc(flagRef);
    if (flag.exists()) return user;
    let copied = 0;
    for (const col of ['tasks', 'contexts', 'meta']) {
      const snap = await getDocs(_collection(db, col));
      for (const d of snap.docs) {
        if (col === 'meta' && d.id === '_migration') continue;
        await setDoc(_doc(db, ...dest, col, d.id), d.data());
        copied++;
      }
    }
    await setDoc(flagRef, { migratedAt: new Date().toISOString(), source: 'root', copied });
    console.info(`store: migrated ${copied} legacy root docs into ${dest.join('/')}`);
  } catch (e) {
    // Non-fatal: app still works, migration can be retried on next load.
    console.warn('store: migration skipped —', e.message);
  }
  return user;
}

export {
  db, auth,
  collection, doc,
  getDoc, getDocs, setDoc, deleteDoc, updateDoc,
  requireAuth, migrateIfOwner, currentUid
};
