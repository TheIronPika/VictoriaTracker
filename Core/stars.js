/**
 * VICTORIA TRACKER — Star System
 * Earning, spending, and shop management
 */

export const stars = {
    /**
     * Calculate stars earned for a habit this week
     * Returns { earned: N, reasons: [strings] }
     */
    calculateStarsEarned(habit, tier) {
        if (habit.excused) return { earned: 0, reasons: [] };

        let earned = 0;
        const reasons = [];

        // Goal bonus
        if (tier === 'goal' && (habit.starGoal || 0) > 0) {
            earned += habit.starGoal;
            reasons.push(`${habit.name} Goal`);
        }

        // Bonus bonus
        if (tier === 'bonus' && (habit.starBonus || 0) > 0) {
            earned += habit.starBonus;
            reasons.push(`${habit.name} Bonus`);
        }

        return { earned, reasons };
    },

    /**
     * Calculate streak stars
     * Returns additional stars earned if streak >= 2
     */
    calculateStreakStars(habit, newStreak) {
        if (newStreak < 2) return { earned: 0, reason: '' };
        if (!habit.starStreak) return { earned: 0, reason: '' };

        return {
            earned: habit.starStreak,
            reason: `${habit.name} Streak 🔥${newStreak}`
        };
    },

    /**
     * Add entry to star log
     * type: 'earn' | 'spend'
     * amount: number of stars
     * reason: string describing why
     */
    logStarTransaction(type, amount, reason) {
        return {
            ts: Date.now(),
            type,
            amount,
            reason
        };
    },

    /**
     * Trim star log to max length (keep recent entries)
     */
    trimStarLog(log, maxLength = 200) {
        if (log.length > maxLength) {
            return log.slice(0, maxLength);
        }
        return log;
    },

    /**
     * Redeem a shop item
     * Returns updated balance, spent, and new log entry
     */
    redeemItem(currentBalance, currentSpent, item) {
        const canRedeem = currentBalance >= item.cost;
        if (!canRedeem) {
            throw new Error(`Not enough stars. Need ${item.cost}, have ${currentBalance}`);
        }

        return {
            newBalance: currentBalance - item.cost,
            newSpent: currentSpent + item.cost,
            logEntry: this.logStarTransaction('spend', item.cost, `Redeemed: ${item.name}`)
        };
    },

    /**
     * Award manual stars
     */
    awardStars(currentBalance, amount, note) {
        return {
            newBalance: currentBalance + amount,
            logEntry: this.logStarTransaction('earn', amount, note || 'Manual award')
        };
    },

    /**
     * Check if a shop item can be redeemed
     */
    canRedeem(balance, item) {
        return balance >= item.cost;
    },

    /**
     * Format star balance for display
     */
    formatBalance(balance) {
        return `✨ ${balance} stars`;
    }
};

export default stars;
