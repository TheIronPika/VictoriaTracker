// ─────────────────────────────────────────────────────────────────────
// web/ui/history-ui.js
// History tab: load, render, 4-chart tab bar (balance/heatmap/earners/category),
// collapsible past-week entries.
// ─────────────────────────────────────────────────────────────────────

import { uiState } from './ui-state.js';
import { state } from '../../Core/state.js';
import { loadWeeklyHistory } from '../../Core/history.js';
import { MANAGE_PASSCODE } from '../../Core/config.js';
import { sortedOldestFirst } from '../../Core/streaks.js';
import { escapeHtml } from '../../Core/utils.js';

// ── Chart lifecycle ───────────────────────────────────────────────────

export function destroyHistoryCharts() {
    uiState.historyCharts.forEach(c => { try { c.destroy(); } catch (e) {} });
    uiState.historyCharts = [];
}

// ── Entry point ───────────────────────────────────────────────────────

export function renderHistory() {
    const root = document.getElementById('historyRoot');
    if (!root) return;
    destroyHistoryCharts();
    if (state.historyLoaded) { _paintHistory(root); return; }
    root.innerHTML = '<p style="text-align:center;color:#bbb;padding:40px 0;font-size:13px;">Loading history&#8230;</p>';
    loadWeeklyHistory()
        .then(() => _paintHistory(root))
        .catch(() => { root.innerHTML = '<p style="text-align:center;color:#bbb;padding:40px 0;">Could not load history.</p>'; });
}

// ── Full render ───────────────────────────────────────────────────────

