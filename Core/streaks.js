// ─────────────────────────────────────────────────────────────────────
// core/streaks.js
// Streak calculation by scanning weekly_history backward.
// Counter-free design: avoids drift from missed resets or manual edits.
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute current streak and bad streak for a habit by scanning
 * the weekly_history array backward (most recent first).
 *
 * Returns { streak, badStreak } where:
 *   streak    = consecutive 'goal' or 'bonus' weeks from the latest entry
 *   badStreak = consecutive 'punish' or 'low' weeks from the latest entry
 *
 * If the habit doesn't appear in a week, streak counting stops there.
 */
export function computeStreaksFromHistory(weeklyHistory, habitId) {
    if (!weeklyHistory.length) return { streak: 0, badStreak: 0 };

    // Sort newest first (immutable — don't mutate caller's array).
    const sorted = weeklyHistory.slice().sort((a, b) => b.timestamp - a.timestamp);
    let streak = 0, badStreak = 0;

    // Count consecutive good weeks from most recent.
    for (const wk of sorted) {
        const h = (wk.habits || []).find(x => x.id === habitId);
        if (!h) break;
        const good = h.tier === 'goal' || h.tier === 'bonus';
        if (good) { streak++; } else { break; }
    }

    // Count consecutive bad weeks from most recent.
    for (const wk of sorted) {
        const h = (wk.habits || []).find(x => x.id === habitId);
        if (!h) break;
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
    // Sort oldest first for a forward scan.
    const sorted = weeklyHistory.slice().sort((a, b) => a.timestamp - b.timestamp);
    let best = 0, run = 0;
    for (const wk of sorted) {
        const h = (wk.habits || []).find(x => x.id === habitId);
        const good = h && (h.tier === 'goal' || h.tier === 'bonus');
        if (good) { run++; if (run > best) best = run; }
        else { run = 0; }
    }
    return best;
}
