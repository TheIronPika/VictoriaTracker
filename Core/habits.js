/**
 * VICTORIA TRACKER — Habit Core Logic
 * Tier calculations, payouts, and habit utilities
 */

import { utils } from './utils.js';

export const habits = {
    /**
     * Determine tier based on habit completion count
     * Returns: 'punish' | 'low' | 'goal' | 'bonus'
     */
    getTier(habit, count) {
        const thresholds = utils.getThresholds(habit);
        if (count >= thresholds.bonus) return 'bonus';
        if (count >= thresholds.goal) return 'goal';
        if (count >= thresholds.low) return 'low';
        return 'punish';
    },

    /**
     * Calculate base payout for a habit given its current tier
     */
    getBasePayout(habit, tier) {
        if (tier === 'punish') return habit.valPunish || 0;
        if (tier === 'low') return habit.valLow || 0;
        if (tier === 'goal') return habit.valGoal || 0;
        if (tier === 'bonus') return habit.valBonus || 0;
        return 0;
    },

    /**
     * Get current tier for a habit
     * Looks at last day's history (index 6)
     */
    getCurrentTier(habit) {
        const history = utils.sliceHistory(habit.history);
        const current = history[6] !== undefined ? history[6] : (history[history.length - 1] || 0);
        return this.getTier(habit, current);
    },

    /**
     * Get the completion count for a specific day
     */
    getDayCompletion(habit, dayIndex) {
        const history = utils.sliceHistory(habit.history);
        return history[dayIndex] || 0;
    },

    /**
     * Calculate if a habit would move when toggling a bubble
     */
    willCardMove(habit, oldQuantity, newValue) {
        return (oldQuantity === 0 && newValue > 0) || (newValue === 0 && oldQuantity > 0);
    },

    /**
     * Check if a habit is excused
     */
    isExcused(habit) {
        return habit.excused === true;
    },

    /**
     * Reset a habit's weekly history to all zeros
     */
    resetWeeklyHistory(habit) {
        return { ...habit, history: [0, 0, 0, 0, 0, 0, 0], excused: false };
    },

    /**
     * Update a habit's field (used in Manage tab)
     */
    updateField(habit, field, value) {
        const updated = { ...habit };
        
        if (field === 'note' || field === 'cycleType') {
            updated[field] = value;
        } else if (field.startsWith('val')) {
            updated[field] = parseFloat(value);
        } else if (field.startsWith('star')) {
            updated[field] = parseInt(value) || 0;
        } else if (field === 'streakBonusPer' || field === 'streakPenaltyPer' || field === 'streakCap') {
            updated[field] = parseFloat(value) || 0;
        } else {
            updated[field] = parseInt(value) || 1;
        }
        
        return updated;
    },

    /**
     * Toggle a bubble for a habit on a specific day
     * Propagates the new value to all remaining days of the week
     */
    toggleBubble(habit, dayIndex, bubbleLevel) {
        const history = [...(habit.history || [0, 0, 0, 0, 0, 0, 0])];
        const oldQty = history[dayIndex] || 0;
        const newVal = oldQty === bubbleLevel ? bubbleLevel - 1 : bubbleLevel;

        // Propagate forward to remaining days
        for (let i = dayIndex; i < 7; i++) {
            history[i] = newVal;
        }

        return { ...habit, history };
    },

    /**
     * Get daily max for a habit (how many completions per day)
     */
    getDailyMax(habit) {
        return habit.dailyMax || 1;
    }
};

export default habits;
