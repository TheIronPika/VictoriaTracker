// ─────────────────────────────────────────────────────────────────────
// core/history.js
// Weekly history snapshots: load + aggregate queries. Snapshots are WRITTEN
// by weeklyReset.js (inside its atomic batch); this file only reads them and
// derives the totals the charts and achievements use.
// ─────────────────────────────────────────────────────────────────────

import { state, setWeeklyHistory } from './state.js';
import { readDoc } from './firebase.js';
import { FIRESTORE_DOCS } from './config.js';

/**
 * Load weekly history into state.
 */
export async function loadWeeklyHistory() {
    try {
        const data = await readDoc(FIRESTORE_DOCS.HISTORY);
        setWeeklyHistory(data?.weeks || []);
        state.historyLoaded = true;
    } catch (e) { console.error('loadWeeklyHistory:', e); }
}

// Weekly snapshots are written by weeklyReset.js, as part of its one atomic
// batch — there is deliberately no save function here. An unused
// saveWeekSnapshot() lived here until 2026-07-30; nothing had called it since
// the reset was centralised, and it built a DIFFERENT entry shape than the one
// weeklyReset writes (no periodProtected, no excused), so reviving it would
// have quietly seeded rows the readers below mis-handle.

// ─── Aggregation helpers (used by history charts) ────────────────────

/**
 * All-time total balance summed across every recorded week.
 */
export function getAllTimeTotal() {
    return state.weeklyHistory.reduce((s, w) => s + (w.totalBalance || 0), 0);
}

/**
 * Best (highest balance) week. Returns null if no history.
 */
export function getBestWeek() {
    if (!state.weeklyHistory.length) return null;
    return state.weeklyHistory.reduce(
        (best, w) => (w.totalBalance > best.totalBalance ? w : best),
        state.weeklyHistory[0]
    );
}

/**
 * Count of weeks where the total balance was non-negative.
 */
export function getProfitWeekCount() {
    return state.weeklyHistory.filter(w => (w.totalBalance || 0) >= 0).length;
}

/**
 * Cumulative payout per habit across all history.
 * Returns array sorted by total descending.
 */
export function getHabitTotals() {
    const totals = {};
    state.weeklyHistory.forEach(w => (w.habits || []).forEach(h => {
        if (!totals[h.name]) totals[h.name] = { name: h.name, icon: h.icon || '', val: 0 };
        totals[h.name].val += (h.payout || 0);
    }));
    return Object.values(totals).sort((a, b) => b.val - a.val);
}

/**
 * Average payout per category per week.
 * Returns { [category]: avgPayout }.
 */
export function getCategoryAverages() {
    const sums = {};
    state.weeklyHistory.forEach(w => (w.habits || []).forEach(h => {
        if (!sums[h.cat]) sums[h.cat] = 0;
        sums[h.cat] += (h.payout || 0);
    }));
    const n = state.weeklyHistory.length || 1;
    const out = {};
    for (const cat of Object.keys(sums)) {
        out[cat] = +(sums[cat] / n).toFixed(2);
    }
    return out;
}
