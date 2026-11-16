// ─────────────────────────────────────────────────────────────────────
// core/streaks.js
// Streak calculation by scanning weekly_history backward.
// Counter-free design: avoids drift from missed resets or manual edits.
// ─────────────────────────────────────────────────────────────────────

// Tiny array-identity memo. Both helpers do their own sort, and render.js
// calls them N times per render (once per habit) with the same array.
// Caching by reference means O(N log N) -> O(1) for every call after the
// first within a render — and stays correct on data updates because the
// state setter replaces the array with a fresh reference.
//
// LOAD-BEARING: correctness depends on weeklyHistory being REPLACED, never
// mutated in place. An in-place push/unshift/sort keeps the same reference, so
// these would keep handing back the previous sort and every streak read would
// silently use stale data. If you ever need to append a week, build a new array
// (weeklyReset.js does: `[entry, ...weeks]`) and pass that to setWeeklyHistory.
let _newestFirstSrc = null, _newestFirstSorted = null;
let _oldestFirstSrc = null, _oldestFirstSorted = null;

export function sortedNewestFirst(weeklyHistory) {
    if (_newestFirstSrc === weeklyHistory) return _newestFirstSorted;
    _newestFirstSrc    = weeklyHistory;
    _newestFirstSorted = weeklyHistory.slice().sort((a, b) => b.timestamp - a.timestamp);
    return _newestFirstSorted;
}

export function sortedOldestFirst(weeklyHistory) {
    if (_oldestFirstSrc === weeklyHistory) return _oldestFirstSorted;
    _oldestFirstSrc    = weeklyHistory;
    _oldestFirstSorted = weeklyHistory.slice().sort((a, b) => a.timestamp - b.timestamp);
    return _oldestFirstSorted;
}

// A week the habit was never on the hook for is NEUTRAL: it neither extends
// nor breaks either streak, so both scans skip straight past it.
//   • excused         — she spent a 🌿 Rest Week token to sit the week out
//   • periodProtected — period-sensitive habit during her period
// The snapshot still records the tier she literally landed on (usually
// 'punish', since a rested week has no completions), which is what the weekly
// report and the "✦ Resting" pill want to show. Reading that tier as a real
// result is what used to nuke the streak. weeklyReset.js has always frozen the
// STORED h.streak counter on these weeks (`if (isDormant(h) || h.excused ||
// streakFrozenH(h)) return { ...h }`) — this keeps the history-derived streak
// the UI actually displays in agreement with it.
function isNeutralWeek(h) {
    return !!h.excused || !!h.periodProtected;
}

/**
 * Compute current streak and bad streak for a habit by scanning
 * the weekly_history array backward (most recent first).
 *
 * Returns { streak, badStreak } where:
 *   streak    = consecutive 'goal' or 'bonus' weeks from the latest entry
 *   badStreak = consecutive 'punish' or 'low' weeks from the latest entry
 *
 * Rest weeks and period-protected weeks are skipped (see isNeutralWeek).
 * If the habit doesn't appear in a week, streak counting stops there.
 */
export function computeStreaksFromHistory(weeklyHistory, habitId, opts = {}) {
    if (!weeklyHistory.length) return { streak: 0, badStreak: 0 };

    const sorted = sortedNewestFirst(weeklyHistory);
    // opts.badStreakResetTs: when the ☀️ Fresh Start was spent. Clears the
    // bad streak without rewriting history: weeks snapshotted before it don't
    // count, and neither does the week she spent it IN (the first snapshot
    // after it). That second part matches weeklyReset.js, which holds the
    // stored badStreak at 0 for the token week — and it's what she expects
    // when she spends it on Monday while last week's reset is still pending
    // approval: that pending week is the one she was clearing.
    //
    // The stamp is permanent. weeklyReset.js used to delete it after one
    // reset, which silently brought every pre-token week back (2026-11-16:
    // Streching showed 🌧️ 29 a week after a Fresh Start).
    const badResetTs = opts.badStreakResetTs || 0;
    let tokenWeekTs = Infinity;          // no snapshot since the token → nothing counts
    if (badResetTs) {
        for (const wk of sorted) {
            if (wk.timestamp < badResetTs) break;
            tokenWeekTs = wk.timestamp;  // ends on the OLDEST snapshot after the token
        }
    }
    let streak = 0, badStreak = 0;

    // Count consecutive good weeks from most recent.
    for (const wk of sorted) {
        const h = (wk.habits || []).find(x => x.id === habitId);
        if (!h) break;
        if (isNeutralWeek(h)) continue;
        const good = h.tier === 'goal' || h.tier === 'bonus';
        if (good) { streak++; } else { break; }
    }

    // Count consecutive bad weeks from most recent.
    for (const wk of sorted) {
        if (badResetTs && wk.timestamp <= tokenWeekTs) break;
        const h = (wk.habits || []).find(x => x.id === habitId);
        if (!h) break;
        if (isNeutralWeek(h)) continue;
        const bad = h.tier === 'punish' || h.tier === 'low';
        if (bad) { badStreak++; } else { break; }
    }

    return { streak, badStreak };
}

/**
 * Best-ever streak for a habit across all history.
 * Useful for displaying "Best: 🔥 12" badges.
 */
export function computeBestStreak(weeklyHistory, habitId) {
    if (!weeklyHistory.length) return 0;
    const sorted = sortedOldestFirst(weeklyHistory);
    let best = 0, run = 0;
    for (const wk of sorted) {
        const h = (wk.habits || []).find(x => x.id === habitId);
        // Same neutrality rule as computeStreaksFromHistory: a rested or
        // period-protected week doesn't end the run it sits inside.
        if (h && isNeutralWeek(h)) continue;
        const good = h && (h.tier === 'goal' || h.tier === 'bonus');
        if (good) { run++; if (run > best) best = run; }
        else { run = 0; }
    }
    return best;
}