function _paintHistory(root) {
    const weeklyHistory = state.weeklyHistory;
    const TC  = { punish: '#d9534f', low: '#e67e22', goal: '#27ae60', bonus: '#8e44ad' };
    const TL  = { punish: 'DEBT',    low: 'LOW',     goal: 'GOAL',    bonus: 'BONUS'  };
    function dTier(c, t) {
        if (c >= (t.bonus || 7)) return 'bonus';
        if (c >= (t.goal  || 5)) return 'goal';
        if (c >= (t.low   || 3)) return 'low';
        return 'punish';
    }

    const MANAGE_BTN = '<div style="text-align:right;margin-bottom:14px;">'
        + '<button onclick="window.handleManageClick()" '
        + 'style="background:none;border:1px solid var(--header-pink);color:var(--header-pink);'
        + 'padding:7px 14px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;'
        + 'font-family:\'Montserrat\',sans-serif;letter-spacing:1px;">MANAGE &#128274;</button></div>';

    if (!weeklyHistory.length) {
        root.innerHTML = MANAGE_BTN
            + '<div style="text-align:center;padding:50px 20px;color:#bbb;">'
            + '<div style="font-size:32px;margin-bottom:12px;">&#128197;</div>'
            + '<div style="font-family:\'Playfair Display\';font-size:16px;color:#c0a0a0;margin-bottom:8px;">No history yet</div>'
            + '<div style="font-size:12px;">Complete your first weekly reset<br>to start seeing trends here.</div></div>';
        return;
    }

    const wks   = sortedOldestFirst(weeklyHistory);
    const allT  = wks.reduce((s, w) => s + w.totalBalance, 0);
    const best  = wks.reduce((b, w) => w.totalBalance > b.totalBalance ? w : b, wks[0]);
    const profW = wks.filter(w => w.totalBalance >= 0).length;
    const aC    = allT >= 0 ? '#27ae60' : '#d9534f';

    let html = MANAGE_BTN;

    // Stats strip
    html += '<div class="history-card" style="display:flex;gap:0;padding:14px 10px;margin-bottom:12px;">'
          + '<div style="flex:1;text-align:center;border-right:1px solid rgba(0,0,0,0.06);">'
          + '<div class="hist-stat-lbl">All-Time</div>'
          + '<div class="hist-stat-val" style="color:' + aC + ';">' + (allT < 0 ? '-$' : '$') + Math.abs(allT).toFixed(2) + '</div></div>'
          + '<div style="flex:1;text-align:center;border-right:1px solid rgba(0,0,0,0.06);">'
          + '<div class="hist-stat-lbl">Best Week</div>'
          + '<div class="hist-stat-val" style="color:#27ae60;">' + (best.totalBalance > 0 ? '+$' + best.totalBalance.toFixed(2) : '$0.00') + '</div></div>'
          + '<div style="flex:1;text-align:center;">'
          + '<div class="hist-stat-lbl">Profit Weeks</div>'
          + '<div class="hist-stat-val">' + profW + ' / ' + wks.length + '</div></div></div>';

    // Tab bar
    const chartTabs   = ['balance', 'heatmap', 'earners', 'category'];
    const chartLabels = ['Balance', 'Heatmap', 'Top Earners', 'By Category'];
    html += '<div class="hist-tab-bar">'
          + chartTabs.map((t, i) =>
                '<button class="hist-tab-btn' + (i === 0 ? ' hist-tab-active' : '') + '" '
                + 'onclick="window.switchHistoryTab(\'' + t + '\')" id="htab-' + t + '">' + chartLabels[i] + '</button>'
            ).join('')
          + '</div>';

    // Balance panel
    html += '<div id="hpanel-balance" class="hist-chart-panel history-card">'
          + '<div class="history-section-title">Weekly balance</div>'
          + '<div style="position:relative;height:180px;"><canvas id="hchart-balance" role="img" aria-label="Weekly balance bar chart">Weekly balances.</canvas></div>'
          + '<div style="display:flex;justify-content:center;gap:16px;margin-top:8px;font-size:10px;font-weight:600;">'
          + '<span style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:2px;background:#27ae60;display:inline-block;"></span>Profit</span>'
          + '<span style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:2px;background:#d9534f;display:inline-block;"></span>Debt</span>'
          + '</div></div>';

    // Heatmap panel
    const hmWkLabels = wks.map(w => { const d = new Date(w.timestamp); return (d.getMonth() + 1) + '/' + d.getDate(); });
    const allHabitIds = [], habitMeta = {};
    wks.forEach(w => (w.habits || []).forEach(h => {
        if (!habitMeta[h.id]) { habitMeta[h.id] = { name: h.name, icon: h.icon }; allHabitIds.push(h.id); }
    }));
    const hmLblRow = '<div class="hm-label-spacer"></div>' + hmWkLabels.map(l => '<div class="hm-wlbl">' + l + '</div>').join('');
    const hmRows   = allHabitIds.map(id => {
        const cells = wks.map((w, wi) => {
            const h = (w.habits || []).find(x => x.id === id);
            const t = h ? h.tier : 'punish';
            const payout = h ? ((h.payout || 0) < 0 ? '-$' : '+$') + Math.abs(h.payout || 0).toFixed(2) : '—';
            return '<div class="hm-cell"'
                + ' data-habit="' + escapeHtml(habitMeta[id].name) + '"'
                + ' data-week="' + hmWkLabels[wi] + '"'
                + ' data-tier="' + (h ? TL[t] : '—') + '"'
                + ' data-payout="' + payout + '"'
                + ' style="background:' + (h ? TC[t] : '#eee') + ';opacity:0.82;"></div>';
        }).join('');
        return '<div class="hm-row"><span class="hm-label">' + habitMeta[id].icon + ' ' + escapeHtml(habitMeta[id].name) + '</span>' + cells + '</div>';
    }).join('');
    const hmLegend = Object.entries(TL).map(([k, v]) =>
        '<span style="display:flex;align-items:center;gap:4px;font-size:10px;color:#888;">'
        + '<span style="width:8px;height:8px;border-radius:2px;background:' + TC[k] + ';display:inline-block;opacity:.85;"></span>' + v + '</span>'
    ).join('');
    html += '<div id="hpanel-heatmap" class="hist-chart-panel history-card" style="display:none;">'
          + '<div class="history-section-title">Tier per habit per week</div>'
          + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' + hmLegend + '</div>'
          + '<div style="overflow-x:auto;"><div class="hm-header-row">' + hmLblRow + '</div>' + hmRows + '</div></div>';

    // Top earners panel
    const earnerTotals = {};
    wks.forEach(w => (w.habits || []).forEach(h => {
        if (!earnerTotals[h.name]) earnerTotals[h.name] = { name: h.name, icon: h.icon || '', val: 0 };
        earnerTotals[h.name].val += (h.payout || 0);
    }));
    const earnerList = Object.values(earnerTotals).sort((a, b) => b.val - a.val);
    const earnH = Math.max(180, earnerList.length * 22 + 50);
    html += '<div id="hpanel-earners" class="hist-chart-panel history-card" style="display:none;">'
          + '<div class="history-section-title">Cumulative payout per habit</div>'
          + '<div style="position:relative;height:' + earnH + 'px;"><canvas id="hchart-earners" role="img" aria-label="Cumulative payout per habit chart">Cumulative payouts.</canvas></div></div>';

    // By category panel
    html += '<div id="hpanel-category" class="hist-chart-panel history-card" style="display:none;">'
          + '<div class="history-section-title">Average payout per category per week</div>'
          + '<div style="position:relative;height:200px;"><canvas id="hchart-category" role="img" aria-label="Average payout by category">Category payouts.</canvas></div></div>';

    // Past weeks list
    html += '<h3 class="history-section-title" style="margin:16px 4px 10px;">Past Weeks</h3>';
    const mostRecentId = weeklyHistory.length ? weeklyHistory[0].id : null;
    weeklyHistory.forEach(wk => {
        const isP      = wk.totalBalance >= 0;
        const tCol     = isP ? '#27ae60' : '#d9534f';
        const tStr     = (isP ? '+$' : '-$') + Math.abs(wk.totalBalance).toFixed(2);
        const cats     = [...new Set((wk.habits || []).map(h => h.cat))];
        const weekLabel = 'Week of ' + wk.weekEnding;
        const weekSub   = '';
        let body = '';
        cats.forEach(cat => {
            body += '<div style="font-size:9px;font-weight:800;color:#bbb;text-transform:uppercase;letter-spacing:1px;margin:10px 0 4px;">' + escapeHtml(cat) + '</div>';
            (wk.habits || []).filter(h => h.cat === cat).forEach(h => {
                const dots = (h.history || []).slice(0, 7).map(c =>
                    !c ? '<div class="hist-dot" style="background:#ebebeb;"></div>'
                       : '<div class="hist-dot" style="background:' + TC[dTier(c, h.thresh || {})] + '"></div>'
                ).join('');
                const pC = h.payout < 0 ? '#d9534f' : '#27ae60';
                const pS = (h.payout < 0 ? '-$' : '+$') + Math.abs(h.payout).toFixed(2);
                // Pills surface why the row paid what it did. Snapshots from
                // before this feature shipped don't have these flags — those
                // rows simply render untagged (no visual regression).
                const hExcused        = !!h.excused;
                const hPeriodProtected = !!h.periodProtected;
                const flagClasses     = (hExcused ? ' is-excused' : '') + (hPeriodProtected ? ' is-period-protected' : '');
                const flagPills       =
                    (hExcused         ? '<span class="flag-pill excused">✦ Excused</span>'   : '') +
                    (hPeriodProtected ? '<span class="flag-pill period">🩸 Protected</span>' : '');
                body += '<div class="hist-habit-row' + flagClasses + '">'
                      + '<span class="hist-habit-icon">' + h.icon + '</span>'
                      + '<span class="hist-habit-name">' + escapeHtml(h.name) + flagPills + '</span>'
                      + '<div class="hist-dots-row">' + dots + '</div>'
                      + '<span class="hist-tier-badge" style="color:' + TC[h.tier] + ';">' + TL[h.tier] + '</span>'
                      + '<span class="hist-payout" style="color:' + pC + ';">' + pS + '</span></div>';
            });
        });
        html += '<div class="history-week-card">'
              + '<div class="history-week-header" onclick="window.toggleHistoryWeek(\'' + wk.id + '\')">'
              + '<div><div style="font-family:\'Playfair Display\';font-size:13px;font-weight:700;">' + weekLabel + '</div>'
              + '<div style="font-size:10px;color:#bbb;margin-top:2px;">' + (wk.habits || []).length + ' habits</div></div>'
              + '<div style="display:flex;align-items:center;gap:8px;">'
              + '<div style="font-family:\'Great Vibes\';font-size:26px;color:' + tCol + ';">' + tStr + '</div>'
              + '<div id="chv-' + wk.id + '" style="color:#ccc;font-size:18px;transition:transform 0.2s;">&#8250;</div>'
              + '</div></div>'
              + '<div id="hwkbody-' + wk.id + '" class="history-week-body" style="display:none;">' + body + '</div>'
              + '</div>';
    });

    root.innerHTML = html;
    setTimeout(() => { _drawBalanceChart(wks); _storeEarnerData(earnerList); _storeCategoryData(wks); _setupHeatmapTooltip(); }, 0);
}

