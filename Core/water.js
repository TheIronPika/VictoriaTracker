// ─────────────────────────────────────────────────────────────────────
// core/water.js
// Water tracker: daily ounces logged via repeated taps (own Firestore
// doc, system/water_data — not itself a Habit doc). Streak is a simple
// day-count against the goal, not the weekly tier streak used by
// habits/streaks.js. Every add/undo also checks the pre-existing
// "Drink Water" reward habit (syncWaterHabit below): reaching the daily
// goal banks exactly ONE bubble for that day (not one per 10oz) — the
// next day resets to 0oz and can bank one more, so this still drives
// real weekly-tier payout without Victoria tapping that habit's bubbles
// by hand.
// ─────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { readDoc, writeDoc, mergeDoc, watchDoc, increment } from './firebase.js';
import { FIRESTORE_DOCS, WATER_CONFIG } from './config.js';
import { getDayIdx } from './utils.js';
import { syncHabits } from './habits-data.js';
import { effectiveDate } from './resetState.js';

/** Local 'YYYY-MM-DD' key for a date (defaults to today). */
function dateKey(d = new Date()) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Shape the raw Firestore doc into state.waterData, deriving today's amount. */
function normalizeWaterData(data) {
    const today   = dateKey();
    const history = (data && data.history) || {};
    return {
        date:   today,
        // Never below 0 — cross-device undo races on the additive increment
        // writes (addWater below) can briefly drive the stored key negative.
        amount: Math.max(0, history[today] || 0),
        goal:   (data && data.goal) || WATER_CONFIG.dailyGoalOz,
        history,
    };
}

/** One-time load — safe to call multiple times. Returns false when the read
 *  failed (offline/Doze) so headless callers (the widget task) can skip
 *  redrawing from zeroed-out default state. */
export async function loadWaterData() {
    let ok = true;
    try {
        const data = await readDoc(FIRESTORE_DOCS.WATER);
        state.waterData = normalizeWaterData(data);
    } catch (e) { console.error('loadWaterData:', e); ok = false; }
    state.waterLoaded = true;
    return ok;
}

/**
 * Subscribe to live water_data updates so a tap from another device syncs
 * in without a refresh. Re-renders on update. Returns the unsubscribe fn.
 */
export function watchWaterData() {
    return watchDoc(FIRESTORE_DOCS.WATER, (data) => {
        state.waterData = normalizeWaterData(data);
        state.waterLoaded = true;
        window.render?.();
    });
}

/** Push current water state to Firestore (goal + full history map).
 *  NOT used by the tap path anymore — addWater/setWaterGoal do field-level
 *  merges so concurrent devices can't clobber each other. Kept as the
 *  whole-doc escape hatch for future admin/repair flows. */
export async function syncWaterData() {
    try {
        await writeDoc(FIRESTORE_DOCS.WATER, {
            goal:    state.waterData.goal,
            history: state.waterData.history,
        });
    } catch (e) { console.error('syncWaterData:', e); }
}

/**
 * Auto-fill the pre-existing "Drink Water" reward habit (WATER_CONFIG.linkedHabitId)
 * with ONE bubble per day the water goal is reached — not one per 10oz. Writes a
 * single day's own cell (per-day storage, like a manual bubble tap), so it feeds
 * the same weekly tier/payout math without touching any other day. The bubble
 * banks only once that day's total ounces cross the goal; crossing back under it
 * (an undo) un-marks it again. Skips silently if habits haven't loaded yet or the
 * linked habit isn't found — the water tracker itself must never fail because of
 * the habit side of this.
 */
