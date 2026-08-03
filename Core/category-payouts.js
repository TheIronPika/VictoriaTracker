// ─────────────────────────────────────────────────────────────────────
// Core/category-payouts.js
// Category-wide weekly payout MATH. Pure functions — no DOM, no Firebase,
// no state. Imported by:
//   • Core/weeklyReset.js       (Monday payout — runs under plain Node too)
//   • Core/category-config.js   (live headline total)
//   • web/ui/render.js          (Today-view progress line)
//   • native TodayView.tsx      (same progress line)
//
// Deliberately free of ./firebase.js: weeklyReset.js runs inside the GitHub
// Action under plain Node, where firebase.js's CDN imports don't resolve.
// Persistence for this feature lives in Core/category-config.js instead.
// If you change the tier rule, change it HERE — callers must not
// re-implement it (getStarsEarned already drifted that way once).
//
// THE RULE: a category's tier is the LOWEST tier any counting habit
// reached. "All at goal" pays the goal reward; one straggler at low drags
// the whole category to low. That single rule covers every case — there is
// no separate "did they all hit it?" boolean.
//
// Counting habits EXCLUDE:
//   • not-yet-due cyclic habits  — dormant, not even rendered
//   • resting habits (Rest Week) — she spent a token to sit this one out;
//     blocking the category payout would turn that token into a trap
//   • period-protected habits    — same neutrality the payout math gives them
// A category with NO counting habits scores nothing (see the guard below).
//
// Doc shape (persisted by Core/category-config.js):
//   { categories: { "Personal": {
//       punish: { dollars: -2 },
//       low:    { dollars: 0 },
//       goal:   { dollars: 5,  stars: 2, restWeek: 0, dayPass: 1, freshStart: 0 },
//       bonus:  { dollars: 10, stars: 5, restWeek: 1, dayPass: 1, freshStart: 1 }
//   } } }
// punish/low are dollars-only, mirroring habits (which have valPunish and
// valLow but no starPunish/starLow) — negative stars/tokens would mean
// confiscating things she already earned.
// ─────────────────────────────────────────────────────────────────────

import { getTier, weekTotal } from './habits.js';
import { isCycleDue } from './cycles.js';

// Tier ranking, lowest first — the category takes the minimum.
export const TIER_RANK = { punish: 0, low: 1, goal: 2, bonus: 3 };
const RANK_TIER = ['punish', 'low', 'goal', 'bonus'];

/** Reward keys a tier can carry. punish/low only ever use `dollars`. */
export const REWARD_KEYS = ['dollars', 'stars', 'restWeek', 'dayPass', 'freshStart'];

/** Tiers that can carry stars/tokens (punish/low are dollars-only). */
export const REWARD_TIERS = ['punish', 'low', 'goal', 'bonus'];

/** An all-zero reward — returned whenever nothing is configured. */
export function emptyReward() {
    return { dollars: 0, stars: 0, restWeek: 0, dayPass: 0, freshStart: 0 };
}

/** True if a reward would actually pay nothing (every field zero). */
export function rewardIsEmpty(r) {
    if (!r) return true;
    return REWARD_KEYS.every(k => !(r[k] || 0));
}

/**
 * Normalize whatever is stored for one tier into a full reward object.
 * Missing fields and missing tiers both read as zero, so an unconfigured
 * category is inert rather than a crash.
 */
export function readReward(catCfg, tier) {
    const out = emptyReward();
    if (!catCfg || !tier) return out;
    const raw = catCfg[tier];
    if (!raw || typeof raw !== 'object') return out;
    for (const k of REWARD_KEYS) {
        const n = parseFloat(raw[k]);
        out[k] = Number.isFinite(n) ? n : 0;
    }
    // Stars and tokens are whole things; only dollars may be fractional.
    for (const k of ['stars', 'restWeek', 'dayPass', 'freshStart']) {
        out[k] = Math.trunc(out[k]);
    }
    return out;
}

/**
 * Compute one category's weekly result. PURE.
 * Both the live UI and the Monday reset call this, so they can never disagree.
 *
 * @param {string}   cat     category name (habit.cat)
 * @param {object[]} habits  every habit (filtered internally)
 * @param {object}   opts
 *   opts.config             the categories map — {} if unconfigured
 *   opts.periodActive       bool
 *   opts.periodWasThisWeek  bool
 * @returns {{
 *   cat: string, tier: string|null, counting: object[], atTier: number,
 *   total: number, reward: object, laggards: object[]
 * }}
 *   tier === null means "nothing to score" (no counting habits) and the
 *   reward is all zeros. Callers must not treat that as a win.
 */