// ── Heatmap tooltip (long-press / hover) ──────────────────────────────

function _setupHeatmapTooltip() {
    let tip = document.getElementById('hm-tooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'hm-tooltip';
        Object.assign(tip.style, {
            display: 'none', position: 'fixed', zIndex: '9999',
            background: 'rgba(28,18,28,.92)', color: '#fff',
            padding: '8px 12px', borderRadius: '9px',
            fontSize: '12px', lineHeight: '1.7', pointerEvents: 'none',
            boxShadow: '0 4px 16px rgba(0,0,0,.35)', maxWidth: '180px'
        });
        document.body.appendChild(tip);
    }

    let pressTimer = null;

    function show(el, x, y) {
        tip.innerHTML = '<div style="font-weight:700;font-size:13px;">' + el.dataset.habit + '</div>'
            + '<div style="color:#c8a0c8;font-size:10px;">Week of ' + el.dataset.week + '</div>'
            + '<div style="margin-top:2px;">' + el.dataset.tier + ' &nbsp;·&nbsp; ' + el.dataset.payout + '</div>';
        tip.style.display = 'block';
        position(x, y);
    }

    function position(x, y) {
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        let left = x + 12, top = y - th - 12;
        if (left + tw > window.innerWidth - 8) left = x - tw - 12;
        if (top < 8) top = y + 20;
        tip.style.left = left + 'px';
        tip.style.top  = top  + 'px';
    }

    function hide() { tip.style.display = 'none'; }

    document.querySelectorAll('.hm-cell[data-habit]').forEach(cell => {
        // Desktop hover
        cell.addEventListener('mouseenter', e => show(e.currentTarget, e.clientX, e.clientY));
        cell.addEventListener('mousemove',  e => position(e.clientX, e.clientY));
        cell.addEventListener('mouseleave', hide);

        // Mobile long press (400 ms)
        cell.addEventListener('touchstart', e => {
            pressTimer = setTimeout(() => {
                const t = e.touches[0];
                show(e.currentTarget, t.clientX, t.clientY);
            }, 400);
        }, { passive: true });
        cell.addEventListener('touchend', () => {
            clearTimeout(pressTimer);
            setTimeout(hide, 1800);
        }, { passive: true });
        cell.addEventListener('touchmove', () => {
            clearTimeout(pressTimer);
            hide();
        }, { passive: true });
    });
}

