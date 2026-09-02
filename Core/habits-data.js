// ─────────────────────────────────────────────────────────────────────
// core/habits-data.js
// Habits data layer: load, sync, watch, and mutation helpers.
// Combines state.js + firebase.js so callers don't need both.
// ─────────────────────────────────────────────────────────────────────

import { state, setHabits } from './state.js';
import { readDoc, writeDoc, watchDoc } from './firebase.js';
import { FIRESTORE_DOCS } from './config.js';
import { isLocked, isLockGated, confirmLockFields, LOCK_DEFAULT_EVERY_WEEKS } from './locks.js';

/**
 * One-time load of habits — for headless contexts (e.g. the widget task
 * handler) that need state.habits populated without a live subscription.
 * Safe to call multiple times.
 */
export async function loadHabits() {
    const data = await readDoc(FIRESTORE_DOCS.HABITS);
    setHabits((data && data.data) || []);
}

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
        // A cleared/non-numeric input parses to NaN — never write that to
        // Firestore (it propagates into every payout total as "$NaN").
        // Keep the previous value instead so a mis-tap can't zero a payout.
        const f = parseFloat(value);
        h[field] = Number.isFinite(f) ? f : (Number.isFinite(h[field]) ? h[field] : 0);
    } else if (field.startsWith('star')) {
        h[field] = parseInt(value) || 0;
    } else if (field === 'streakBonusPer' || field === 'streakPenaltyPer' || field === 'streakCap') {
        h[field] = parseFloat(value) || 0;
    } else if (field === 'lockTask') {
        // Free text — must not fall through to the parseInt branch below,
        // which would turn "Change the sheets" into 1.
        h.lockTask = String(value == null ? '' : value);
    } else if (field === 'lockEnabled') {
        const on = (value === true || value === 'true' || value === 1 || value === '1');
        h.lockEnabled = on;
        if (on) {
            // Arm it immediately, otherwise switching the gate on does
            // nothing visible until the cadence next comes round.
            if (h.locked === undefined) h.locked = true;
            if (h.lockWeeks === undefined) h.lockWeeks = 0;
        } else {
            // Don't leave a disabled gate holding a habit shut. isLocked()
            // already returns false for an ungated habit, but a stale
            // `locked: true` would spring back the moment it's re-enabled.
            h.locked = false;
        }
    } else if (field === 'lockEveryWeeks') {
        const n = parseInt(value, 10);
        h.lockEveryWeeks = (Number.isFinite(n) && n >= 1) ? n : LOCK_DEFAULT_EVERY_WEEKS;
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

/**
 * Confirm the secondary task behind a habit's 🔒 task lock, opening its
 * bubbles for the rest of this period. Honour system — nothing verifies the
 * task actually happened, which is the point: the required task can be
 * something the app doesn't track.
 *
 * Once open she can fill in the days that passed while it was locked; the
 * bubbles already allow editing any day up to today, so no backfill of her
 * history is needed here.
 *
 * No-op on a habit that isn't gated or isn't currently locked, so a double
 * tap can't stamp a fresh lockConfirmedAt over the real one.
 */
export async function confirmTaskLock(id) {
    const h = state.habits.find(x => x.id === id);
    if (!h || !isLocked(h)) return false;
    Object.assign(h, confirmLockFields());
    await syncHabits();
    return true;
}

/**
 * Re-arm a habit's task lock by hand (Manage). Lets the gate be tested, or
 * enforced again early without waiting for the cadence to come round.
 */
export async function relockTask(id) {
    const h = state.habits.find(x => x.id === id);
    if (!h || !isLockGated(h)) return false;
    h.locked = true;
    await syncHabits();
    return true;
}
