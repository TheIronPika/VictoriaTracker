// ─────────────────────────────────────────────────────────────────────
// web/ui/shop-ui.js
// Star shop: bottom-sheet render, manage panel, redeem flow.
// ─────────────────────────────────────────────────────────────────────

import { uiState } from './ui-state.js';
import { state } from '../../core/state.js';
import {
    syncStarData,
    awardStars      as coreAwardStars,
    spendStars,
    addShopItem     as coreAddShopItem,
    deleteShopItem  as coreDeleteShopItem
} from '../../core/stars.js';

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
                + '<div class="shop-item-name">' + it.name + '</div>'
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
                const earn = e.type === 'earn';
                return '<div class="shop-log-row">'
                    + '<span class="shop-log-date">' + ds + '</span>'
                    + '<span class="shop-log-reason">' + e.reason + '</span>'
                    + '<span class="shop-log-amt ' + (earn ? 'earn' : 'spend') + '">' + (earn ? '+' : '-') + '✨' + e.amount + '</span>'
                    + '</div>';
            }).join('');
        }
    }
}

// ── Manage panel ──────────────────────────────────────────────────────

export function renderShopManage() {
    const root = document.getElementById('shopManageRoot');
    if (!root) return;
    if (!state.shopItems.length) {
        root.innerHTML = '<div style="font-size:12px;color:#aaa;padding:4px 0;">No items yet.</div>';
        return;
    }
    root.innerHTML = state.shopItems.map(it =>
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f5f5f5;">'
        + '<span style="font-size:18px;">' + it.icon + '</span>'
        + '<span style="flex:1;font-size:12px;font-weight:600;color:#4a3a3a;">' + it.name + '</span>'
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
    await spendStars(uiState.pendingRedeem.cost, 'Redeemed: ' + uiState.pendingRedeem.name);
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
    const icon = document.getElementById('shopItemIcon')?.value.trim() || '✨';
    const name = document.getElementById('shopItemName')?.value.trim();
    const cost = parseInt(document.getElementById('shopItemCost')?.value) || 0;
    if (!name || cost <= 0) { alert('Please enter a name and star cost.'); return; }
    await coreAddShopItem({ icon, name, cost });
    document.getElementById('shopItemIcon').value = '';
    document.getElementById('shopItemName').value = '';
    document.getElementById('shopItemCost').value = '';
    renderShopManage();
};

window.deleteShopItem = async (id) => {
    await coreDeleteShopItem(id);
    renderShopManage();
};
