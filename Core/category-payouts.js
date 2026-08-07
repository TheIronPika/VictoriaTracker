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
// THE RULE (revised 2026-08-06 — ONE FORGIVEN STRAGGLER):
// A category reaches a tier when every counting habit got there, EXCEPT that
// a single habit sitting exactly ONE tier below is forgiven.
//
//   6 at Bonus + 1 at Goal   → Bonus  (the lone Goal is forgiven)
//   5 at Bonus + 2 at Goal   → Goal   (two below, no forgiveness left)
//   6 at Bonus + 1 at Low    → Goal   (the straggler is TWO tiers down, so it
//                                      can't be forgiven at Bonus; at Goal it
//                                      is only one down, so Goal qualifies)
//
// Forgiveness is per-rung, not per-week: the category takes the HIGHEST tier
// that qualifies. It replaces the old strict-minimum rule, under which one
// straggler dragged the whole category down — over 15 weeks of real history
// that produced Debt for all five categories, every single week.
//
// Two guards keep it honest:
//   • Only the CLOSEST habit below the tier can be forgiven, and only when
//     it is exactly one rung down. A habit two or more rungs down always
//     blocks — otherwise a single punish habit would ride a bonus category.
//   • At least one habit must actually BE at or above the tier. Without this
//     a lone habit in a category would forgive itself into the rung above
//     (one habit at Goal, nothing else → "Bonus"), which is nonsense.
//
// THE MAXED-OUT EXCEPTION: a habit whose `bonus` threshold sits above its
// `max` (weekly ceiling) can NEVER return 'bonus' from getTier — so under
// the bare rule above it pinned its whole category at 'goal' forever, and
// the category's configured bonus reward was dead config that could never
// pay. A habit that hit its own ceiling has done everything it is possible
// to do that week, so it counts as 'bonus' for CATEGORY math only (its own
// per-habit payout is untouched — that still comes from getTier).
// Guarded to habits already at goal or better: a habit whose max sits below
// its own low/goal thresholds is misconfigured, and promoting it would hand
// out a bonus payout for a week that visibly scored punish/low.
//
// Counting habits EXCLUDE:
//   • ALL cyclic habits          — a category payout is a WEEKLY judgement, and
//     a monthly/quarterly/yearly habit isn't a weekly commitment. Including one
//     only on the weeks it happens to fall due made the category silently
//     harder to clear on those weeks and easier on the rest, which is not a
//     rule anyone could hold in their head. Excluded outright as of 2026-08-06
//     (was `isCycleDue(h)`, i.e. included whenever due).
//   • resting habits (Rest Week) — she spent a token to sit this one out;
//     blocking the category payout would turn that token into a trap
//   • period-protected habits    — same neutrality the payout math gives them
// A category with NO counting habits scores nothing (see the guard below).
//
// Seasonal events need no exclusion here: they live in state.seasonalEvents
// (system/seasonal_events), carry no `cat`, and are never members of
// state.habits — so they have never entered this math and can't.
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
import { isCyclic } from './cycles.js';

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
 * A habit's weekly ceiling — the most completions it can bank. Mirrors the
 * `h.max || 7` fallback the bubble UI and the Day Pass gate already use.
 */
export function habitMax(habit) {
    const n = parseFloat(habit && habit.max);
    return Number.isFinite(n) && n > 0 ? n : 7;
}

/**
 * True if `habit` literally cannot reach 'bonus': its bonus threshold sits
 * above its weekly ceiling, so getTier can never return 'bonus' for it.
 */
export function bonusUnreachable(habit) {
    if (!habit) return false;
    // `habit.bonus || 7` exactly as getTier reads it — 0/blank means default.
    return (habit.bonus || 7) > habitMax(habit);
}

/**
 * The tier a habit contributes to its CATEGORY's minimum — getTier, except a
 * habit that hit its own weekly ceiling counts as 'bonus'. See the
 * MAXED-OUT EXCEPTION note at the top of this file.
 *
 * Only affects category math. A habit's own dollars/stars/streak still come
 * straight from getTier in habits.js — a goal-capped habit banks its goal
 * payout, not its (unreachable) bonus payout.
 */
