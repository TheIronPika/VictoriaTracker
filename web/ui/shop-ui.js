// ─────────────────────────────────────────────────────────────────────
// web/ui/shop-ui.js
// Star shop: bottom-sheet render, manage panel, redeem flow.
// ─────────────────────────────────────────────────────────────────────

import { uiState } from './ui-state.js';
import { state } from '../../Core/state.js';
import { escapeHtml } from '../../Core/utils.js';
import {
    syncStarData,
    awardStars      as coreAwardStars,
    spendStars,
    addShopItem     as coreAddShopItem,
    deleteShopItem  as coreDeleteShopItem,
    addExcuseToken,
    grantExcuseTokens,
    useExcuseToken
} from '../../Core/stars.js';

// ── Display helpers ───────────────────────────────────────────────────

export function updateStarDisplay() {
    // The star count lives inside the shop sheet only.
    // The trigger is the icon in the balance card — no count shown outside.
}

// ── Shop sheet ────────────────────────────────────────────────────────

export function renderShopSheet() {
    const grid = document.getElementById('shopGrid');
    if (!grid) return;

    const bal = document.getElementById('shopBalDisplay');
    if (bal) bal.innerHTML = '✨ <strong>' + state.starBalance + ' stars</strong> available';

    if (!state.shopItems.length) {
        grid.innerHTML = '<div style="text-align:center;padding:30px;color:#bbb;font-size:13px;">No items yet.<br>Add some in Manage!</div>';
    } else {
        grid.innerHTML = state.shopItems.map((it, i) => {
            const cant = it.cost > state.starBalance;
            return '<div class="shop-item' + (cant ? ' shop-item-cant' : '') + '" onclick="' + (cant ? '' : 'window.selectShopItem(' + i + ')') + '">'
                + '<div class="shop-item-ico">' + (it.icon || '✨') + '</div>'
                + '<div class="shop-item-name">' + escapeHtml(it.name) + '</div>'
                + '<div class="shop-item-cost">✨ ' + it.cost + '</div>'
                + '</div>';
        }).join('');
    }

    const logWrap = document.getElementById('shopLogWrap');
    if (logWrap) {
        if (!state.starLog.length) {
            logWrap.innerHTML = '<div class="shop-log-empty">No history yet.</div>';
        } else {
            logWrap.innerHTML = state.starLog.slice(0, 40).map(e => {
                const d    = new Date(e.ts);
                const ds   = (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
                // Deduction only when it's a spend or the amount is negative;
                // earns and lucky draws (type 'luckyDraw', +1) are credits.
                const negative = e.type === 'spend' || e.amount < 0;
                return '<div class="shop-log-row">'
                    + '<span class="shop-log-date">' + ds + '</span>'
                    + '<span class="shop-log-reason">' + escapeHtml(e.reason) + '</span>'
                    + '<span class="shop-log-amt ' + (negative ? 'spend' : 'earn') + '">' + (negative ? '-' : '+') + '✨' + Math.abs(e.amount) + '</span>'
                    + '</div>';
            }).join('');
        }
    }
}

// ── Manage panel ──────────────────────────────────────────────────────

export function renderShopManage() {
    const root = document.getElementById('shopManageRoot');
    if (!root) return;
    const countEl = document.getElementById('excuseTokenCount');
    if (countEl) countEl.innerText = state.excuseTokens || 0;
    if (!state.shopItems.length) {
        root.innerHTML = '<div style="font-size:12px;color:#aaa;padding:4px 0;">No items yet.</div>';
        return;
    }
    root.innerHTML = state.shopItems.map(it =>
        '<div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.1)">'
        + '<span style="font-size:18px;">' + it.icon + '</span>'
        + '<span style="flex:1;font-size:12px;font-weight:600;color:#e8e3f5;">' + escapeHtml(it.name) + '</span>'
        + '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:#c8942a;cursor:pointer;white-space:nowrap;" title="Grants an excuse token when redeemed">'
        + '<input type="checkbox" ' + (it.isExcuseToken ? 'checked' : '') + ' style="accent-color:#c8942a;" onchange="window.toggleShopItemExcuseToken(\'' + it.id + '\',this.checked)"> excuse token'
        + '</label>'
        + '<span style="font-size:11px;color:#c8942a;font-weight:700;">✨ ' + it.cost + '</span>'
        + '<button class="btn-delete" style="padding:3px 8px;font-size:9px;" onclick="window.deleteShopItem(\'' + it.id + '\')">DEL</button>'
        + '</div>'
    ).join('');
}

// ── window.* handlers ─────────────────────────────────────────────────

window.openShop = () => {
    renderShopSheet();
    document.getElementById('shopConfirmView').style.display = 'none';
    document.getElementById('shopItemsView').style.display   = '';
    document.getElementById('shopOverlay').classList.add('shop-open');
};

window.closeShop = () => {
    document.getElementById('shopOverlay').classList.remove('shop-open');
    uiState.pendingRedeem = null;
};

window.selectShopItem = (i) => {
    uiState.pendingRedeem = state.shopItems[i];
    const after = state.starBalance - uiState.pendingRedeem.cost;
    document.getElementById('confirmItemName').innerText = uiState.pendingRedeem.name;
    document.getElementById('confirmCost').innerText     = uiState.pendingRedeem.cost;
    document.getElementById('confirmBefore').innerText   = state.starBalance;
    document.getElementById('confirmAfter').innerText    = after;
    document.getElementById('shopItemsView').style.display   = 'none';
    document.getElementById('shopConfirmView').style.display = '';
};

window.cancelConfirm = () => {
    uiState.pendingRedeem = null;
    document.getElementById('shopConfirmView').style.display = 'none';
    document.getElementById('shopItemsView').style.display   = '';
};

window.doRedeem = async () => {
    if (!uiState.pendingRedeem) return;
    const item = uiState.pendingRedeem;
    await spendStars(item.cost, 'Redeemed: ' + item.name);
    if (item.isExcuseToken) await addExcuseToken();
    uiState.pendingRedeem = null;
    updateStarDisplay();
    document.getElementById('shopConfirmView').style.display = 'none';
    document.getElementById('shopItemsView').style.display   = '';
    renderShopSheet();
};

window.awardStars = async () => {
    const amt  = parseInt(document.getElementById('awardAmt')?.value)   || 0;
    const note = document.getElementById('awardNote')?.value.trim()     || 'Manual award';
    if (amt <= 0) return;
    await coreAwardStars(amt, note);
    updateStarDisplay();
    document.getElementById('awardAmt').value = '';
    if (document.getElementById('awardNote')) document.getElementById('awardNote').value = '';
    alert('✨ ' + amt + ' stars awarded!');
};

window.addShopItem = async () => {
    const icon          = document.getElementById('shopItemIcon')?.value.trim() || '✨';
    const name          = document.getElementById('shopItemName')?.value.trim();
    const cost          = parseInt(document.getElementById('shopItemCost')?.value) || 0;
    const isExcuseToken = document.getElementById('shopItemIsExcuse')?.checked || false;
    if (!name || cost <= 0) { alert('Please enter a name and star cost.'); return; }
    await coreAddShopItem({ icon, name, cost, isExcuseToken });
    document.getElementById('shopItemIcon').value     = '';
    document.getElementById('shopItemName').value     = '';
    document.getElementById('shopItemCost').value     = '';
    document.getElementById('shopItemIsExcuse').checked = false;
    renderShopManage();
};

window.deleteShopItem = async (id) => {
    await coreDeleteShopItem(id);
    renderShopManage();
};

window.toggleShopItemExcuseToken = async (id, checked) => {
    const item = state.shopItems.find(it => it.id === id);
    if (!item) return;
    if (checked) item.isExcuseToken = true;
    else delete item.isExcuseToken;
    await syncStarData();
    renderShopManage();
};

window.grantExcuseToken = async () => {
    const amt = parseInt(document.getElementById('grantExcuseAmt')?.value) || 1;
    if (amt <= 0) return;
    // Single batched write instead of N awaited syncStarData() round trips.
    await grantExcuseTokens(amt);
    document.getElementById('grantExcuseAmt').value = '';
    renderExcuseTokenCount();
    alert('✦ ' + amt + ' excuse token' + (amt !== 1 ? 's' : '') + ' granted!');
};

window.revokeExcuseToken = async () => {
    if (state.excuseTokens <= 0) { alert('No tokens to revoke.'); return; }
    await useExcuseToken();
    renderExcuseTokenCount();
};

function renderExcuseTokenCount() {
    const el = document.getElementById('excuseTokenCount');
    if (el) el.innerText = state.excuseTokens;
}
