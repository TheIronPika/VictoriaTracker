// ─────────────────────────────────────────────────────────────────────
// core/habits-data.js
// Habits data layer: load, sync, watch, and mutation helpers.
// Combines state.js + firebase.js so callers don't need both.
// ─────────────────────────────────────────────────────────────────────

import { state, setHabits } from './state.js';
import { readDoc, writeDoc, watchDoc } from './firebase.js';
import { FIRESTORE_DOCS } from './config.js';
import { isLocked, isLockGated, confirmLockFields } from './locks.js';

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
    // Trim at the data layer, not just in each form. Categories are matched by
    // exact string, so ONE stored "Self Improvement " (trailing space) splits
    // into a second category the moment anything submits the trimmed spelling
    // — which every add form already does. Belt and braces so a new stray-space
    // category can't be created from any caller.
    name = String(name || '').trim();
    cat  = String(cat  || '').trim();
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

// updateHabitField() was deleted on 2026-09-04. It had ZERO callers in either
// app for its entire life — both UIs coerce fields in their own copy
// (web/ui/habits-ui.js window.updateField, native components/HabitEditorModal
// updateField) — yet three separate fixes were committed into it and silently
// did nothing: the July NaN guard on val*, the September name/cat trim, and the
// task-lock branches. Meanwhile the PWA's real path was writing the number 1
// into `icon` and `lockTask`, the latter crashing the render loop in BOTH apps.
//
// It wasn't neutral dead code, it was a decoy that looked like the place fixes
// belonged. If a third consumer ever appears, reintroduce it deliberately and
// route BOTH editors through it — don't resurrect it as a fourth copy.

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
