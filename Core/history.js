/**
 * VICTORIA TRACKER — History Management
 * Weekly snapshots and historical tracking
 */

import { habits as habitsModule } from './habits.js';
import { utils } from './utils.js';

export const history = {
    /**
     * Create a weekly history snapshot entry
     * Called after weekly reset
     */
    createWeekSnapshot(habitsArr, totalBalance, dateStr) {
        return {
            id: Date.now().toString(),
            weekEnding: dateStr,
            timestamp: Date.now(),
            totalBalance: totalBalance,
            habits: habitsArr.map(h => {
                const hist = utils.sliceHistory(h.history);
                const cur = hist[6] !== undefined ? hist[6] : (hist[hist.length - 1] || 0);
                const tier = habitsModule.getTier(h, cur);
                
                let payout = 0;
                if (tier === 'punish') payout = h.valPunish || 0;
                else if (tier === 'low') payout = h.valLow || 0;
                else if (tier === 'goal') payout = h.valGoal || 0;
                else if (tier === 'bonus') payout = h.valBonus || 0;

                return {
                    id: h.id,
                    name: h.name,
                    icon: h.icon,
                    cat: h.cat,
                    tier,
                    payout,
                    history: hist,
                    thresh: {
                        punish: h.punish || 1,
                        low: h.low || 3,
                        goal: h.goal || 5,
                        bonus: h.bonus || 7
                    }
                };
            })
        };
    },

    /**
     * Get total earnings across all weeks
     */
    getTotalAllTime(weeklyHistory) {
        return weeklyHistory.reduce((sum, week) => sum + (week.totalBalance || 0), 0);
    },

    /**
     * Get best week (highest earnings)
     */
    getBestWeek(weeklyHistory) {
        if (!weeklyHistory.length) return null;
        return weeklyHistory.reduce((best, week) => {
            return (week.totalBalance || 0) > (best.totalBalance || 0) ? week : best;
        }, weeklyHistory[0]);
    },

    /**
     * Get number of profitable weeks
     */
    getProfitableWeeks(weeklyHistory) {
        return weeklyHistory.filter(w => (w.totalBalance || 0) >= 0).length;
    },

    /**
     * Get all unique habit IDs across history
     */
    getAllHabitIds(weeklyHistory) {
        const ids = [];
        const seen = new Set();
        weeklyHistory.forEach(w => {
            (w.habits || []).forEach(h => {
                if (!seen.has(h.id)) {
                    ids.push(h.id);
                    seen.add(h.id);
                }
            });
        });
        return ids;
    },

    /**
     * Get cumulative payout per habit across all history
     */
    getCumulativePayoutPerHabit(weeklyHistory) {
        const totals = {};
        weeklyHistory.forEach(week => {
            (week.habits || []).forEach(h => {
                if (!totals[h.name]) {
                    totals[h.name] = { name: h.name, icon: h.icon || '', val: 0 };
                }
                totals[h.name].val += (h.payout || 0);
            });
        });
        return Object.values(totals).sort((a, b) => b.val - a.val);
    },

    /**
     * Get average payout per category per week
     */
    getAveragePayoutPerCategory(weeklyHistory) {
        const cats = {};
        weeklyHistory.forEach(week => {
            (week.habits || []).forEach(h => {
                if (!cats[h.cat]) cats[h.cat] = 0;
                cats[h.cat] += (h.payout || 0);
            });
        });

        const weeks = weeklyHistory.length || 1;
        const result = {};
        for (const [cat, total] of Object.entries(cats)) {
            result[cat] = total / weeks;
        }
        return result;
    },

    /**
     * Get week-by-week labels for charts (M/D format)
     */
    getWeekLabels(weeklyHistory, newestId) {
        return weeklyHistory.map(w => {
            if (w.id === newestId) return 'Now';
            const d = new Date(w.timestamp);
            return (d.getMonth() + 1) + '/' + d.getDate();
        });
    },

    /**
     * Check if we should show a particular week as "Current Week"
     */
    isCurrentWeek(weekId, weeklyHistory) {
        if (!weeklyHistory.length) return false;
        return weeklyHistory[0].id === weekId;
    }
};

export default history;