export function computeCategoryResult(cat, habits, opts = {}) {
    const config            = opts.config || {};
    const periodActive      = !!opts.periodActive;
    const periodWasThisWeek = !!opts.periodWasThisWeek;

    // Period protection uses the same "was it protected at any point this
    // week" test as the streak roll (weeklyReset.js streakFrozenH), not the
    // instantaneous one computeWeeklyPayout uses — a category payout is a
    // whole-week determination, so a period that ended Wednesday still
    // protects that habit for this week's category math.
    const periodProtected = h =>
        (periodActive || periodWasThisWeek) && !!h.periodSensitive;

    const counting = (habits || []).filter(h =>
        h && h.cat === cat &&
        isCycleDue(h) &&
        !h.excused &&
        !periodProtected(h)
    );

    const catCfg = config[cat];

    // Vacuous-truth guard: over an EMPTY set, "every habit hit goal" is
    // trivially true — which would hand her a free payout every week for a
    // category she rested entirely. Score nothing instead.
    if (!counting.length) {
        return { cat, tier: null, counting, atTier: 0, total: 0,
                 reward: emptyReward(), laggards: [],
                 nextTier: null, nextReward: emptyReward() };
    }

    let minRank = TIER_RANK.bonus;
    const tiers = new Map();
    for (const h of counting) {
        // Week TOTAL, not the as-of-viewed-day cumulative the mini-dots use —
        // payout math is weekly, and mixing the two would make the progress
        // line contradict what actually pays out.
        const t = getTier(h, weekTotal(h.history));
        tiers.set(h, t);
        if (TIER_RANK[t] < minRank) minRank = TIER_RANK[t];
    }

    const tier   = RANK_TIER[minRank];
    const reward = readReward(catCfg, tier);
    // The habits sitting at the tier holding the category back — what the UI
    // points at when it says "2 to go". Every one of them must climb a tier
    // for the category to reach the next rung, so laggards.length IS the
    // "how many to go" number.
    const laggards = counting.filter(h => TIER_RANK[tiers.get(h)] === minRank);
    const atTier   = counting.length - laggards.length;

    // The next rung UP that actually pays something — what the progress line
    // dangles. Skips tiers configured with nothing, so a category that only
    // rewards bonus reads "3 to go for Bonus" from punish, not "for Low".
    let nextTier = null, nextReward = emptyReward();
    for (let rank = minRank + 1; rank <= TIER_RANK.bonus; rank++) {
        const candidate = readReward(catCfg, RANK_TIER[rank]);
        if (!rewardIsEmpty(candidate)) {
            nextTier   = RANK_TIER[rank];
            nextReward = candidate;
            break;
        }
    }

    return { cat, tier, counting, atTier, total: reward.dollars, reward,
             laggards, nextTier, nextReward };
}

/**
 * Every present category's result for the week. Categories come from the
 * habits themselves (there is no category entity), so unconfigured ones are
 * included too — they just return zero rewards.
 */
export function computeAllCategoryResults(habits, opts = {}) {
    const cats = [...new Set((habits || []).map(h => h && h.cat).filter(Boolean))];
    return cats.map(cat => computeCategoryResult(cat, habits, opts));
}

/** Dollar sum across every category — the term the money headlines add in. */
export function sumCategoryDollars(results) {
    return (results || []).reduce((sum, r) => sum + (r.total || 0), 0);
}

/** Human tier names for UI copy. */
export const TIER_LABEL = { punish: 'Debt', low: 'Low', goal: 'Goal', bonus: 'Bonus' };

/**
 * Render a reward as a compact string: "+$10 ✨5 🌿1 🎫2 ☀️1".
 * Shared so the PWA and the native app can never drift on token icons —
 * these are the post-rename names (Rest Week / Day Pass / Fresh Start).
 * Returns '' for an empty reward.
 */
export function formatReward(r) {
    if (!r) return '';
    const parts = [];
    const d = r.dollars || 0;
    if (d) parts.push((d < 0 ? '−$' : '+$') + Math.abs(d).toFixed(2).replace(/\.00$/, ''));
    if (r.stars      > 0) parts.push('✨' + r.stars);
    if (r.restWeek   > 0) parts.push('🌿' + r.restWeek);
    if (r.dayPass    > 0) parts.push('🎫' + r.dayPass);
    if (r.freshStart > 0) parts.push('☀️' + r.freshStart);
    return parts.join(' ');
}
