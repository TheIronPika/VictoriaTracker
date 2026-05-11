// ─────────────────────────────────────────────────────────────────────
// core/reports.js
// Weekly report generation + four pure-ish helper phases that
// runWeeklyReport (in index.html) orchestrates.
//
// generateWeeklyReport — ASCII text report for legacy/fallback uses
// awardWeeklyStars     — phase 1: tally per-habit star rewards, sync
// applyStreakPayouts   — phase 2: add streak bonuses/penalties to total
// updateHabitStreaks   — phase 3: bump streak / badStreak / bestStreak
// advanceHabitCycles   — phase 4: reset history, advance cyclic habits
// ─────────────────────────────────────────────────────────────────────

import { getTier, getBasePayout } from './habits.js';
import { TIER_DOTS, TIER_LABELS } from './config.js';
import { cycleIntervalMs } from './cycles.js';
import { longDate, formatMoney } from './utils.js';
import { state } from './state.js';
import { syncStarData, addStarLog } from './stars.js';
import { isPeriodActive } from './period.js';

// ── Text report (kept for backwards compatibility / fallback) ─────────

export function generateWeeklyReport(habits) {
    let totalMoney = 0;
    const lines = [];

    habits.forEach(h => {
        const hist   = (h.history || []).slice(0, 7);
        const cur    = hist[6] !== undefined ? hist[6] : (hist[hist.length - 1] || 0);
        const tier   = getTier(h, cur);
        const payout = getBasePayout(h, tier);
        totalMoney += payout;

        const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
        const dots = days.map((d, i) => {
            const c = hist[i] || 0;
            return d + ':' + (c > 0 ? TIER_DOTS[getTier(h, c)] : '.');
        }).join('  ');

        lines.push(h.icon + ' ' + h.name);
        lines.push('  ' + dots);
        lines.push('  ' + TIER_LABELS[tier] + ' | ' + formatMoney(payout, true));
        lines.push('');
    });

    const dateStr  = longDate();
    const totalStr = formatMoney(totalMoney, true);
    const line     = '--------------------------------';

    const text =
        "VICTORIA'S WEEKLY REPORT\n" +
        'Week ending ' + dateStr + '\n' +
        'Key: D=Debt  L=Low  G=Goal  B=Bonus  .=No activity\n' +
        line + '\n\n' +
        lines.join('\n') +
        line + '\n' +
        'TOTAL BALANCE: ' + totalStr + '\n' +
        line;

    return { text, totalMoney, dateStr };
}

// Alias kept for callers that want the new naming
export const buildWeeklyReport = generateWeeklyReport;

// ── Phase 1: Star awards ──────────────────────────────────────────────
// Reads each habit's current tier and starGoal/starBonus/starStreak,
// adds to starBalance, and logs each award.

export async function awardWeeklyStars(habitsArr) {
    let totalStarsEarned = 0;
    habitsArr.forEach(h => {
        if (h.excused) return;
        const hist = (h.history || []).slice(0, 7);
        const cur  = hist[6] !== undefined ? hist[6] : (hist[hist.length - 1] || 0);
        const tier = getTier(h, cur);

        // Preview what the streak will be AFTER this reset
        const nextStreak = (tier === 'goal' || tier === 'bonus') ? (h.streak || 0) + 1 : 0;

        let earned = 0;
        const reasons = [];
        if (tier === 'goal'  && (h.starGoal  || 0) > 0) { earned += h.starGoal;   reasons.push(h.name + ' Goal'); }
        if (tier === 'bonus' && (h.starBonus || 0) > 0) { earned += h.starBonus;  reasons.push(h.name + ' Bonus'); }
        if (nextStreak >= 2  && (h.starStreak || 0) > 0) { earned += h.starStreak; reasons.push(h.name + ' Streak 🔥' + nextStreak); }

        if (earned > 0) {
            totalStarsEarned += earned;
            addStarLog('earn', earned, reasons.join(' + '));
        }
    });
    if (totalStarsEarned > 0) {
        state.starBalance += totalStarsEarned;
        await syncStarData();
    }
    return totalStarsEarned;
}

// ── Phase 2: Streak bonus/penalty payouts ─────────────────────────────
// Pure: reads habit state, returns updated totalMoney.

export function applyStreakPayouts(habitsArr, totalMoney) {
    habitsArr.forEach(h => {
        if (h.excused) return;
        const hist = (h.history || []).slice(0, 7);
        const cur  = hist[6] !== undefined ? hist[6] : (hist[hist.length - 1] || 0);
        const tier = getTier(h, cur);
        const streak    = h.streak    || 0;
        const badStreak = h.badStreak || 0;

        if ((tier === 'goal' || tier === 'bonus') && streak >= 2 && (h.streakBonusPer || 0) > 0) {
            const raw = streak * (h.streakBonusPer || 0);
            const cap = h.streakCap ? parseFloat(h.streakCap) : Infinity;
            totalMoney += Math.min(raw, cap);
        }
        if ((tier === 'punish' || tier === 'low') && badStreak >= 2 && (h.streakPenaltyPer || 0) > 0) {
            const raw = badStreak * (h.streakPenaltyPer || 0);
            const cap = h.streakCap ? parseFloat(h.streakCap) : Infinity;
            totalMoney -= Math.min(raw, cap);
        }
    });
    return totalMoney;
}

// ── Phase 3: Update streak counters ───────────────────────────────────
// Pure: returns a new habits array with streak/badStreak/bestStreak updated.
// Excused habits and period-sensitive habits (during active period)
// have their streak frozen — neither incremented nor reset.

export function updateHabitStreaks(habitsArr) {
    return habitsArr.map(h => {
        if (h.excused) return { ...h };
        if ((isPeriodActive() || state.periodData.periodWasThisWeek) && !!h.periodSensitive) return { ...h };
        const hist      = (h.history || []).slice(0, 7);
        const cur       = hist[6] !== undefined ? hist[6] : (hist[hist.length - 1] || 0);
        const tier      = getTier(h, cur);
        const isGood    = tier === 'goal' || tier === 'bonus';
        const streak    = isGood ? (h.streak    || 0) + 1 : 0;
        const badStreak = !isGood ? (h.badStreak || 0) + 1 : 0;
        const best      = Math.max(streak, h.bestStreak || 0);
        return { ...h, streak, badStreak, bestStreak: best };
    });
}

// ── Phase 4: Reset history & advance cycles ───────────────────────────
// All habits get history reset to zeros and excused cleared.
// Cyclic habits that completed get a new cycleNextDue.

export function advanceHabitCycles(habitsArr) {
    return habitsArr.map(h => {
        if (h.cycleType && h.cycleType !== 'none') {
            const hist      = (h.history || []).slice(0, 7);
            const cur       = hist[6] !== undefined ? hist[6] : (hist[hist.length - 1] || 0);
            const completed = getTier(h, cur) === 'goal' || getTier(h, cur) === 'bonus';
            if (completed) {
                return { ...h, history: [0, 0, 0, 0, 0, 0, 0], excused: false,
                                cycleNextDue: Date.now() + cycleIntervalMs(h) };
            }
        }
        return { ...h, history: [0, 0, 0, 0, 0, 0, 0], excused: false };
    });
}
