// ─────────────────────────────────────────────────────────────────────
// Core/habits.js
// Single source of truth for per-habit weekly payout math.
// Pure functions — no DOM, no Firebase, no state. Imported by:
//   • web/ui/render.js       (live "This Week's Balance" headline)
//   • web/ui/manage-ui.js    (Streak $ panel _thisWeekBreakdown)
//   • scripts/reset.js       (Monday payout via Node — runs the same code)
// If you change tier/payout math, change it HERE. The three callers above
// consume the result; they should not re-implement the formula.
// ─────────────────────────────────────────────────────────────────────

import { isCyclic, weeksLate } from './cycles.js';

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
 * Last day in the 7-day history (= today's running count). Falls back to
 * whatever's at the end if history is shorter than 7.
 */
export function getCurrentCount(habit) {
    const hist = (habit.history || []).slice(0, 7);
    return hist[6] !== undefined ? hist[6] : (hist[hist.length - 1] || 0);
}

/**
 * Raw per-tier base payout (the habit's valPunish/valLow/valGoal/valBonus).
 * No streak/bounty/period adjustments — those live in computeWeeklyPayout.
 * Used by history.js when recording a weekly snapshot's per-habit payout.
 */
export function getBasePayout(habit, tier) {
    if (tier === 'punish') return habit.valPunish || 0;
    if (tier === 'low')    return habit.valLow    || 0;
    if (tier === 'goal')   return habit.valGoal   || 0;
    if (tier === 'bonus')  return habit.valBonus  || 0;
    return 0;
}

/**
 * Compute the full per-habit weekly payout in one place.
 *
 * Inputs:
 *   habit         — the habit document
 *   opts.periodActive  — bool, is period currently active (for periodSensitive)
 *   opts.now      — timestamp, defaults to Date.now() (only used for weeksLate)
 *
 * Returns a structured breakdown so callers can render component-by-component
 * (Streak $ panel) or just take total (headline + reset). The semantics
 * (cyclic suppresses weekly negatives, late completion reduces positive
 *  payout, period protection zeroes punish + skips bad-streak penalty,
 *  bounty pays once on goal/bonus) are all encoded here.
 */
export function computeWeeklyPayout(habit, opts = {}) {
    const periodActive    = !!opts.periodActive;
    const now             = opts.now || Date.now();
    const periodProtected = periodActive && !!habit.periodSensitive;
    const cyclic          = isCyclic(habit);
    const wkLate          = cyclic ? weeksLate(habit, now) : 0;

    const cur  = getCurrentCount(habit);
    const tier = getTier(habit, cur);
    const cap  = habit.streakCap ? parseFloat(habit.streakCap) : Infinity;

    let base = 0;
    let lateReduction = 0;
    let goodStreak = 0;
    let badStreak  = 0;
    let bounty     = 0;

    if (!habit.excused) {
        if (tier === 'punish') {
            // Cyclic habits never take a weekly negative; non-cyclic take
            // valPunish unless period-protected.
            base = cyclic ? 0 : (periodProtected ? 0 : (habit.valPunish || 0));
        }
        else if (tier === 'low')   base = habit.valLow  || 0;
        else if (tier === 'goal')  base = habit.valGoal || 0;
        else if (tier === 'bonus') base = habit.valBonus|| 0;

        // Cyclic late-completion reduction: when a positive payout lands after
        // a late cycle, knock streakPenaltyPer × weeksLate off the top.
        if (cyclic && wkLate > 0 && base > 0 && (habit.streakPenaltyPer || 0) > 0) {
            const requested = wkLate * habit.streakPenaltyPer;
            lateReduction = Math.min(requested, base);
            base -= lateReduction;
        }

        // Flat per-week streak bonus on any goal/bonus week.
        if ((tier === 'goal' || tier === 'bonus') && (habit.streakBonusPer || 0) > 0) {
            goodStreak = Math.min(habit.streakBonusPer, cap);
        }
        // Flat per-week streak penalty on punish/low weeks — skipped for cyclic
        // habits (no weekly negative) and period-protected habits.
        if (!cyclic && !periodProtected && (tier === 'punish' || tier === 'low') && (habit.streakPenaltyPer || 0) > 0) {
            badStreak = -Math.min(habit.streakPenaltyPer, cap);
        }

        // Bounty pays once on a goal/bonus week and clears at reset.
        if (habit.bountyActive && (tier === 'goal' || tier === 'bonus') && (habit.bountyDollars || 0) > 0) {
            bounty = habit.bountyDollars;
        }
    }

    const total = base + goodStreak + badStreak + bounty;

    return {
        tier, base, lateReduction, goodStreak, badStreak, bounty, total,
        cyclic, weeksLate: wkLate, periodProtected,
        excused: !!habit.excused
    };
}

/**
 * Stars earned by a habit on weekly reset, based on tier and streak.
 * Returns { earned, reasons[] }. Bounty stars are handled separately by the
 * reset script (they require bounty active + clearing state).
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
