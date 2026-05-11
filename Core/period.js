// ─────────────────────────────────────────────────────────────────────
// core/period.js
// Period tracking: load/sync period_data from Firestore.
// Period-sensitive habits skip negative payouts and streak penalties
// while active, and freeze streaks so they don't reset.
// ─────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { readDoc, writeDoc } from './firebase.js';
import { FIRESTORE_DOCS } from './config.js';

/**
 * Load period data from Firestore into state.
 * Safe to call multiple times — only fetches once.
 */
export async function loadPeriodData() {
    if (state.periodLoaded) return;
    try {
        const data = await readDoc(FIRESTORE_DOCS.PERIOD);
        if (data) state.periodData = { ...state.periodData, ...data };
    } catch (e) { console.warn('period_data load failed:', e); }
    state.periodLoaded = true;
}

/** Push current period state to Firestore. */
export async function syncPeriodData() {
    try {
        await writeDoc(FIRESTORE_DOCS.PERIOD, state.periodData);
    } catch (e) { console.error('period_data sync failed:', e); }
}

/** Returns true if a period is currently active. */
export function isPeriodActive() {
    return !!state.periodData.active;
}

/** Returns how many days since period started (1-based, e.g. "Day 3"). */
export function periodDayCount() {
    if (!state.periodData.startTs) return 1;
    const ms = Date.now() - state.periodData.startTs;
    return Math.max(1, Math.floor(ms / 86400000) + 1);
}

/** Returns the Monday 00:00 timestamp of the current week. */
export function getWeekStart() {
    const now  = new Date();
    const day  = now.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    const mon  = new Date(now);
    mon.setDate(now.getDate() + diff);
    mon.setHours(0, 0, 0, 0);
    return mon.getTime();
}

/**
 * Returns the Mon=0…Sun=6 index when the period started this week.
 * Returns 7 if no period active or this week (safe — no bubble will be >= 7).
 */
export function periodStartDayIdx(getDayIdxFn) {
    let startTs = null;
    if (state.periodData.active && state.periodData.startTs) {
        startTs = state.periodData.startTs;
    } else if (state.periodData.periodWasThisWeek && state.periodData.history?.length > 0) {
        startTs = state.periodData.history[0].startTs;
    }
    if (!startTs) return 7;
    const weekStart = getWeekStart();
    if (startTs < weekStart) return 0; // started before this week → whole week protected
    return getDayIdxFn(new Date(startTs));
}
