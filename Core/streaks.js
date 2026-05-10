/**
 * VICTORIA TRACKER — Streak Calculations
 * Computes streaks from weekly history (no counter drift)
 */

export const streaks = {
    /**
     * Compute streaks from weekly history
     * Scans backward from most recent week
     * Returns { streak: N, badStreak: N }
     */
    computeFromHistory(habitId, weeklyHistory) {
        if (!weeklyHistory || !weeklyHistory.length) {
            return { streak: 0, badStreak: 0 };
        }

        // Sort newest first
        const sorted = weeklyHistory.slice().sort((a, b) => b.timestamp - a.timestamp);

        let streak = 0;
        let badStreak = 0;

        // Count consecutive good weeks from most recent
        for (const week of sorted) {
            const h = (week.habits || []).find(x => x.id === habitId);
            if (!h) break; // habit didn't exist that week — stop
            
            const isGood = h.tier === 'goal' || h.tier === 'bonus';
            if (isGood) {
                streak++;
            } else {
                break;
            }
        }

        // Count consecutive bad weeks from most recent
        for (const week of sorted) {
            const h = (week.habits || []).find(x => x.id === habitId);
            if (!h) break;
            
            const isBad = h.tier === 'punish' || h.tier === 'low';
            if (isBad) {
                badStreak++;
            } else {
                break;
            }
        }

        return { streak, badStreak };
    },

    /**
     * Calculate streak payout bonus
     * Returns additional amount to add to payout
     */
    getStreakBonusAmount(habit, streak) {
        if (streak < 2) return 0;
        if (!habit.streakBonusPer) return 0;

        const raw = streak * habit.streakBonusPer;
        const cap = habit.streakCap ? parseFloat(habit.streakCap) : Infinity;
        return Math.min(raw, cap);
    },

    /**
     * Calculate bad streak penalty
     * Returns additional amount to subtract from payout
     */
    getStreakPenaltyAmount(habit, badStreak) {
        if (badStreak < 2) return 0;
        if (!habit.streakPenaltyPer) return 0;

        const raw = badStreak * habit.streakPenaltyPer;
        const cap = habit.streakCap ? parseFloat(habit.streakCap) : Infinity;
        return Math.min(raw, cap);
    },

    /**
     * Update streaks after a weekly reset
     * Calculates new streak/badStreak values based on this week's tier
     * Excused habits freeze their streak
     */
    updateStreaksAfterReset(habit, tier) {
        if (habit.excused) {
            // Excused habits freeze their streak — neither increment nor reset
            return { ...habit };
        }

        const isGood = tier === 'goal' || tier === 'bonus';
        const newStreak = isGood ? (habit.streak || 0) + 1 : 0;
        const newBadStreak = !isGood ? (habit.badStreak || 0) + 1 : 0;
        const bestEver = Math.max(newStreak, habit.bestStreak || 0);

        return {
            ...habit,
            streak: newStreak,
            badStreak: newBadStreak,
            bestStreak: bestEver
        };
    },

    /**
     * Format streak for display
     * e.g., 4 → "🔥 4"
     */
    formatStreak(streak) {
        return streak >= 1 ? `🔥 ${streak}` : '';
    },

    /**
     * Format bad streak for display
     * e.g., 2 → "🌧️ 2"
     */
    formatBadStreak(badStreak) {
        return badStreak >= 1 ? `🌧️ ${badStreak}` : '';
    }
};

export default streaks;
