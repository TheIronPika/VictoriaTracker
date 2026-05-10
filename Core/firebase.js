/**
 * VICTORIA TRACKER — Firebase Operations
 * All Firestore database reads and writes
 */

export const firebaseConfig = {
    apiKey: "AIzaSyB9ztBUJyUvlyycujmDjbTcKT-GIejpsM4",
    authDomain: "victoria-tracker-1d2ab.firebaseapp.com",
    projectId: "victoria-tracker-1d2ab",
    storageBucket: "victoria-tracker-1d2ab.firebasestorage.app",
    messagingSenderId: "893813838454",
    appId: "1:893813838454:web:72ac9f21756d00f8a88557"
};

let db = null;

/**
 * Initialize Firebase app and Firestore
 * Must be called once before any DB operations
 */
export async function initializeFirebase() {
    // This will be done in the web layer with actual Firebase SDK
    // Core just defines the config
    return firebaseConfig;
}

/**
 * Set the Firestore instance (called from web layer)
 */
export function setFirestoreInstance(firestoreInstance) {
    db = firestoreInstance;
}

/**
 * Sync habits to Firebase
 */
export async function syncHabits(habits) {
    if (!db) throw new Error('Firestore not initialized');
    const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    await setDoc(doc(db, 'system', 'habits_list'), { data: habits });
}

/**
 * Load habits from Firebase
 */
export async function loadHabits() {
    if (!db) throw new Error('Firestore not initialized');
    const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'system', 'habits_list'));
    return snap.exists() ? snap.data().data : [];
}

/**
 * Save a weekly history snapshot
 */
export async function saveWeeklySnapshot(entry) {
    if (!db) throw new Error('Firestore not initialized');
    const { setDoc, getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    
    const histRef = doc(db, 'system', 'weekly_history');
    const histSnap = await getDoc(histRef);
    let weeks = histSnap.exists() ? (histSnap.data().weeks || []) : [];

    weeks.unshift(entry);
    if (weeks.length > 52) weeks = weeks.slice(0, 52);

    await setDoc(histRef, { weeks });
}

/**
 * Load weekly history
 */
export async function loadWeeklyHistory() {
    if (!db) throw new Error('Firestore not initialized');
    const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'system', 'weekly_history'));
    return snap.exists() ? (snap.data().weeks || []) : [];
}

/**
 * Load seasonal events
 */
export async function loadSeasonalEvents() {
    if (!db) throw new Error('Firestore not initialized');
    const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'system', 'seasonal_events'));
    return snap.exists() ? (snap.data().events || []) : [];
}

/**
 * Sync seasonal events
 */
export async function syncSeasonalEvents(events) {
    if (!db) throw new Error('Firestore not initialized');
    const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    await setDoc(doc(db, 'system', 'seasonal_events'), { events });
}

/**
 * Load star data (balance, spent, items, log)
 */
export async function loadStarData() {
    if (!db) throw new Error('Firestore not initialized');
    const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'system', 'star_data'));
    if (snap.exists()) {
        return {
            balance: snap.data().balance || 0,
            spent: snap.data().spent || 0,
            items: snap.data().items || [],
            log: snap.data().log || []
        };
    }
    return { balance: 0, spent: 0, items: [], log: [] };
}

/**
 * Sync star data
 */
export async function syncStarData(data) {
    if (!db) throw new Error('Firestore not initialized');
    const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    await setDoc(doc(db, 'system', 'star_data'), data);
}

/**
 * Subscribe to habits changes (real-time listener)
 */
export async function onHabitsChange(callback) {
    if (!db) throw new Error('Firestore not initialized');
    const { onSnapshot, doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
    return onSnapshot(doc(db, 'system', 'habits_list'), (snap) => {
        if (snap.exists()) {
            callback(snap.data().data);
        }
    });
}

export default {
    initializeFirebase,
    setFirestoreInstance,
    syncHabits,
    loadHabits,
    saveWeeklySnapshot,
    loadWeeklyHistory,
    loadSeasonalEvents,
    syncSeasonalEvents,
    loadStarData,
    syncStarData,
    onHabitsChange
};
