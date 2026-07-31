// ─────────────────────────────────────────────────────────────────────
// core/stars.js
// Star system: balance, earn/spend, shop items, history log.
// All Firebase persistence for stars lives here.
// ─────────────────────────────────────────────────────────────────────

import { state, setStarBalance, setStarsSpent, setShopItems, setStarLog, setExcuseTokens, setStreakResetTokens, setMarkOffTokens } from './state.js';
import { readDoc, writeDoc, watchDoc } from './firebase.js';
import { FIRESTORE_DOCS, STAR_LOG_MAX } from './config.js';

/**
 * Load star data from Firestore into state.
 */
export async function loadStarData() {
    try {
        const data = await readDoc(FIRESTORE_DOCS.STARS);
        if (data) {
            setStarBalance      (data.balance           || 0);
            setStarsSpent       (data.spent             || 0);
            setShopItems        (data.items             || []);
            setStarLog          (data.log               || []);
            setExcuseTokens     (data.excuseTokens      || 0);
            setStreakResetTokens(data.streakResetTokens || 0);
            setMarkOffTokens    (data.markOffTokens     || 0);
        }
        state.shopLoaded = true;
    } catch (e) { console.error('loadStarData:', e); }
}

/**
 * Subscribe to live star_data updates so balance / shop changes from another
 * device sync in without a refresh. Re-renders on update.
 */
export function watchStarData() {
    return watchDoc(FIRESTORE_DOCS.STARS, (data) => {
        if (data) {
            setStarBalance      (data.balance           || 0);
            setStarsSpent       (data.spent             || 0);
            setShopItems        (data.items             || []);
            setStarLog          (data.log               || []);
            setExcuseTokens     (data.excuseTokens      || 0);
            setStreakResetTokens(data.streakResetTokens || 0);
            setMarkOffTokens    (data.markOffTokens     || 0);
        }
        state.shopLoaded = true;
        window.render?.();
    });
}

/**
 * Push current star state to Firestore.
 * Trims log to STAR_LOG_MAX to keep doc size bounded.
 */
export async function syncStarData() {
    if (state.starLog.length > STAR_LOG_MAX) {
        setStarLog(state.starLog.slice(0, STAR_LOG_MAX));
    }
    await writeDoc(FIRESTORE_DOCS.STARS, {
        balance:           state.starBalance,
        spent:             state.starsSpent,
        items:             state.shopItems,
        log:               state.starLog,
        excuseTokens:      state.excuseTokens,
        streakResetTokens: state.streakResetTokens,
        markOffTokens:     state.markOffTokens
    });
}

/**
 * Append a log entry. Caller is responsible for syncStarData() afterward.
 * `extra` merges in additional structured fields (e.g. Lucky Draw's
 * habitName/tier/oddsPct) without changing the shape every other log type
 * gets — existing entries and callers are unaffected.
 */
export function addStarLog(type, amount, reason, extra = {}) {
    state.starLog.unshift({ ts: Date.now(), type, amount, reason, ...extra });
}

/**
 * Award stars (manual or from habit completions).
 */
export async function awardStars(amount, reason = 'Manual award') {
    if (amount <= 0) return;
    setStarBalance(state.starBalance + amount);
    addStarLog('earn', amount, reason);
    await syncStarData();
}

// Reason string for a real (non-test) Lucky Draw win. luckyDrawWinsToday()
// filters on this exact string so ShopManage's test-trigger button (which
// passes its own reason) never suppresses Victoria's real daily odds.
export const LUCKY_DRAW_REASON = 'Lucky Draw! 🍀';

/**
 * Award exactly 1 star from a Lucky Draw win. Kept separate from awardStars()
 * so the log entry stays tagged 'luckyDraw' (not 'earn') — HabitCard's real
 * roll and ShopManage's test-trigger button both call this, so the two
 * paths can never drift into different log semantics.
 *
 * @param {string} [reason]
 * @param {{habitName?: string, tier?: string, oddsPct?: number}|null} [source]
 *   Which habit/tier/odds the win came from, so the star history can show
 *   it. Omitted for the Manage test-trigger button, which has no real habit
 *   to attribute to — the log/history UI just shows those entries without
 *   the detail line.
 */
