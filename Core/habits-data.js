// ─────────────────────────────────────────────────────────────────────
// core/habits-data.js
// Habits data layer: load, sync, watch, and mutation helpers.
// Combines state.js + firebase.js so callers don't need both.
// ─────────────────────────────────────────────────────────────────────

import { state, setHabits } from './state.js';
import { writeDoc, watchDoc } from './firebase.js';
import { FIRESTORE_DOCS } from './config.js';

/**
 * Subscribe to live habits updates from Firestore.
 * The callback fires every time the habits doc changes (including initial load).
 * Returns an unsubscribe function.
 */
export function watchHabits(callback) {
    return watchDoc(FIRESTORE_DOCS.HABITS, (data) => {
        setHabits(data.data || []);
        state.initialLoadDone = true;
        if (callback) callback(state.habits);
    });
}

/**
 * Push the current state.habits to Firestore.
 * Call this after any mutation.
 */
export async function syncHabits() {
    await writeDoc(FIRESTORE_DOCS.HABITS, { data: state.habits });
}

/**
 * Add a new habit with sensible defaults.
 */
export async function addHabit({ name, cat, icon = '✨', note = '' }) {
    if (!name || !cat) throw new Error('addHabit requires name and cat');
    const newH = {
        id: Date.now().toString(),
        name, icon, cat, note,
        dailyMax: 1,
        punish: 1, low: 3, goal: 5, bonus: 7, max: 7,
        valPunish: -1.50, valLow: 1.00, valGoal: 2.00, valBonus: 3.00,
        history: [0, 0, 0, 0, 0, 0, 0]
    };
    state.habits.push(newH);
    await syncHabits();
    return newH;
}

/**
 * Delete a habit by id.
 */
export async function deleteHabit(id) {
    setHabits(state.habits.filter(h => h.id !== id));
    await syncHabits();
}

/**
 * Update a single field on a habit. Handles type coercion based on field name.
 */
export async function updateHabitField(id, field, value) {
    const h = state.habits.find(x => x.id === id);
    if (!h) return;

    if (field === 'note' || field === 'cycleType') {
        h[field] = value;
    } else if (field === 'cycleNextDue') {
        // <input type="date"> sends "YYYY-MM-DD" — parse as a local date so
        // the hide-until window aligns with the calendar day the user picked.
        // Empty string clears the field (habit is visible immediately).
        if (!value) {
            delete h.cycleNextDue;
        } else {
            const [y, m, d] = String(value).split('-').map(Number);
            if (y && m && d) h.cycleNextDue = new Date(y, m - 1, d).getTime();
        }
    } else if (field.startsWith('val')) {
        h[field] = parseFloat(value);
    } else if (field.startsWith('star')) {
        h[field] = parseInt(value) || 0;
    } else if (field === 'streakBonusPer' || field === 'streakPenaltyPer' || field === 'streakCap') {
        h[field] = parseFloat(value) || 0;
    } else {
        h[field] = parseInt(value) || 1;
    }
    await syncHabits();
}

/**
 * Toggle the "excused" flag on a habit. Excused habits freeze streaks
 * and skip payouts on weekly reset, then auto-clear on reset.
 */
export async function toggleExcused(id) {
    const h = state.habits.find(x => x.id === id);
    if (!h) return;
    h.excused = !h.excused;
    await syncHabits();
}
