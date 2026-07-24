// Единая инициализация Firebase для всех страниц Twin Tasks.
// Раньше конфиг + initializeApp дублировались inline в каждом HTML-файле —
// теперь одна точка входа: db (Firestore) + auth (Auth) + authReady.
//
// Конфиг публичный по дизайну (клиентский web-config) — доступ к данным
// гейтят Firestore rules по членству в блокноте (см. firestore.rules).
//
// ⚠️ Чтобы вход заработал, в Firebase Console → Authentication → Sign-in method
// нужно включить провайдеры Google и Email/Password, а в Authentication →
// Settings → Authorized domains добавить домен GitHub Pages
// (natalyatsarapaeva-tech.github.io) и localhost для локальной разработки.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

// Ре-экспорт функций Firestore — страницы берут их отсюда, а не с CDN напрямую.
export {
  collection, getDocs, doc, getDoc, setDoc, deleteDoc, updateDoc,
  query, where,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

// Ре-экспорт функций Auth.
export {
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD1uWPrp12lvpyBzXCOq9IrMuTU4uOTRao",
  authDomain: "natas-kitchen.firebaseapp.com",
  projectId: "natas-kitchen",
  storageBucket: "natas-kitchen.firebasestorage.app",
  messagingSenderId: "756908196325",
  appId: "1:756908196325:web:e8bab3aac2a322f9436f0c"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Разрешается после восстановления сессии — страницы, пишущие в Firestore,
// ждут, чтобы запросы ушли с токеном (важно для rules по членству в блокноте).
export const authReady = new Promise(resolve => {
  const off = onAuthStateChanged(auth, user => { off(); resolve(user); });
});
