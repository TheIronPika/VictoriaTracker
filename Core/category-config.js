// ─────────────────────────────────────────────────────────────────────
// Core/category-config.js
// Firestore persistence for category-wide payouts (system/category_config),
// plus the live headline total.
//
// Split from Core/category-payouts.js on purpose: that file holds the pure
// math and is imported by Core/weeklyReset.js, which must run under plain
// Node inside the GitHub Action — where this file's ./firebase.js import
// (CDN URLs) would not resolve. Keep Firebase on this side of the line.
// ─────────────────────────────────────────────────────────────────────

import { state, setCategoryConfig } from './state.js';
import { readDoc, writeDoc, watchDoc } from './firebase.js';
import { FIRESTORE_DOCS } from './config.js';
import { isPeriodActive } from './period.js';
import {
    computeAllCategoryResults, sumCategoryDollars,
    TIER_RANK, REWARD_KEYS
} from './category-payouts.js';

/** One-time load. Safe on first run (no doc → {}). */
export async function loadCategoryConfig() {
    try {
        const data = await readDoc(FIRESTORE_DOCS.CATEGORIES);
        setCategoryConfig((data && data.categories) || {});
    } catch (e) {
        console.warn('loadCategoryConfig failed:', e.message);
        setCategoryConfig({});
    }
    // Set even on failure, so a read error doesn't wedge the payout
    // aggregator at 0 forever (same reasoning as loadSectionOrder).
    state.categoryConfigLoaded = true;
}

/** Live-subscribe so edits from another tab/device sync in. */
export function watchCategoryConfig() {
    return watchDoc(FIRESTORE_DOCS.CATEGORIES, (data) => {
        setCategoryConfig((data && data.categories) || {});
        state.categoryConfigLoaded = true;
        window.render?.();
    });
}

/** Push the current config to Firestore. */
export async function saveCategoryConfig() {
    await writeDoc(FIRESTORE_DOCS.CATEGORIES, { categories: state.categoryConfig });
}

/**
 * Every category's result for the current week, read from live state.
 * The UI's one-stop call — render.js uses it for the per-category progress
 * line and manage-ui.js for the Streak $ breakdown.
 */
export function currentCategoryResults() {
    if (!state.categoryConfigLoaded) return [];
    return computeAllCategoryResults(state.habits, {
        config:            state.categoryConfig,
        periodActive:      isPeriodActive(),
        periodWasThisWeek: !!(state.periodData && state.periodData.periodWasThisWeek),
    });
}

/**
 * Dollar total across all categories, for the live "This Week's Balance"
 * headline. Mirrors getRoomPayoutsTotal / getEventPayoutsTotal — returns 0
 * until the config doc loads, so the headline never shows a half-computed
 * number.
 */
export function getCategoryPayoutsTotal() {
    if (!state.categoryConfigLoaded) return 0;
    return sumCategoryDollars(currentCategoryResults());
}

/**
 * Set one reward field on one category/tier, then persist.
 * Creates the category and tier objects on first write, and prunes empty
 * ones so the doc stays sparse (an untouched category never appears).
 *
 * @param {string} cat   category name
 * @param {string} tier  'punish' | 'low' | 'goal' | 'bonus'
 * @param {string} key   one of REWARD_KEYS
 * @param {number|string} value
 */
export async function setCategoryReward(cat, tier, key, value) {
    if (!cat) return;
    if (!Object.prototype.hasOwnProperty.call(TIER_RANK, tier)) return;
    if (!REWARD_KEYS.includes(key)) return;

    const n   = parseFloat(value);
    const num = Number.isFinite(n) ? n : 0;

    const cfg = { ...state.categoryConfig };
    const c   = { ...(cfg[cat] || {}) };
    const t   = { ...(c[tier] || {}) };

    if (num === 0) delete t[key];                       // keep the doc sparse
    else t[key] = (key === 'dollars') ? num : Math.trunc(num);

    if (Object.keys(t).length) c[tier] = t; else delete c[tier];
    if (Object.keys(c).length) cfg[cat] = c; else delete cfg[cat];

    setCategoryConfig(cfg);
    await saveCategoryConfig();
}

/** Read one stored reward field for the editor UI ('' when unset). */
export function getCategoryRewardValue(cat, tier, key) {
    const v = state.categoryConfig?.[cat]?.[tier]?.[key];
    return (v === undefined || v === null) ? '' : v;
}
