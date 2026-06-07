// ─────────────────────────────────────────────────────────────────────
// core/cycles.js
// Cyclic habit scheduling. Pure functions — no state.
// Used to determine if a cyclic habit should be visible this week.
// ─────────────────────────────────────────────────────────────────────

const DAY_MS = 86400000;

/**
 * The interval (in ms) for one cycle of this habit.
 * Returns 0 if the habit isn't cyclic.
 */
export function cycleIntervalMs(habit) {
    switch (habit.cycleType) {
        case 'weeks':     return (habit.cycleEvery || 1) * 7 * DAY_MS;
        case 'monthly':   return 30  * DAY_MS;
        case 'quarterly': return 91  * DAY_MS;
        case 'yearly':    return 365 * DAY_MS;
        default:          return 0;
    }
}

/**
 * Whether a cyclic habit should be visible right now.
 * Non-cyclic habits are always due.
 */
export function isCycleDue(habit) {
    if (!habit.cycleType || habit.cycleType === 'none') return true;
    const interval = cycleIntervalMs(habit);
    if (!interval) return true;
    const nextDue = habit.cycleNextDue || 0;
    return Date.now() >= nextDue;
}

/**
 * True for any habit with a real cycleType (not 'none').
 */
export function isCyclic(habit) {
    return !!(habit.cycleType && habit.cycleType !== 'none');
}

/**
 * Whole weeks past the cyclic habit's due date. 0 if non-cyclic, no due date
 * set, or still before the due date. The reset uses this to reduce a positive
 * payout when she finally completes a late cycle — cyclic habits don't take
 * weekly negative hits, but the eventual payout shrinks the longer she waits.
 */
export function weeksLate(habit, now = Date.now()) {
    if (!isCyclic(habit) || !habit.cycleNextDue) return 0;
    return Math.max(0, Math.floor((now - habit.cycleNextDue) / (7 * DAY_MS)));
}

/**
 * Short label describing the cycle (e.g. "Every 2w", "Monthly").
 */
export function cycleLabel(habit) {
    if (!habit.cycleType || habit.cycleType === 'none') return '';
    const labels = {
        weeks:     `Every ${habit.cycleEvery || 1}w`,
        monthly:   'Monthly',
        quarterly: 'Quarterly',
        yearly:    'Yearly'
    };
    return labels[habit.cycleType] || '';
}

/**
 * Human-readable string for when the cycle is next due.
 * E.g. "Due back 12/3".
 */
export function cycleDueLabel(habit) {
    if (!habit.cycleNextDue) return '';
    const d = new Date(habit.cycleNextDue);
    return 'Due back ' + (d.getMonth() + 1) + '/' + d.getDate();
}