// ── Chart drawing ─────────────────────────────────────────────────────

let _earnersData = null, _categoryData = null, _wksData = null;
function _storeEarnerData(list) { _earnersData = list; }
function _storeCategoryData(wks) { _categoryData = wks; _wksData = wks; }

function _drawBalanceChart(wks) {
    const el = document.getElementById('hchart-balance'); if (!el) return;
    const labels   = wks.map(w => { const d = new Date(w.timestamp); return (d.getMonth() + 1) + '/' + d.getDate(); });
    const data     = wks.map(w => +w.totalBalance.toFixed(2));
    const c = new Chart(el, {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: data.map(v => v >= 0 ? 'rgba(39,174,96,.8)' : 'rgba(217,83,79,.8)'), borderRadius: 3 }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => (c.raw < 0 ? '-$' : '$') + Math.abs(c.raw).toFixed(2) } } },
            scales: { y: { ticks: { callback: v => (v < 0 ? '-$' : '$') + Math.abs(v), font: { size: 10 } }, grid: { color: 'rgba(0,0,0,.05)' } },
                      x: { ticks: { font: { size: 9 }, autoSkip: false, maxRotation: 45 } } } }
    });
    uiState.historyCharts.push(c);
}

function _drawEarnersChart() {
    const el = document.getElementById('hchart-earners'); if (!el || !_earnersData) return;
    const c = new Chart(el, {
        type: 'bar',
        data: { labels: _earnersData.map(d => d.name),
                datasets: [{ data: _earnersData.map(d => +d.val.toFixed(2)),
                             backgroundColor: _earnersData.map(d => d.val >= 0 ? 'rgba(39,174,96,.75)' : 'rgba(217,83,79,.75)'), borderRadius: 3 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => (c.raw < 0 ? '-$' : '$') + Math.abs(c.raw).toFixed(2) } } },
            scales: { x: { ticks: { callback: v => (v < 0 ? '-$' : '$') + Math.abs(v), font: { size: 9 } }, grid: { color: 'rgba(0,0,0,.05)' } },
                      y: { ticks: { font: { size: 9 } } } } }
    });
    uiState.historyCharts.push(c);
}