export function effectiveCategoryTier(habit, total) {
    const tier = getTier(habit, total);
    if (TIER_RANK[tier] >= TIER_RANK.goal && total >= habitMax(habit)) {
        return 'bonus';
    }
    return tier;
}

/**
 * Effective category rank for each habit, in the input's order.
 * Applies the maxed-out promotion — this is the number the tier rule reads.
 */
export function categoryRanks(counting) {
    return (counting || []).map(h => TIER_RANK[effectiveCategoryTier(h, weekTotal(h.history))]);
}

/**
 * The habits still blocking this category from reaching `rank`.
 *
 * Under the one-forgiven-straggler rule the closest habit below the tier is
 * pardoned when it sits exactly one rung down, so it is NOT returned here —
 * `blockersForRank(...).length` is therefore a truthful "how many still need
 * to move up" for any rung, which `laggards.length` alone never was.
 *
 * Returns them worst-first, so the UI naming names the furthest behind first.
 */
export function blockersForRank(counting, rank) {
    const list = (counting || []).map(h => ({ h, r: TIER_RANK[effectiveCategoryTier(h, weekTotal(h.history))] }));
    const below = list.filter(x => x.r < rank).sort((a, b) => b.r - a.r); // closest first
    if (!below.length) return [];
    // Pardon the closest, but only if it's exactly one rung down AND the
    // category has a second habit that could hold the tier. A lone habit can
    // never be its own forgiven straggler — with n=1 it must climb, so
    // reporting "0 to go" would be a lie (and would contradict qualifiesFor,
    // which refuses a tier no habit has actually reached).
    const canPardon = below[0].r === rank - 1 && list.length >= 2;
    return below.slice(canPardon ? 1 : 0).sort((a, b) => a.r - b.r).map(x => x.h);
}

/** True when the category legitimately reaches `rank`. */
function qualifiesFor(counting, rank) {
    if (rank <= TIER_RANK.punish) return true;               // the floor is free
    const ranks = categoryRanks(counting);
    // Somebody has to actually be there — forgiveness can't carry an empty tier.
    if (!ranks.some(r => r >= rank)) return false;
    return blockersForRank(counting, rank).length === 0;
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

    // Weekly habits only — see the EXCLUDE note at the top of this file.
    const counting = (habits || []).filter(h =>
        h && h.cat === cat &&
        !isCyclic(h) &&
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

    // Highest rung that qualifies under the one-forgiven-straggler rule.
    // Walks DOWN from bonus and stops at the first that holds — the old code
    // took a plain minimum, which can't express forgiveness.
    // Week TOTAL, not the as-of-viewed-day cumulative the mini-dots use —
    // payout math is weekly, and mixing the two would make the progress line
    // contradict what actually pays out (effectiveCategoryTier handles that).
    let achieved = TIER_RANK.punish;
    for (let r = TIER_RANK.bonus; r > TIER_RANK.punish; r--) {
        if (qualifiesFor(counting, r)) { achieved = r; break; }
    }

    const tier   = RANK_TIER[achieved];
    const reward = readReward(catCfg, tier);
    const ranks  = categoryRanks(counting);
    const atTier = ranks.filter(r => r >= achieved).length;

    // The next rung UP that actually pays something — what the progress line
    // dangles. Skips tiers configured with nothing, so a category that only
    // rewards bonus reads "3 to go for Bonus" from punish, not "for Low".
    let nextTier = null, nextReward = emptyReward(), nextRank = achieved + 1;
    for (let rank = achieved + 1; rank <= TIER_RANK.bonus; rank++) {
        const candidate = readReward(catCfg, RANK_TIER[rank]);
        if (!rewardIsEmpty(candidate)) {
            nextTier   = RANK_TIER[rank];
            nextReward = candidate;
            nextRank   = rank;
            break;
        }
    }

    // Who must still climb for the NEXT rung — the set the UI names when it
    // says "2 to go". Keyed to nextRank rather than the achieved tier, and
    // already excluding the habit that rung would forgive, so laggards.length
    // is a truthful count of moves required.
    const laggards = nextRank <= TIER_RANK.bonus
        ? blockersForRank(counting, nextRank)
        : [];

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
