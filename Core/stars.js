// ─────────────────────────────────────────────────────────────────────
// core/stars.js
// Star system: balance, earn/spend, shop items, history log.
// All Firebase persistence for stars lives here.
// ─────────────────────────────────────────────────────────────────────

import { state, setStarBalance, setStarsSpent, setShopItems, setStarLog, setExcuseTokens } from './state.js';
import { readDoc, writeDoc } from './firebase.js';
import { FIRESTORE_DOCS, STAR_LOG_MAX } from './config.js';

/**
 * Load star data from Firestore into state.
 */
export async function loadStarData() {
    try {
        const data = await readDoc(FIRESTORE_DOCS.STARS);
        if (data) {
            setStarBalance  (data.balance       || 0);
            setStarsSpent   (data.spent         || 0);
            setShopItems    (data.items         || []);
            setStarLog      (data.log           || []);
            setExcuseTokens (data.excuseTokens  || 0);
        }
        state.shopLoaded = true;
    } catch (e) { console.error('loadStarData:', e); }
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
        balance:       state.starBalance,
        spent:         state.starsSpent,
        items:         state.shopItems,
        log:           state.starLog,
        excuseTokens:  state.excuseTokens
    });
}

/**
 * Append a log entry. Caller is responsible for syncStarData() afterward.
 */
export function addStarLog(type, amount, reason) {
    state.starLog.unshift({ ts: Date.now(), type, amount, reason });
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
 * Add a new shop item.
 */
export async function addShopItem({ icon = '✨', name, cost, isExcuseToken = false }) {
    if (!name || !cost || cost <= 0) throw new Error('Shop item requires name and positive cost');
    state.shopItems.push({
        id: Date.now().toString(),
        icon, name, cost,
        ...(isExcuseToken && { isExcuseToken: true })
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

/**
 * Remove a shop item by id.
 */
export async function deleteShopItem(id) {
    setShopItems(state.shopItems.filter(it => it.id !== id));
    await syncStarData();
}

/**
 * Redeem an item by index in shopItems. Convenience wrapper around spendStars.
 */
export async function redeemShopItem(index) {
    const item = state.shopItems[index];
    if (!item) return false;
    return spendStars(item.cost, 'Redeemed: ' + item.name);
}