export async function awardLuckyDrawStar(reason = LUCKY_DRAW_REASON, source = null) {
    setStarBalance(state.starBalance + 1);
    addStarLog('luckyDraw', 1, reason, source || {});
    await syncStarData();
}

/** Local 'YYYY-MM-DD' key for a date — same shape water.js uses. */
function localDateKey(d) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * How many *real* Lucky Draw wins have already landed today (LOCAL date, like
 * every other "today" in the app). Test-triggered wins (distinct reason) don't
 * count, so previewing the effect in Manage never nerfs her real odds.
 * Used to soft-decay the odds on each subsequent roll — see LUCKY_DRAW_ODDS.
 *
 * This compared UTC dates until 2026-07-30, which silently moved the day
 * boundary: west of UTC the counter reset hours BEFORE local midnight (at
 * UTC-4, 20:00 local), handing out full undecayed odds for the rest of the
 * evening, while those evening wins then counted against the next local
 * morning. Everything else here is local — utils.js, water.js dateKey(),
 * weeklyReset's toDateString() — so this was the outlier, not the rule.
 */
export function luckyDrawWinsToday() {
    const today = localDateKey(new Date());
    return state.starLog.filter(e =>
        e.type === 'luckyDraw' &&
        e.reason === LUCKY_DRAW_REASON &&
        localDateKey(new Date(e.ts)) === today,
    ).length;
}

/**
 * Spend stars on a redemption. Returns false if insufficient balance.
 */
export async function spendStars(amount, reason) {
    if (amount > state.starBalance) return false;
    setStarBalance(state.starBalance - amount);
    setStarsSpent (state.starsSpent  + amount);
    addStarLog('spend', amount, reason);
    await syncStarData();
    return true;
}

/**
 * Redeem a shop item: spend the stars AND grant whatever token it carries, in
 * ONE document write. Returns false (changing nothing) if she can't afford it.
 *
 * The UI used to call spendStars() and then addExcuseToken()/addStreakResetToken()/
 * addMarkOffToken() in sequence — two full writes of the same doc, so a failure
 * between them charged the stars and granted no token. All the state changes
 * happen here before a single syncStarData().
 */
export async function redeemItem(item) {
    if (!item || item.cost > state.starBalance) return false;
    setStarBalance(state.starBalance - item.cost);
    setStarsSpent (state.starsSpent  + item.cost);
    addStarLog('spend', item.cost, 'Redeemed: ' + item.name);

    if (item.isExcuseToken) {
        setExcuseTokens(state.excuseTokens + 1);
        addStarLog('excuseToken', 1, 'Excuse token added');
    }
    if (item.isStreakResetToken) {
        setStreakResetTokens(state.streakResetTokens + 1);
        addStarLog('streakResetToken', 1, 'Streak reset token added');
    }
    if (item.isMarkOffToken) {
        setMarkOffTokens(state.markOffTokens + 1);
        addStarLog('markOffToken', 1, 'Mark-off token added');
    }

    await syncStarData();
    return true;
}

/**
 * Add a new shop item.
 */
export async function addShopItem({ icon = '✨', name, cost, isExcuseToken = false, isStreakResetToken = false, isMarkOffToken = false }) {
    if (!name || !cost || cost <= 0) throw new Error('Shop item requires name and positive cost');
    state.shopItems.push({
        id: Date.now().toString(),
        icon, name, cost,
        ...(isExcuseToken      && { isExcuseToken: true }),
        ...(isStreakResetToken && { isStreakResetToken: true }),
        ...(isMarkOffToken     && { isMarkOffToken: true })
    });
    await syncStarData();
}

