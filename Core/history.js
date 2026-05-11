// ─────────────────────────────────────────────────────────────────────
// core/history.js
// Weekly history snapshots: load, save, and aggregate queries.
// Snapshots are taken at weekly reset time and used for streaks + charts.
// ─────────────────────────────────────────────────────────────────────

import { state, setWeeklyHistory } from './state.js';
import { readDoc, writeDoc } from './firebase.js';
import { FIRESTORE_DOCS, HISTORY_MAX_WEEKS } from './config.js';
import { getTier, getBasePayout, getCurrentCount } from './habits.js';

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

/**
 * Save a weekly snapshot of habit performance.
 * Snapshots are stored newest-first and capped at HISTORY_MAX_WEEKS.
 */
export async function saveWeekSnapshot(habits, totalBalance, dateStr) {
    try {
        const data = await readDoc(FIRESTORE_DOCS.HISTORY);
        let weeks = data?.weeks || [];
        const entry = {
            id: Date.now().toString(),
            weekEnding: dateStr,
            timestamp: Date.now(),
            totalBalance,
            habits: habits.map(h => {
                const cur  = getCurrentCount(h);
                const tier = getTier(h, cur);
                return {
                    id: h.id,
                    name: h.name,
                    icon: h.icon,
                    cat: h.cat,
                    tier,
                    payout: getBasePayout(h, tier),
                    history: (h.history || []).slice(0, 7),
                    thresh: {
                        punish: h.punish || 1,
                        low:    h.low    || 3,
                        goal:   h.goal   || 5,
                        bonus:  h.bonus  || 7
                    }
                };
            })
        };
        weeks.unshift(entry);
        if (weeks.length > HISTORY_MAX_WEEKS) {
            weeks = weeks.slice(0, HISTORY_MAX_WEEKS);
        }
        await writeDoc(FIRESTORE_DOCS.HISTORY, { weeks });
        setWeeklyHistory(weeks);
    } catch (e) { console.error('saveWeekSnapshot:', e); }
}

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
