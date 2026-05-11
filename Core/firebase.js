// ─────────────────────────────────────────────────────────────────────
// Core/firebase.js
// Firebase init + three thin wrappers used by every data module:
//   readDoc  — one-time getDoc
//   writeDoc — setDoc (merge: false, full overwrite)
//   watchDoc — onSnapshot live listener, returns unsubscribe fn
// ─────────────────────────────────────────────────────────────────────

import { initializeApp }                        from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { FIREBASE_CONFIG } from './config.js';

// ── Init ─────────────────────────────────────────────────────────────

const app = initializeApp(FIREBASE_CONFIG);
const db  = getFirestore(app);

// ── Wrappers ──────────────────────────────────────────────────────────

/**
 * One-time read of a Firestore document.
 * @param {[string, string]} docPath  e.g. ['system', 'habits_list']
 * @returns {object|null}  document data, or null if it doesn't exist
 */
export async function readDoc([col, id]) {
    const snap = await getDoc(doc(db, col, id));
    return snap.exists() ? snap.data() : null;
}

/**
 * Write (overwrite) a Firestore document.
 * @param {[string, string]} docPath
 * @param {object}           data
 */
export async function writeDoc([col, id], data) {
    await setDoc(doc(db, col, id), data);
}

/**
 * Subscribe to live updates on a Firestore document.
 * Fires immediately with current data, then on every change.
 * @param {[string, string]} docPath
 * @param {function}         callback  receives document data object
 * @returns {function}  unsubscribe function
 */
export function watchDoc([col, id], callback) {
    return onSnapshot(doc(db, col, id), (snap) => {
        if (snap.exists()) callback(snap.data());
    });
}

// Export db instance for any module that needs it directly
export { db };