/**
 * Grant one excuse token (called after redeeming an excuse-token shop item).
 */
export async function addExcuseToken() {
    setExcuseTokens(state.excuseTokens + 1);
    addStarLog('excuseToken', 1, 'Excuse token added');
    await syncStarData();
}

/**
 * Grant N excuse tokens in a single sync — used by the Manage UI's bulk grant
 * affordance. Avoids N round-trips to Firestore when N > 1.
 */
export async function grantExcuseTokens(count) {
    const n = parseInt(count, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    setExcuseTokens(state.excuseTokens + n);
    addStarLog('excuseToken', n, n === 1 ? 'Excuse token added' : `${n} excuse tokens added`);
    await syncStarData();
}

/**
 * Consume one excuse token. Returns false if balance is 0.
 */
export async function useExcuseToken() {
    if (state.excuseTokens <= 0) return false;
    setExcuseTokens(state.excuseTokens - 1);
    addStarLog('excuseToken', -1, 'Excuse token used');
    await syncStarData();
    return true;
}

// ── Streak Reset Tokens ───────────────────────────────────────────────
// Parallel to excuse tokens, but used to zero a habit's bad streak (🌧️)
// without requiring her to hit goal that week. Each token clears one
// habit's accumulated bad streak.

/**
 * Grant one streak reset token (shop redemption hook).
 */
export async function addStreakResetToken() {
    setStreakResetTokens(state.streakResetTokens + 1);
    addStarLog('streakResetToken', 1, 'Streak reset token added');
    await syncStarData();
}

/**
 * Grant N streak reset tokens in a single sync.
 */
export async function grantStreakResetTokens(count) {
    const n = parseInt(count, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    setStreakResetTokens(state.streakResetTokens + n);
    addStarLog('streakResetToken', n, n === 1 ? 'Streak reset token added' : `${n} streak reset tokens added`);
    await syncStarData();
}

/**
 * Consume one streak reset token. Returns false if balance is 0.
 */
export async function useStreakResetToken() {
    if (state.streakResetTokens <= 0) return false;
    setStreakResetTokens(state.streakResetTokens - 1);
    addStarLog('streakResetToken', -1, 'Streak reset token used');
    await syncStarData();
    return true;
}

// ── Mark-Off Tokens ───────────────────────────────────────────────────
// Parallel to excuse tokens, but used to synthetically add one completion
// to a habit for the current day — as if she actually did it.

/**
 * Grant one mark-off token (shop redemption hook).
 */
export async function addMarkOffToken() {
    setMarkOffTokens(state.markOffTokens + 1);
    addStarLog('markOffToken', 1, 'Mark-off token added');
    await syncStarData();
}

/**
 * Grant N mark-off tokens in a single sync.
 */
export async function grantMarkOffTokens(count) {
    const n = parseInt(count, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    setMarkOffTokens(state.markOffTokens + n);
    addStarLog('markOffToken', n, n === 1 ? 'Mark-off token added' : `${n} mark-off tokens added`);
    await syncStarData();
}

/**
 * Consume one mark-off token. Returns false if balance is 0.
 */
export async function useMarkOffToken() {
    if (state.markOffTokens <= 0) return false;
    setMarkOffTokens(state.markOffTokens - 1);
    addStarLog('markOffToken', -1, 'Mark-off token used');
    await syncStarData();
    return true;
}

/**
 * Update a shop item's icon, name, and/or cost by id.
 */
export async function updateShopItem(id, { icon, name, cost }) {
    const item = state.shopItems.find(it => it.id === id);
    if (!item) return;
    if (icon !== undefined) item.icon = icon;
    if (name !== undefined) item.name = name;
    if (cost !== undefined) item.cost = cost;
    await syncStarData();
}

/**
 * Remove a shop item by id.
 */
export async function deleteShopItem(id) {
    setShopItems(state.shopItems.filter(it => it.id !== id));
    await syncStarData();
}
