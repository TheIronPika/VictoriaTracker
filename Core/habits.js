// ─────────────────────────────────────────────────────────────────────
// core/habits.js
// Habit tier classification and base payout calculations.
// Pure functions — no state, no Firebase, no DOM.
// ─────────────────────────────────────────────────────────────────────

/**
 * Classify a count into a tier based on the habit's thresholds.
 * Returns 'punish' | 'low' | 'goal' | 'bonus'.
 */
export function getTier(habit, count) {
    if (count >= (habit.bonus || 7)) return 'bonus';
    if (count >= (habit.goal  || 5)) return 'goal';
    if (count >= (habit.low   || 3)) return 'low';
    return 'punish';
}

/**
 * Get the base payout for a given tier.
 * Does NOT include streak bonuses/penalties — see getStreakBonus/getStreakPenalty.
 */
export function getBasePayout(habit, tier) {
    if (tier === 'punish') return habit.valPunish || 0;
    if (tier === 'low')    return habit.valLow    || 0;
    if (tier === 'goal')   return habit.valGoal   || 0;
    if (tier === 'bonus')  return habit.valBonus  || 0;
    return 0;
}

/**
 * Get the current count for a habit — last day in the 7-day history.
 * Falls back to whatever's at the end of history if it's shorter than 7.
 */
export function getCurrentCount(habit) {
    const hist = (habit.history || []).slice(0, 7);
    return hist[6] !== undefined ? hist[6] : (hist[hist.length - 1] || 0);
}

/**
 * Calculate the positive streak bonus for a habit.
 * Only applies if tier is 'goal' or 'bonus' AND streak >= 2.
 * Capped by habit.streakCap if set.
 */
export function getStreakBonus(habit, tier, currentStreak) {
    if ((tier === 'goal' || tier === 'bonus') &&
        currentStreak >= 2 &&
        (habit.streakBonusPer || 0) > 0) {
        const raw = currentStreak * habit.streakBonusPer;
        const cap = habit.streakCap ? parseFloat(habit.streakCap) : Infinity;
        return Math.min(raw, cap);
    }
    return 0;
}

/**
 * Calculate the negative streak penalty for a habit.
 * Only applies if tier is 'punish' or 'low' AND badStreak >= 2.
 * Capped by habit.streakCap if set. Returns a positive number — caller subtracts.
 */
export function getStreakPenalty(habit, tier, currentBadStreak) {
    if ((tier === 'punish' || tier === 'low') &&
        currentBadStreak >= 2 &&
        (habit.streakPenaltyPer || 0) > 0) {
        const raw = currentBadStreak * habit.streakPenaltyPer;
        const cap = habit.streakCap ? parseFloat(habit.streakCap) : Infinity;
        return Math.min(raw, cap);
    }
    return 0;
}

/**
 * Total payout for a habit including streak adjustments.
 * Excused habits return 0 regardless of tier.
 */
export function getTotalPayout(habit) {
    if (habit.excused) return 0;
    const cur  = getCurrentCount(habit);
    const tier = getTier(habit, cur);
    let payout = getBasePayout(habit, tier);
    payout += getStreakBonus(habit, tier, habit.streak || 0);
    payout -= getStreakPenalty(habit, tier, habit.badStreak || 0);
    return payout;
}

/**
 * Stars earned by a habit on weekly reset, based on tier and streak.
 * Returns { earned, reasons[] }.
 */
export function getStarsEarned(habit) {
    if (habit.excused) return { earned: 0, reasons: [] };
    const cur  = getCurrentCount(habit);
    const tier = getTier(habit, cur);
    const newStreak = (tier === 'goal' || tier === 'bonus') ? (habit.streak || 0) + 1 : 0;

    let earned = 0;
    const reasons = [];
    if (tier === 'goal'  && (habit.starGoal  || 0) > 0) { earned += habit.starGoal;  reasons.push(habit.name + ' Goal'); }
    if (tier === 'bonus' && (habit.starBonus || 0) > 0) { earned += habit.starBonus; reasons.push(habit.name + ' Bonus'); }
    if (newStreak >= 2   && (habit.starStreak|| 0) > 0) { earned += habit.starStreak;reasons.push(habit.name + ' Streak 🔥' + newStreak); }
    return { earned, reasons };
}
