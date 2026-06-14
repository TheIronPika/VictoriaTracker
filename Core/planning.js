// ─────────────────────────────────────────────────────────────────────
// core/planning.js
// Weekly plan-ahead data layer. Stores, per week, which day-indices the
// user *intends* to do each habit — pure intent, never touches
// habit.history. One Firestore doc (FIRESTORE_DOCS.PLANS) holds every
// week's plan keyed by the week's Monday date ("YYYY-MM-DD").
// ─────────────────────────────────────────────────────────────────────

import { state, setWeeklyPlans } from './state.js';
import { writeDoc, watchDoc } from './firebase.js';
import { FIRESTORE_DOCS } from './config.js';
import { weekKey, startOfWeek } from './utils.js';

// Keep only this many recent weeks in the doc so it can't grow forever.
const MAX_WEEKS_KEPT = 16;

const emptyWeek = () => [false, false, false, false, false, false, false];

/**
 * Subscribe to live weekly-plan updates. Returns an unsubscribe function.
 */
export function watchWeeklyPlans(callback) {
    return watchDoc(FIRESTORE_DOCS.PLANS, (data) => {
        setWeeklyPlans(data.plans || {});
        state.weeklyPlansLoaded = true;
        if (callback) callback(state.weeklyPlans);
    });
}

/**
 * Push current state.weeklyPlans to Firestore, pruned to recent weeks.
 */
export async function syncWeeklyPlans() {
    const keys = Object.keys(state.weeklyPlans).sort();        // ascending dates
    if (keys.length > MAX_WEEKS_KEPT) {
        const keep = keys.slice(keys.length - MAX_WEEKS_KEPT);
        const pruned = {};
        keep.forEach(k => { pruned[k] = state.weeklyPlans[k]; });
        setWeeklyPlans(pruned);
    }
    await writeDoc(FIRESTORE_DOCS.PLANS, { plans: state.weeklyPlans });
}

/**
 * The plan map for a given week: { [habitId]: [bool x7] }. May be empty.
 */
export function getPlanForWeek(date) {
    return state.weeklyPlans[weekKey(date)] || {};
}

/**
 * The 7-day planned array (Mon..Sun) for one habit in a given week.
 * Always returns a fresh 7-length boolean array.
 */
export function getPlannedDays(date, habitId) {
    const wk = getPlanForWeek(date);
    const arr = wk[habitId];
    return Array.isArray(arr) ? arr.slice(0, 7) : emptyWeek();
}

/**
 * Count of planned days for a habit in a week (for goal-progress UI).
 */
export function plannedCount(date, habitId) {
    return getPlannedDays(date, habitId).filter(Boolean).length;
}

function ensureWeek(key) {
    if (!state.weeklyPlans[key]) state.weeklyPlans[key] = {};
    return state.weeklyPlans[key];
}

/**
 * Toggle (or set) a single planned day for a habit, then sync.
 * If `value` is omitted, flips the current value.
 */
export async function setPlannedDay(date, habitId, dayIdx, value) {
    const key = weekKey(date);
    const wk = ensureWeek(key);
    const arr = Array.isArray(wk[habitId]) ? wk[habitId].slice(0, 7) : emptyWeek();
    arr[dayIdx] = (value === undefined) ? !arr[dayIdx] : !!value;
    wk[habitId] = arr;
    await syncWeeklyPlans();
}

/**
 * Clear all planned days for one habit in a week, then sync.
 */
export async function clearPlannedDays(date, habitId) {
    const key = weekKey(date);
    const wk = ensureWeek(key);
    wk[habitId] = emptyWeek();
    await syncWeeklyPlans();
}

/**
 * Copy the previous week's plan into `date`'s week (overwriting it), then
 * sync. Returns true if there was a previous-week plan to copy.
 */
export async function copyPreviousWeek(date) {
    const prev = new Date(startOfWeek(date));
    prev.setDate(prev.getDate() - 7);
    const prevPlan = state.weeklyPlans[weekKey(prev)];
    if (!prevPlan || !Object.keys(prevPlan).length) return false;

    const key = weekKey(date);
    const copy = {};
    Object.keys(prevPlan).forEach(habitId => {
        copy[habitId] = (prevPlan[habitId] || emptyWeek()).slice(0, 7);
    });
    state.weeklyPlans[key] = copy;
    await syncWeeklyPlans();
    return true;
}
