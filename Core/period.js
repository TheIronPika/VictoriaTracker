// ─────────────────────────────────────────────────────────────────────
// core/period.js
// Period tracking: load/sync period_data from Firestore.
// Period-sensitive habits skip negative payouts and streak penalties
// while active, and freeze streaks so they don't reset.
// ─────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { readDoc, writeDoc, watchDoc } from './firebase.js';
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

/**
 * Subscribe to live period_data updates so a write from another tab/device
 * is picked up here without a refresh. Re-renders on update. Returns the
 * unsubscribe function.
 */
export function watchPeriodData() {
    return watchDoc(FIRESTORE_DOCS.PERIOD, (data) => {
        if (data) state.periodData = { ...state.periodData, ...data };
        state.periodLoaded = true;
        window.render?.();
    });
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

/**
 * True if a period happened at any point during the current week — still
 * running, or started and already ended. Cleared by the weekly reset.
 *
 * Period protection is a WHOLE-WEEK judgement: a period that ended on
 * Wednesday still protects that habit for the week it sat inside. Pair this
 * with isPeriodActive() wherever protection is decided —
 * computeWeeklyPayout({ periodActive, periodWasThisWeek }), the streak roll in
 * weeklyReset.js, and the category math — so the four consumers agree. Using
 * isPeriodActive() alone means a period that ends before Monday's reset drops
 * its own protection.
 */
export function wasPeriodThisWeek() {
    return !!(state.periodData && state.periodData.periodWasThisWeek);
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
 * Estimate the next period's start from logged history. Uses the gaps
 * between the last up-to-4 logged start dates (so 5 entries → 4 gaps max),
 * averaged, projected forward from the most recent start.
 * confidence: 'none' (<2 entries, no gap to measure), 'low' (exactly one
 * gap), 'estimate' (2+ gaps). Returns { confidence, cyclesUsed } only when
 * there isn't enough history for a prediction.
 */
export function predictNextPeriod() {
    const history = state.periodData.history || [];
    const starts = history.slice(0, 4).map(e => e.startTs).filter(Boolean);
    if (starts.length < 2) return { confidence: 'none', cyclesUsed: 0 };

    const gaps = [];
    for (let i = 0; i < starts.length - 1; i++) {
        gaps.push(Math.round((starts[i] - starts[i + 1]) / 86400000));
    }
    const avgCycle = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    const durations = history.slice(0, 4).map(e => e.duration).filter(d => d != null);
    const avgDuration = durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null;

    return {
        confidence: gaps.length >= 2 ? 'estimate' : 'low',
        cyclesUsed: gaps.length,
        avgCycle,
        avgDuration,
        predictedTs: starts[0] + avgCycle * 86400000,
    };
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