function _drawCategoryChart() {
    const el = document.getElementById('hchart-category'); if (!el || !_categoryData) return;
    const cats = {};
    _categoryData.forEach(w => (w.habits || []).forEach(h => { if (!cats[h.cat]) cats[h.cat] = 0; cats[h.cat] += (h.payout || 0); }));
    const n      = _categoryData.length || 1;
    const labels = Object.keys(cats);
    const avgs   = labels.map(c => +(cats[c] / n).toFixed(2));
    const c = new Chart(el, {
        type: 'bar',
        data: { labels, datasets: [{ data: avgs, backgroundColor: avgs.map(v => v >= 0 ? 'rgba(83,74,183,.75)' : 'rgba(217,83,79,.75)'), borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => (c.raw < 0 ? '-$' : '$') + Math.abs(c.raw).toFixed(2) + '/wk avg' } } },
            scales: { y: { ticks: { callback: v => (v < 0 ? '-$' : '$') + Math.abs(v), font: { size: 10 } }, grid: { color: 'rgba(0,0,0,.05)' } },
                      x: { ticks: { font: { size: 11 } } } } }
    });
    uiState.historyCharts.push(c);
}

// ── window.* handlers ─────────────────────────────────────────────────

window.switchHistoryTab = (id) => {
    destroyHistoryCharts();
    ['balance', 'heatmap', 'earners', 'category'].forEach(t => {
        const p = document.getElementById('hpanel-' + t);
        const b = document.getElementById('htab-' + t);
        if (p) p.style.display = t === id ? '' : 'none';
        if (b) b.classList.toggle('hist-tab-active', t === id);
    });
    setTimeout(() => {
        if (id === 'balance' && _wksData) _drawBalanceChart(_wksData);
        if (id === 'earners')             _drawEarnersChart();
        if (id === 'category')            _drawCategoryChart();
    }, 0);
};

window.toggleHistoryWeek = (id) => {
    const b = document.getElementById('hwkbody-' + id);
    const c = document.getElementById('chv-' + id);
    if (!b) return;
    const open = b.style.display === 'none';
    b.style.display = open ? 'block' : 'none';
    if (c) c.style.transform = open ? 'rotate(90deg)' : '';
};
