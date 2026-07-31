// ─────────────────────────────────────────────────────────────────────
// Core/firebase.js
// Firebase init + three thin wrappers used by every data module:
//   readDoc  — one-time getDoc
//   writeDoc — setDoc (merge: false, full overwrite)
//   mergeDoc — setDoc (merge: true, field-level, supports sentinels)
//   watchDoc — onSnapshot live listener, returns unsubscribe fn
// ─────────────────────────────────────────────────────────────────────

import { initializeApp }                        from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot, increment, writeBatch }
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
 * Field-level merge write. Unlike writeDoc this leaves untouched fields
 * alone, and supports sentinel values (e.g. increment()) so concurrent
 * writers — her phone, his phone, the native app — sum instead of
 * clobbering each other.
 * @param {[string, string]} docPath
 * @param {object}           partial
 */
export async function mergeDoc([col, id], partial) {
    await setDoc(doc(db, col, id), partial, { merge: true });
}

/**
 * Overwrite SEVERAL documents atomically — every write lands or none does.
 *
 * Exists for the weekly reset, which touches seven docs (stars, history,
 * habits, rooms, events, reset_state, period). Done as separate writeDoc
 * calls, a failure partway left the week half-closed: stars already awarded
 * but habits not yet wiped, so the retry the UI invites re-awarded them and
 * prepended a duplicate history week (which getAllTimeTotal, the earnings
 * achievements, and the streak scan all read as real). A batch removes the
 * partial state entirely.
 *
 * @param {Array<[[string, string], object]>} entries  [[docPath, data], ...]
 */
export async function writeAll(entries) {
    const batch = writeBatch(db);
    for (const [[col, id], data] of entries) batch.set(doc(db, col, id), data);
    await batch.commit();
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

// Export db instance for any module that needs it directly, plus the
// increment() sentinel for additive field writes via mergeDoc.
export { db, increment };