async function syncWaterHabit() {
    const habitId = WATER_CONFIG.linkedHabitId;
    if (!habitId) return;
    const h = (state.habits || []).find((x) => x.id === habitId);
    if (!h) return;

    // ONE date drives BOTH halves of this. effectiveDate() is normally today,
    // but while last week's reset is still pending (Monday pre-approval)
    // h.history still holds LAST week's data, so it pins to that week's Sunday
    // — a real Monday dIdx of 0 would write over the entire un-paid week.
    //
    // LOAD-BEARING: the ounces must come from the SAME day as the index.
    // This used to read state.waterData.amount, which is always the REAL
    // today's total, while writing to the pinned index. So on any Monday
    // before she approved the reset, the first sub-goal tap wrote 0 over
    // Sunday's earned bubble, and reaching Monday's goal wrote a 1 onto a
    // Sunday she hadn't earned — both on the week that hadn't been paid out
    // yet. Keyed off one date, the pending-Monday write simply re-asserts
    // Sunday's real result and is a no-op. On every ordinary day
    // history[dateKey(day)] IS waterData.amount, so nothing else changes.
    const day  = effectiveDate();
    const dIdx = getDayIdx(day);
    // Clamped like normalizeWaterData: concurrent undo races on the additive
    // increment writes can drive a stored key briefly negative.
    const oz   = Math.max(0, (state.waterData.history || {})[dateKey(day)] || 0);
    // Per-day storage: that day's water bubble is worth exactly one completion
    // when its OWN total crosses goal, zero otherwise — never more, no matter
    // how far past goal she drinks. Just set that day's own cell; other days
    // are independent and untouched.
    const hitGoal = oz >= (state.waterData.goal || WATER_CONFIG.dailyGoalOz);
    const target  = hitGoal ? 1 : 0;
    if ((h.history[dIdx] || 0) === target) return;

    h.history[dIdx] = target;
    try { await syncHabits(); } catch (e) { console.error('syncWaterHabit:', e); }
}

/**
 * Add (or subtract, via a negative amount) ounces to today's total.
 * Clamped at 0 — can't undo below empty.
 *
 * Persisted as a field-level increment on JUST today's history key (not a
 * whole-doc rewrite): this doc has three concurrent writers — her phone,
 * his phone, and the home-screen widget's headless task — and increments
 * from any two of them SUM on the server instead of last-write-wins eating
 * a tap. The goal and other days' keys are never touched by a tap.
 */
export async function addWater(amountOz = WATER_CONFIG.incrementOz) {
    const today   = dateKey();
    const prev    = state.waterData.history[today] || 0;
    const next    = Math.max(0, prev + amountOz);
    const applied = next - prev; // 0 when an undo hits the empty clamp
    state.waterData.history[today] = next;
    state.waterData.date   = today;
    state.waterData.amount = next;
    if (applied !== 0) {
        try {
            await mergeDoc(FIRESTORE_DOCS.WATER, { history: { [today]: increment(applied) } });
        } catch (e) { console.error('addWater sync:', e); }
    }
    await syncWaterHabit();
}

/** Convenience wrapper — subtracts one increment (e.g. undo a mis-tap). */
export async function undoWater(amountOz = WATER_CONFIG.incrementOz) {
    return addWater(-amountOz);
}

/** Update the daily goal (e.g. from a future settings screen).
 *  Field-level merge — changing the goal can't clobber history keys a
 *  concurrent tap just wrote. */
export async function setWaterGoal(goalOz) {
    const n = parseInt(goalOz, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    state.waterData.goal = n;
    try {
        await mergeDoc(FIRESTORE_DOCS.WATER, { goal: n });
    } catch (e) { console.error('setWaterGoal sync:', e); }
}

/**
 * Consecutive days hitting goal, most recent first. If today hasn't hit
 * goal yet, counting starts from yesterday so the streak number doesn't
 * drop to 0 mid-day before the day is actually over.
 */
export function computeWaterStreak() {
    const { history, goal } = state.waterData;
    const cursor = new Date();
    const todayHit = (history[dateKey(cursor)] || 0) >= goal;
    if (!todayHit) cursor.setDate(cursor.getDate() - 1);

    let streak = 0;
    for (;;) {
        const key = dateKey(cursor);
        if ((history[key] || 0) >= goal) {
            streak++;
            cursor.setDate(cursor.getDate() - 1);
        } else {
            break;
        }
    }
    return streak;
}
