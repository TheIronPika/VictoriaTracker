/**
 * VICTORIA TRACKER — Core Utilities
 * Shared helper functions used across all modules
 */

export const utils = {
    /**
     * Get the day index of a date (0=Mon, 6=Sun)
     */
    getDayIdx(date) {
        const d = date.getDay();
        return d === 0 ? 6 : d - 1;
    },

    /**
     * Get milliseconds for a cycle interval
     */
    cycleIntervalMs(habit) {
        const DAY = 86400000;
        switch (habit.cycleType) {
            case 'weeks':     return (habit.cycleEvery || 1) * 7 * DAY;
            case 'monthly':   return 30 * DAY;
            case 'quarterly': return 91 * DAY;
            case 'yearly':    return 365 * DAY;
            default:          return 0;
        }
    },

    /**
     * Check if a cyclic habit is currently due
     */
    isCycleDue(habit) {
        if (!habit.cycleType || habit.cycleType === 'none') return true;
        const interval = this.cycleIntervalMs(habit);
        if (!interval) return true;
        const nextDue = habit.cycleNextDue || 0;
        return Date.now() >= nextDue;
    },

    /**
     * Get the cycle schedule label for display
     */
    cycleLabel(habit) {
        if (!habit.cycleType || habit.cycleType === 'none') return '';
        const labels = {
            weeks: `Every ${habit.cycleEvery || 1}w`,
            monthly: 'Monthly',
            quarterly: 'Quarterly',
            yearly: 'Yearly'
        };
        return labels[habit.cycleType] || '';
    },

    /**
     * Get the "Due back" label for cyclic habits
     */
    cycleDueLabel(habit) {
        if (!habit.cycleNextDue) return '';
        const d = new Date(habit.cycleNextDue);
        return 'Due back ' + (d.getMonth() + 1) + '/' + d.getDate();
    },

    /**
     * Format currency for display
     */
    formatMoney(amount) {
        return (amount < 0 ? '-$' : '$') + Math.abs(amount).toFixed(2);
    },

    /**
     * Slice history array safely (max 7 days)
     */
    sliceHistory(history) {
        return (history || []).slice(0, 7);
    },

    /**
     * Get current tier label name
     */
    getTierLabel(tier) {
        const labels = { punish: 'DEBT', low: 'LOW', goal: 'GOAL', bonus: 'BONUS' };
        return labels[tier] || 'UNKNOWN';
    },

    /**
     * Get tier color hex
     */
    getTierColor(tier) {
        const colors = {
            punish: '#d9534f',
            low: '#e67e22',
            goal: '#27ae60',
            bonus: '#8e44ad'
        };
        return colors[tier] || '#999';
    },

    /**
     * Parse threshold tiers from habit
     */
    getThresholds(habit) {
        return {
            punish: habit.punish || 1,
            low: habit.low || 3,
            goal: habit.goal || 5,
            bonus: habit.bonus || 7
        };
    }
};

export default utils;
