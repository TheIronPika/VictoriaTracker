// ─────────────────────────────────────────────────────────────────────
// web/ui/manage-ui.js
// Manage panel: split-panel navigation, per-habit detail form,
// weekly report preview, and forecast computation.
// ─────────────────────────────────────────────────────────────────────

import { uiState } from './ui-state.js';
import { state } from '../../Core/state.js';
import { cycleDueLabel } from '../../Core/cycles.js';
import { computeStreaksFromHistory } from '../../Core/streaks.js';
import { getTier } from '../../Core/habits.js';
import { getDayIdx } from '../../Core/utils.js';
import { loadWeeklyHistory } from '../../Core/history.js';
import { renderPeriodHistory } from './period-ui.js';
import { renderEventsManage } from './events-ui.js';
import { renderShopManage } from './shop-ui.js';

// ── Manage section state ──────────────────────────────────────────────
let currentManageSection  = 'habits';
let currentManageHabitId  = null;

// ── Section switcher ──────────────────────────────────────────────────

window.switchManageSection = (section) => {
    currentManageSection = section;
    ['habits', 'add', 'events', 'stars', 'period'].forEach(s => {
        const btn   = document.getElementById('msp-nav-' + s);
        const panel = document.getElementById('msp-right-' + s);
        if (btn)   btn.classList.toggle('msp-nav-active', s === section);
        if (panel) panel.style.display = s === section ? '' : 'none';
    });
    if (section === 'habits' && currentManageHabitId) window.showManageDetail(currentManageHabitId);
    if (section === 'stars')  renderShopManage();
    if (section === 'events') renderEventsManage();
    if (section === 'period') renderPeriodHistory();
};

// ── Category toggle (left panel) ─────────────────────────────────────

window.toggleMspCat = (catId) => {
    const body = document.getElementById('msp-cat-' + catId);
    const chev = document.getElementById('msp-chev-' + catId);
    if (!body) return;
    const isCollapsed = body.style.display === 'none';
    body.style.display = isCollapsed ? '' : 'none';
    if (chev) chev.style.transform = isCollapsed ? '' : 'rotate(-90deg)';
    const stored = JSON.parse(localStorage.getItem('mspCatCollapsed') || '{}');
    stored[catId] = !isCollapsed;
    localStorage.setItem('mspCatCollapsed', JSON.stringify(stored));
};

// ── Habit detail form (right panel) ──────────────────────────────────

window.showManageDetail = (id) => {
    currentManageHabitId = id;
    const h = uiState.habits.find(x => x.id === id);
    if (!h) return;

    // Show habits panel, hide others
    ['add', 'events', 'stars', 'period'].forEach(s => {
        const p   = document.getElementById('msp-right-' + s);
        const btn = document.getElementById('msp-nav-' + s);
        if (p)   p.style.display = 'none';
        if (btn) btn.classList.remove('msp-nav-active');
    });
    const habitsPanel = document.getElementById('msp-right-habits');
    if (habitsPanel) habitsPanel.style.display = '';
    currentManageSection = 'habits';

    document.querySelectorAll('.msp-habit-row').forEach(r =>
        r.classList.toggle('msp-row-selected', r.id === 'msp-row-' + id));

    const detail = document.getElementById('msp-detail');
    if (!detail) return;
    detail.removeAttribute('style');

    const sv   = (v) => (v === undefined || v === null || v === '') ? '' : v;
    const ni   = (field, val, w, step) =>
        '<input type="number" class="msp-num" style="width:' + w + 'px" ' +
        (step ? 'step="' + step + '" ' : '') +
        'value="' + sv(val) + '" ' +
        'onchange="window.updateField(\'' + h.id + '\',\'' + field + '\',this.value)">';
    const niPh = (field, val, w) =>
        '<input type="number" class="msp-num msp-num-star" style="width:' + w + 'px" ' +
        'value="' + sv(val) + '" placeholder="—" min="0" ' +
        'onchange="window.updateField(\'' + h.id + '\',\'' + field + '\',this.value)">';

    const headerHtml =
        '<div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;padding-bottom:18px;border-bottom:1px solid rgba(255,255,255,0.08);">'
        + '<span style="font-size:40px;line-height:1;margin-left:4px;display:inline-block">' + h.icon + '</span>'
        + '<div style="flex:1">'
        +   '<div style="font-family:\'Playfair Display\',serif;font-size:24px;font-weight:700;color:var(--header-pink);line-height:1.1">' + h.name + '</div>'
        +   '<div style="font-size:13px;color:#9d99b8;margin-top:4px">' + h.cat + '</div>'
        + '</div>'
        + '<div style="display:flex;gap:10px;align-items:flex-end">'
        +   '<div class="msp-field-row">'
        +     '<span class="msp-field-label">Icon</span>'
        +     '<input type="text" class="msp-field-input" value="' + sv(h.icon) + '" maxlength="5" style="width:60px;box-sizing:border-box;font-size:20px;text-align:center" onchange="window.updateField(\'' + h.id + '\',\'icon\',this.value)">'
        +   '</div>'
        +   '<button class="btn-delete" style="padding:9px 18px;font-size:12px" onclick="window.deleteTask(\'' + h.id + '\')">Delete habit</button>'
        + '</div>'
        + '</div>';

    const payoutHtml =
        '<div class="msp-section">'
        +   '<div class="msp-section-title">Payouts &amp; Stars</div>'
        +   '<table class="msp-tier-table">'
        +     '<tr><th>Tier</th><th>Qty needed</th><th>$ value</th><th>✨ Stars</th></tr>'
        +     '<tr><td><span style="color:#e05c5c;font-weight:700;font-size:13px">Debt</span></td>'
        +       '<td>' + ni('punish', h.punish, 70) + '</td>'
        +       '<td>' + ni('valPunish', h.valPunish, 80, 0.25) + '</td>'
        +       '<td style="color:#4a4460;font-size:20px;text-align:center">—</td></tr>'
        +     '<tr><td><span style="color:#e0963c;font-weight:700;font-size:13px">Low</span></td>'
        +       '<td>' + ni('low', h.low, 70) + '</td>'
        +       '<td>' + ni('valLow', h.valLow, 80, 0.25) + '</td>'
        +       '<td style="color:#4a4460;font-size:20px;text-align:center">—</td></tr>'
        +     '<tr><td><span style="color:#4caf78;font-weight:700;font-size:13px">Goal</span></td>'
        +       '<td>' + ni('goal', h.goal, 70) + '</td>'
        +       '<td>' + ni('valGoal', h.valGoal, 80, 0.25) + '</td>'
        +       '<td>' + niPh('starGoal', h.starGoal, 70) + '</td></tr>'
        +     '<tr><td><span style="color:#a87cd4;font-weight:700;font-size:13px">Bonus</span></td>'
        +       '<td>' + ni('bonus', h.bonus, 70) + '</td>'
        +       '<td>' + ni('valBonus', h.valBonus, 80, 0.25) + '</td>'
        +       '<td>' + niPh('starBonus', h.starBonus, 70) + '</td></tr>'
        +     '<tr><td><span style="color:#f0c040;font-weight:700;font-size:13px">🔥 Streak</span></td>'
        +       '<td colspan="2" style="font-size:11px;color:#7a7390">Stars per reset if streak ≥ 2</td>'
        +       '<td>' + niPh('starStreak', h.starStreak, 70) + '</td></tr>'
        +   '</table>'
        + '</div>';

    const rightColHtml =
        '<div style="display:flex;flex-direction:column;gap:14px">'
        +   '<div class="msp-section">'
        +     '<div class="msp-section-title">Schedule</div>'
        +     '<div class="msp-field-grid">'
        +       '<div class="msp-field-row"><span class="msp-field-label">Max circles/wk</span><input type="number" class="msp-field-input" value="' + (h.max||7) + '" min="1" max="49" style="width:100%;box-sizing:border-box" onchange="window.updateField(\'' + h.id + '\',\'max\',this.value)"></div>'
        +       '<div class="msp-field-row"><span class="msp-field-label">Daily max</span><input type="number" class="msp-field-input" value="' + (h.dailyMax||1) + '" min="1" max="7" style="width:100%;box-sizing:border-box" onchange="window.updateField(\'' + h.id + '\',\'dailyMax\',this.value)"></div>'
        +       '<div class="msp-field-row"><span class="msp-field-label">Cycle</span>'
        +         '<select class="msp-field-input" style="width:100%;box-sizing:border-box" onchange="window.updateField(\'' + h.id + '\',\'cycleType\',this.value)">'
        +           '<option value="none"' + ((!h.cycleType||h.cycleType==='none')?' selected':'') + '>None</option>'
        +           '<option value="weeks"' + (h.cycleType==='weeks'?' selected':'') + '>Every N wks</option>'
        +           '<option value="monthly"' + (h.cycleType==='monthly'?' selected':'') + '>Monthly</option>'
        +           '<option value="quarterly"' + (h.cycleType==='quarterly'?' selected':'') + '>Quarterly</option>'
        +           '<option value="yearly"' + (h.cycleType==='yearly'?' selected':'') + '>Yearly</option>'
        +         '</select>'
        +       '</div>'
        +     '</div>'
        +     (h.cycleType==='weeks' ? '<div style="margin-top:12px;font-size:13px;color:#ccc8e0">Every <input type="number" class="msp-num" style="width:60px;margin:0 6px" value="' + (h.cycleEvery||1) + '" min="1" max="52" onchange="window.updateField(\'' + h.id + '\',\'cycleEvery\',this.value)"> weeks</div>' : '')
        +     (h.cycleNextDue ? '<div style="margin-top:8px;font-size:11px;color:#7a7390">' + cycleDueLabel(h) + '</div>' : '')
        +   '</div>'
        +   '<div class="msp-section">'
        +     '<div class="msp-section-title">Streak Payouts</div>'
        +     '<div class="msp-streak-grid">'
        +       '<div class="msp-field-row"><span class="msp-field-label">🔥 Bonus $/wk</span><input type="number" class="msp-field-input" step="0.05" value="' + sv(h.streakBonusPer) + '" placeholder="—" style="width:100%;box-sizing:border-box" onchange="window.updateField(\'' + h.id + '\',\'streakBonusPer\',this.value)"></div>'
        +       '<div class="msp-field-row"><span class="msp-field-label">🌧️ Penalty $/wk</span><input type="number" class="msp-field-input" step="0.05" value="' + sv(h.streakPenaltyPer) + '" placeholder="—" style="width:100%;box-sizing:border-box" onchange="window.updateField(\'' + h.id + '\',\'streakPenaltyPer\',this.value)"></div>'
        +       '<div class="msp-field-row"><span class="msp-field-label">Cap $</span><input type="number" class="msp-field-input" step="0.25" value="' + sv(h.streakCap) + '" placeholder="none" style="width:100%;box-sizing:border-box" onchange="window.updateField(\'' + h.id + '\',\'streakCap\',this.value)"></div>'
        +     '</div>'
        +   '</div>'
        +   '<div class="msp-section">'
        +     '<div class="msp-section-title">Flags</div>'
        +     '<label style="display:flex;align-items:center;gap:10px;font-size:13px;color:#ccc8e0;cursor:pointer">'
        +       '<input type="checkbox" ' + (h.periodSensitive?'checked':'') + ' style="width:16px;height:16px;accent-color:var(--header-pink)" onchange="window.updateField(\'' + h.id + '\',\'periodSensitive\',this.checked)">'
        +       '<span>🩸 Period sensitive<br><span style="font-size:11px;color:#7a7390">No penalties during period</span></span>'
        +     '</label>'
        +   '</div>'
        + '</div>';

    const definitionHtml =
        '<div class="msp-section" style="margin-top:14px">'
        +   '<div class="msp-section-title">Definition / Rules</div>'
        +   '<textarea placeholder="Describe exactly what counts for this habit…" style="width:100%;padding:12px 14px;border:1px solid rgba(255,255,255,0.14);border-radius:8px;font-family:Montserrat,sans-serif;font-size:13px;resize:vertical;min-height:120px;box-sizing:border-box;line-height:1.7;color:#e8e3f5;background:#362f52;" onchange="window.updateField(\'' + h.id + '\',\'note\',this.value)">' + (h.note||'') + '</textarea>'
        + '</div>';

    const bountyHtml = h.bountyActive
        ? '<div class="msp-section" style="margin-top:14px;border:1px solid rgba(240,192,64,0.25);background:rgba(240,192,64,0.05);border-radius:10px;padding:16px">'
        +   '<div class="msp-section-title" style="color:#f0c040;margin-bottom:12px">🏆 Active Bounty</div>'
        +   '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">'
        +     '<div class="msp-field-row"><span class="msp-field-label">Bonus $</span><input type="number" class="msp-field-input" step="0.25" min="0" value="' + sv(h.bountyDollars) + '" placeholder="—" style="width:100%;box-sizing:border-box" onchange="window.updateField(\'' + h.id + '\',\'bountyDollars\',this.value)"></div>'
        +     '<div class="msp-field-row"><span class="msp-field-label">Bonus ✨ Stars</span><input type="number" class="msp-field-input" min="0" value="' + sv(h.bountyStars) + '" placeholder="—" style="width:100%;box-sizing:border-box" onchange="window.updateField(\'' + h.id + '\',\'bountyStars\',this.value)"></div>'
        +     '<div class="msp-field-row"><span class="msp-field-label">Bonus 🎫 Excuses</span><input type="number" class="msp-field-input" min="0" value="' + sv(h.bountyExcuseTokens) + '" placeholder="—" style="width:100%;box-sizing:border-box" onchange="window.updateField(\'' + h.id + '\',\'bountyExcuseTokens\',this.value)"></div>'
        +   '</div>'
        +   '<div class="msp-field-row" style="margin-bottom:12px"><span class="msp-field-label">Note for Victoria</span><input type="text" class="msp-field-input" value="' + sv(h.bountyNote) + '" placeholder="e.g. Clean your room this week!" style="width:100%;box-sizing:border-box;font-family:Montserrat,sans-serif" onchange="window.updateField(\'' + h.id + '\',\'bountyNote\',this.value)"></div>'
        +   '<button onclick="window.clearBounty(\'' + h.id + '\')" style="padding:6px 14px;background:none;border:1px solid rgba(217,83,79,0.4);border-radius:7px;color:#d9534f;font-size:11px;font-weight:700;cursor:pointer">Remove Bounty</button>'
        + '</div>'
        : '<div class="msp-section" style="margin-top:14px">'
        +   '<div class="msp-section-title">Bounty</div>'
        +   '<button onclick="window.setBounty(\'' + h.id + '\')" style="padding:8px 18px;background:rgba(240,192,64,0.1);border:1px solid rgba(240,192,64,0.3);border-radius:8px;color:#f0c040;font-size:12px;font-weight:700;cursor:pointer">🏆 Add Bounty</button>'
        +   '<div style="font-size:11px;color:#7a7390;margin-top:6px">Drew\'s bonus reward · pays out when this habit hits Goal or Bonus tier</div>'
        + '</div>';

    detail.innerHTML = headerHtml + '<div class="msp-two-col">' + payoutHtml + rightColHtml + '</div>' + bountyHtml + definitionHtml;
};

// ── Forecast ──────────────────────────────────────────────────────────

export function computeForecast(h) {
    if (!state.weeklyHistory.length) return null;
    const sorted   = state.weeklyHistory.slice().sort((a, b) => b.timestamp - a.timestamp);
    const lastWk   = sorted[0];
    const lastHab  = (lastWk.habits || []).find(x => x.id === h.id);
    if (!lastHab || !lastHab.history) return null;
    const lastWeekTotal = lastHab.history[6] || 0;
    if (lastWeekTotal === 0 && (h.history[getDayIdx(uiState.viewingDate)] || 0) === 0) return null;
    const dIdx        = getDayIdx(uiState.viewingDate);
    const daysElapsed = dIdx + 1;
    const bubblesNow  = h.history[dIdx] || 0;
    const dailyRate   = bubblesNow / daysElapsed;
    const projected   = Math.min(Math.round(dailyRate * 7 * 10) / 10, h.max || 7);
    if (projected > lastWeekTotal) return { dir: 'up',   pace: projected, lastWeek: lastWeekTotal };
    if (projected < lastWeekTotal) return { dir: 'down', pace: projected, lastWeek: lastWeekTotal };
    return null;
}

// ── Report preview ────────────────────────────────────────────────────

window.sendVictoriaTestReport = async () => {
    if (!uiState.habits || !uiState.habits.length) { alert('No habits yet.'); return; }

    if (!state.historyLoaded) {
        await loadWeeklyHistory();
    }

    let reportHabits, reportTotal, reportWeekEnding;

    if (state.weeklyHistory && state.weeklyHistory.length) {
        const lastWeek   = state.weeklyHistory[0];
        reportTotal      = lastWeek.totalBalance;
        reportWeekEnding = lastWeek.weekEnding;
        reportHabits = lastWeek.habits.map(sh => {
            const live = uiState.habits.find(h => h.id === sh.id);
            if (!live) return null;
            return { ...live, history: sh.history };
        }).filter(Boolean);
    } else {
        reportWeekEnding = null;
        reportHabits     = uiState.habits;
        reportTotal      = 0;
        uiState.habits.forEach(h => {
            if (!h.excused) {
                const c = h.history?.[6] ?? (h.history?.[h.history.length - 1] ?? 0);
                const t = getTier(h, c);
                reportTotal += ({ punish: h.valPunish||0, low: h.valLow||0, goal: h.valGoal||0, bonus: h.valBonus||0 })[t];
            }
        });
        // Include room payouts in fallback
        (state.roomsData || []).forEach(r => { if (r.checked) reportTotal += Math.min(r.streak + 1, r.maxStreak); });
    }

    const html = buildVictoriaReportHtml(reportHabits, reportTotal, reportWeekEnding, starsEarnedForReportedWeek());
    const blob  = new Blob([html], { type: 'text/html' });
    const url   = URL.createObjectURL(blob);
    const tab   = window.open(url, '_blank');
    if (!tab) alert('Pop-up blocked — please allow pop-ups for this site and try again.');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
};

// ── Weekly report popup ─────────────────────────────────────────────────
// Auto-shows last week's report once after each weekly reset. There is no
// per-user identity, so "seen" is tracked per device via localStorage, with a
// per-device mute. Reuses the same report HTML as the "View Report" button.

// Stars gained during a given week (index in state.weeklyHistory): everything
// logged between the prior reset and that one (the weekly award + any lucky
// draws / manual awards that week). Falls back to a 7-day window if no older
// snapshot exists.
function starsEarnedForWeekIndex(idx) {
    const wh = state.weeklyHistory || [];
    if (!wh[idx]) return null;
    const upper = wh[idx].timestamp || Date.now();
    const lower = (wh[idx + 1] && wh[idx + 1].timestamp) ? wh[idx + 1].timestamp : (upper - 7 * 86400000);
    return (state.starLog || [])
        .filter(e => e.ts > lower && e.ts <= upper && (e.type === 'earn' || e.type === 'luckyDraw'))
        .reduce((sum, e) => sum + (e.amount || 0), 0);
}
function starsEarnedForReportedWeek() { return starsEarnedForWeekIndex(0); }

// ── Interactive in-app report (native DOM, used by the popup) ────────────
// Same visual design as the shareable report (buildVictoriaReportHtml, still
// used by the "View Report" share page), but rendered into the page so it can
// flip between weeks and scroll each section instead of capping at 4.
let _wrIndex = 0;
let _wrStreakMode = 'weeks';   // 'weeks' | 'dollars' — Streaks section toggle
let _wrLastStreaks = null;      // last computed streak model, for in-place toggle

function _wrComputeModel(wk, histForStreaks) {
    const hist = histForStreaks || state.weeklyHistory;
    const tierOrder = { bonus: 3, goal: 2, low: 1, punish: 0 };
    const cur = h => (h.history?.[6] !== undefined) ? h.history[6] : (h.history?.[h.history.length - 1] ?? 0);
    const pay = (h, t) => ({ punish: h.valPunish||0, low: h.valLow||0, goal: h.valGoal||0, bonus: h.valBonus||0 }[t]);
    const habitsArr = (wk.habits || []).map(sh => {
        const live = (uiState.habits || []).find(h => h.id === sh.id);
        return live ? { ...live, history: sh.history } : null;
    }).filter(Boolean);
    const wins = habitsArr.filter(h => !h.excused)
        .map(h => { const c = cur(h), t = getTier(h, c), s = computeStreaksFromHistory(hist, h.id); return { icon: h.icon, name: h.name, t, payout: pay(h, t), streak: s.streak, bountyDollars: h.bountyDollars||0, bountyStars: h.bountyStars||0, bountyExcuseTokens: h.bountyExcuseTokens||0 }; })
        .filter(a => a.t === 'goal' || a.t === 'bonus')
        .sort((a, b) => tierOrder[b.t] !== tierOrder[a.t] ? tierOrder[b.t] - tierOrder[a.t] : b.payout !== a.payout ? b.payout - a.payout : b.streak - a.streak);
    const soClose = habitsArr.filter(h => !h.excused)
        .map(h => { const c = cur(h), t = getTier(h, c); if (t === 'bonus') return null; const nt = t === 'punish' ? 'low' : t === 'low' ? 'goal' : 'bonus'; const gap = Math.abs(pay(h, nt) - pay(h, t)); return gap > 0 ? { icon: h.icon, name: h.name, gap } : null; })
        .filter(Boolean)
        .sort((a, b) => b.gap - a.gap);

    return { wins, soClose, streaks: _streakModel(habitsArr, hist) };
}

function _wrWinRow(w) {
    const TC  = { punish:'#d9534f', low:'#e67e22', goal:'#27ae60', bonus:'#8e44ad' };
    const TB  = { punish:'rgba(217,83,79,0.07)', low:'rgba(230,126,34,0.07)', goal:'rgba(39,174,96,0.07)', bonus:'rgba(142,68,173,0.07)' };
    const PIL = { punish:'rgba(217,83,79,0.12)', low:'rgba(230,126,34,0.12)', goal:'rgba(39,174,96,0.12)', bonus:'rgba(142,68,173,0.12)' };
    return `
        <div style="display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:10px;margin-bottom:8px;background:${TB[w.t]};">
            <div style="font-size:22px;flex-shrink:0;">${w.icon}</div>
            <div style="flex:1;">
                <div style="font-weight:700;color:#4a3a3a;font-size:12px;margin-bottom:3px;">${w.name}</div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;padding:2px 6px;border-radius:4px;background:${PIL[w.t]};color:${TC[w.t]};">${w.t.toUpperCase()}</span>
                    ${w.streak >= 2 ? `<span style="font-size:10px;font-weight:600;color:#e6a02a;">🔥 ${w.streak}-week streak</span>` : ''}
                    ${w.bountyDollars > 0 || w.bountyStars > 0 || w.bountyExcuseTokens > 0 ? `<span style="font-size:9px;font-weight:700;color:#f0c040;background:rgba(240,192,64,0.12);border:1px solid rgba(240,192,64,0.3);padding:1px 6px;border-radius:8px;">🏆 Bounty${w.bountyDollars > 0 ? ' +$'+w.bountyDollars.toFixed(2) : ''}${w.bountyStars > 0 ? ' ✨'+w.bountyStars : ''}${w.bountyExcuseTokens > 0 ? ' 🎫'+w.bountyExcuseTokens : ''}</span>` : ''}
                </div>
            </div>
            <div style="font-family:'Great Vibes',cursive;font-size:22px;color:${TC[w.t]};flex-shrink:0;">+$${w.payout.toFixed(2)}</div>
        </div>`;
}

function _wrCloseRow(s) {
    return `
        <div style="display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:10px;margin-bottom:8px;background:rgba(212,163,163,0.05);border-left:3px solid rgba(196,144,196,0.3);">
            <div style="font-size:20px;flex-shrink:0;">${s.icon}</div>
            <div style="flex:1;">
                <div style="font-weight:700;color:#4a3a3a;font-size:12px;margin-bottom:3px;">${s.name}</div>
                <div style="font-size:10px;color:#aaa;">Next tier would have earned +$${s.gap.toFixed(2)} more</div>
            </div>
            <div style="font-family:'Great Vibes',cursive;font-size:20px;color:#c490c4;flex-shrink:0;">+$${s.gap.toFixed(2)}</div>
        </div>`;
}

function _wrStreakRow(o) {
    return `
        <div style="display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:10px;margin-bottom:8px;background:${o.bg};border-left:3px solid ${o.border};">
            <div style="font-size:20px;flex-shrink:0;">${o.emoji}</div>
            <div style="flex:1;">
                <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:${o.labelColor};margin-bottom:2px;">${o.label}</div>
                <div style="font-weight:700;color:#4a3a3a;font-size:12px;">${o.icon} ${o.name}</div>
                <div style="font-size:10px;color:#aaa;">${o.weeksText}</div>
            </div>
            <div style="font-family:'Great Vibes',cursive;font-size:20px;color:${o.amountColor};flex-shrink:0;">${o.amount}</div>
        </div>`;
}

// Inner content of the Streaks section: a By weeks / By $ toggle, two rows
// (good + bad) for the selected mode, and the weekly rolling-$ total.
function _wrStreakSectionInner(s, mode) {
    const tog = (m, label) =>
        `<button onclick="window.wrStreakMode('${m}')" style="flex:1;padding:7px 4px;border-radius:8px;border:none;font-family:'Montserrat',sans-serif;font-size:10px;font-weight:700;cursor:pointer;background:${mode === m ? '#c490c4' : 'rgba(196,144,196,0.12)'};color:${mode === m ? '#fff' : '#a87fa8'};">${label}</button>`;
    const toggleBar = `<div style="display:flex;gap:6px;margin-bottom:12px;">${tog('weeks', 'By weeks')}${tog('dollars', 'By $')}</div>`;

    let hot = '', cold = '';
    if (mode === 'dollars') {
        if (s.topBonus) hot = _wrStreakRow({
            emoji: '🔥', label: 'Highest rolling $', labelColor: '#c8961a',
            bg: 'rgba(240,192,64,0.08)', border: 'rgba(240,192,64,0.4)',
            icon: s.topBonus.icon, name: s.topBonus.name,
            weeksText: `${s.topBonus.streak} weeks rolling`,
            amount: `+$${s.topBonus.bonus.toFixed(2)}`, amountColor: '#27ae60'
        });
        if (s.topPenalty) cold = _wrStreakRow({
            emoji: '🌧️', label: 'Lowest rolling $', labelColor: '#d9534f',
            bg: 'rgba(217,83,79,0.05)', border: 'rgba(217,83,79,0.35)',
            icon: s.topPenalty.icon, name: s.topPenalty.name,
            weeksText: `${s.topPenalty.badStreak} weeks down`,
            amount: `-$${s.topPenalty.penalty.toFixed(2)}`, amountColor: '#d9534f'
        });
        if (!hot && !cold) return toggleBar + '<div style="color:#aaa;font-size:11px;padding:8px 0;">No streak bonuses or penalties this week.</div>';
    } else {
        if (s.topStreak) hot = _wrStreakRow({
            emoji: '🔥', label: 'Longest streak', labelColor: '#c8961a',
            bg: 'rgba(240,192,64,0.08)', border: 'rgba(240,192,64,0.4)',
            icon: s.topStreak.icon, name: s.topStreak.name,
            weeksText: `${s.topStreak.streak} weeks rolling`,
            amount: s.topStreak.bonus > 0 ? `+$${s.topStreak.bonus.toFixed(2)}` : '—', amountColor: '#27ae60'
        });
        if (s.topSlump) cold = _wrStreakRow({
            emoji: '🌧️', label: 'Longest slump', labelColor: '#d9534f',
            bg: 'rgba(217,83,79,0.05)', border: 'rgba(217,83,79,0.35)',
            icon: s.topSlump.icon, name: s.topSlump.name,
            weeksText: `${s.topSlump.badStreak} weeks down`,
            amount: s.topSlump.penalty > 0 ? `-$${s.topSlump.penalty.toFixed(2)}` : '—', amountColor: '#d9534f'
        });
        if (!hot && !cold) return toggleBar + '<div style="color:#aaa;font-size:11px;padding:8px 0;">No multi-week streaks yet — string a few good weeks together to start rolling up bonuses!</div>';
    }

    const summary = (s.totalBonus > 0 || s.totalPenalty > 0)
        ? `<div style="text-align:center;font-size:10px;color:#b0a0b8;margin-top:4px;">Rolling streak $ this week: ${s.totalBonus > 0 ? `<b style="color:#27ae60;">+$${s.totalBonus.toFixed(2)}</b> earned` : ''}${s.totalBonus > 0 && s.totalPenalty > 0 ? ' · ' : ''}${s.totalPenalty > 0 ? `<b style="color:#d9534f;">-$${s.totalPenalty.toFixed(2)}</b> lost` : ''}</div>`
        : '';
    return toggleBar + hot + cold + summary;
}

function renderInteractiveReport(idx) {
    const wh = state.weeklyHistory || [];
    const body = document.getElementById('weeklyReportBody');
    if (!body || !wh.length) return;
    _wrIndex = Math.min(Math.max(idx, 0), wh.length - 1);
    const wk = wh[_wrIndex];
    const histAsOf = wh.slice(_wrIndex);   // reported week + older → streaks "as of" then
    const { wins, soClose, streaks } = _wrComputeModel(wk, histAsOf);
    const stars = starsEarnedForWeekIndex(_wrIndex) || 0;
    const totalBalance = wk.totalBalance || 0;
    const totalStr = `${totalBalance >= 0 ? '+' : ''}$${Math.abs(totalBalance).toFixed(2)}`;
    const balColor = totalBalance >= 0 ? '#27ae60' : '#d9534f';
    const weekEnding = wk.weekEnding || '';
    const title = (label, n) =>
        `<div style="font-family:'Playfair Display',serif;font-size:15px;color:#c490c4;font-style:italic;margin-bottom:12px;padding-bottom:10px;border-bottom:1.5px solid rgba(196,144,196,0.2);display:flex;justify-content:space-between;align-items:baseline;"><span>${label}</span>${n > 4 ? `<span style="font-size:9px;color:#c9a8c9;font-style:normal;font-weight:600;">${n} total · scroll ↓</span>` : ''}</div>`;
    const winsHtml  = wins.length    ? wins.map(_wrWinRow).join('')      : '<div style="color:#aaa;font-size:11px;padding:8px 0;">Keep pushing — you\'ve got this next week!</div>';
    const closeHtml = soClose.length ? soClose.map(_wrCloseRow).join('') : '<div style="color:#aaa;font-size:11px;padding:8px 0;">Great job hitting your goals!</div>';
    _wrLastStreaks = streaks;
    const streakHtml = _wrStreakSectionInner(streaks, _wrStreakMode);

    body.innerHTML = `
      <div style="padding:16px 14px 26px;">
        <div style="border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(196,144,196,0.18);">
          <div style="background:linear-gradient(160deg,#f9ecec 0%,#f5eaf5 50%,#ede8f8 100%);padding:26px 24px 18px;text-align:center;">
            <div style="font-size:10px;color:#c9a8c9;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:8px;">Week Ending ${weekEnding}</div>
            <div style="font-family:'Great Vibes',cursive;font-size:52px;color:#c490c4;line-height:1;margin-bottom:6px;">Victoria</div>
            <div style="font-family:'Playfair Display',serif;font-size:12px;color:#b8a8c8;font-style:italic;">Weekly Report</div>
          </div>
          <div style="background:linear-gradient(180deg,#fdf8ff 0%,#f8f4fc 100%);padding:22px 24px;text-align:center;border-top:1px solid rgba(196,144,196,0.12);">
            <div style="font-family:'Great Vibes',cursive;font-size:64px;color:${balColor};line-height:1;margin-bottom:6px;">${totalStr}</div>
            <div style="font-size:9px;text-transform:uppercase;letter-spacing:2px;font-weight:700;color:#ccc;${stars>0?'margin-bottom:12px;':''}">This Week's Earnings</div>
            ${stars>0?`<div style="display:inline-block;background:rgba(240,192,64,0.12);border:1px solid rgba(240,192,64,0.3);border-radius:20px;padding:5px 14px;font-size:11px;font-weight:600;color:#c8961a;">✨ ${stars} star${stars!==1?'s':''} earned this week</div>`:''}
          </div>
          <div style="background:linear-gradient(180deg,#fdf8ff 0%,#f9f4fd 100%);padding:18px 20px 16px;border-top:1px solid rgba(196,144,196,0.12);">
            ${title('🌟 You Crushed It', wins.length)}
            <div class="wr-scroll4">${winsHtml}</div>
          </div>
          <div style="background:linear-gradient(180deg,#fdf8ff 0%,#f9f4fd 100%);padding:18px 20px 16px;border-top:1px solid rgba(196,144,196,0.12);">
            ${title('💪 So Close', soClose.length)}
            <div class="wr-scroll4">${closeHtml}</div>
          </div>
          <div style="background:linear-gradient(180deg,#fdf8ff 0%,#f9f4fd 100%);padding:18px 20px 16px;border-top:1px solid rgba(196,144,196,0.12);">
            <div style="font-family:'Playfair Display',serif;font-size:15px;color:#c490c4;font-style:italic;margin-bottom:12px;padding-bottom:10px;border-bottom:1.5px solid rgba(196,144,196,0.2);">🔥 Streaks</div>
            <div id="wrStreakSection">${streakHtml}</div>
          </div>
          <div style="background:linear-gradient(160deg,#f9ecec 0%,#f5eaf5 50%,#ede8f8 100%);padding:22px;text-align:center;border-top:1px solid rgba(196,144,196,0.12);">
            <div style="font-size:12px;color:#b0a0b8;line-height:1.7;margin-bottom:10px;">You're doing amazing!<br>Keep up the momentum next week. 💕</div>
            <div style="font-family:'Great Vibes',cursive;font-size:30px;color:#c490c4;">— Drew</div>
          </div>
        </div>
      </div>`;

    const lbl = document.getElementById('wrWeekLabel');
    const prevBtn = document.getElementById('wrPrev');
    const nextBtn = document.getElementById('wrNext');
    if (lbl) lbl.textContent = weekEnding ? ('Week of ' + weekEnding) : 'Weekly Report';
    if (prevBtn) prevBtn.disabled = (_wrIndex >= wh.length - 1);  // no older week
    if (nextBtn) nextBtn.disabled = (_wrIndex <= 0);              // no newer week
    body.scrollTop = 0;
}

window.wrFlipWeek = (dir) => {
    const len = (state.weeklyHistory || []).length;
    const ni  = Math.min(Math.max(_wrIndex + dir, 0), len - 1);
    if (ni !== _wrIndex) renderInteractiveReport(ni);
};

// Toggle the Streaks section between "By weeks" and "By $" without re-rendering
// the whole report (keeps the user's scroll position).
window.wrStreakMode = (m) => {
    if ((m !== 'weeks' && m !== 'dollars') || m === _wrStreakMode) return;
    _wrStreakMode = m;
    const el = document.getElementById('wrStreakSection');
    if (el && _wrLastStreaks) el.innerHTML = _wrStreakSectionInner(_wrLastStreaks, _wrStreakMode);
};

window.openWeeklyReportPopup = () => {
    const overlay = document.getElementById('weeklyReportOverlay');
    if (!overlay || !(state.weeklyHistory || []).length) return;
    renderInteractiveReport(0);
    overlay.classList.add('wr-open');
};

window.closeWeeklyReportPopup = () => {
    document.getElementById('weeklyReportOverlay')?.classList.remove('wr-open');
};

window.muteWeeklyReportPopup = () => {
    localStorage.setItem('vt_muteWeeklyReportPopup', '1');
    window.closeWeeklyReportPopup();
};

// Called on startup (from index.html) after habits + history load. Shows the
// popup only when a newer weekly snapshot exists than this device last saw.
let _weeklyPopupChecked = false;
window.maybeShowWeeklyReportAfterReset = () => {
    if (_weeklyPopupChecked) return;
    if (!uiState.habits || !uiState.habits.length) return;            // wait for habits
    if (!state.historyLoaded || !state.weeklyHistory.length) return;  // wait for history
    _weeklyPopupChecked = true;
    if (localStorage.getItem('vt_muteWeeklyReportPopup') === '1') return;        // muted on this device
    const latestId = String(state.weeklyHistory[0].id);
    if (localStorage.getItem('vt_lastSeenWeeklyReportId') === latestId) return;  // already seen
    localStorage.setItem('vt_lastSeenWeeklyReportId', latestId);
    window.openWeeklyReportPopup();
};

// Shared streak model — used by both the interactive report and the static
// "View Report" page. For each non-excused habit: its current good/bad streak
// (as of the given history) and the rolling $ it's worth this week
// (min(weeks × per, cap), the payout engine's formula). Tracks the leaders by
// weeks and by $, plus weekly totals.
function _streakModel(habitsArr, hist) {
    let topStreak = null, topSlump = null, topBonus = null, topPenalty = null, totalBonus = 0, totalPenalty = 0;
    habitsArr.filter(h => !h.excused).forEach(h => {
        const { streak, badStreak } = computeStreaksFromHistory(hist, h.id);
        const cap     = h.streakCap ? parseFloat(h.streakCap) : Infinity;
        const bonus   = (streak    >= 2 && (h.streakBonusPer   || 0) > 0) ? Math.min(streak    * h.streakBonusPer,   cap) : 0;
        const penalty = (badStreak >= 2 && (h.streakPenaltyPer || 0) > 0) ? Math.min(badStreak * h.streakPenaltyPer, cap) : 0;
        totalBonus += bonus; totalPenalty += penalty;
        if (streak    >= 2 && (!topStreak || streak    > topStreak.streak))   topStreak  = { icon: h.icon, name: h.name, streak, bonus };
        if (badStreak >= 2 && (!topSlump  || badStreak > topSlump.badStreak)) topSlump   = { icon: h.icon, name: h.name, badStreak, penalty };
        if (bonus   > 0 && (!topBonus   || bonus   > topBonus.bonus))     topBonus   = { icon: h.icon, name: h.name, streak, bonus };
        if (penalty > 0 && (!topPenalty || penalty > topPenalty.penalty)) topPenalty = { icon: h.icon, name: h.name, badStreak, penalty };
    });
    return { topStreak, topSlump, topBonus, topPenalty, totalBonus, totalPenalty };
}

// Static streaks block for the shareable page: shows both "By weeks" and
// "By rolling $" groups (no toggle on a static page), then the weekly total.
function _streakSectionStatic(s) {
    if (!s.topStreak && !s.topSlump && !s.topBonus && !s.topPenalty) {
        return '<div style="color:#aaa;font-size:11px;padding:8px 0;">No multi-week streaks yet.</div>';
    }
    const sub = t => `<div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#c9a8c9;margin:2px 0 8px;">${t}</div>`;
    let html = '';
    if (s.topStreak || s.topSlump) {
        html += sub('By weeks');
        if (s.topStreak) html += _wrStreakRow({ emoji:'🔥', label:'Longest streak', labelColor:'#c8961a', bg:'rgba(240,192,64,0.08)', border:'rgba(240,192,64,0.4)', icon:s.topStreak.icon, name:s.topStreak.name, weeksText:`${s.topStreak.streak} weeks rolling`, amount: s.topStreak.bonus > 0 ? `+$${s.topStreak.bonus.toFixed(2)}` : '—', amountColor:'#27ae60' });
        if (s.topSlump)  html += _wrStreakRow({ emoji:'🌧️', label:'Longest slump', labelColor:'#d9534f', bg:'rgba(217,83,79,0.05)', border:'rgba(217,83,79,0.35)', icon:s.topSlump.icon, name:s.topSlump.name, weeksText:`${s.topSlump.badStreak} weeks down`, amount: s.topSlump.penalty > 0 ? `-$${s.topSlump.penalty.toFixed(2)}` : '—', amountColor:'#d9534f' });
    }
    if (s.topBonus || s.topPenalty) {
        html += sub('By rolling $');
        if (s.topBonus)   html += _wrStreakRow({ emoji:'🔥', label:'Highest rolling $', labelColor:'#c8961a', bg:'rgba(240,192,64,0.08)', border:'rgba(240,192,64,0.4)', icon:s.topBonus.icon, name:s.topBonus.name, weeksText:`${s.topBonus.streak} weeks rolling`, amount:`+$${s.topBonus.bonus.toFixed(2)}`, amountColor:'#27ae60' });
        if (s.topPenalty) html += _wrStreakRow({ emoji:'🌧️', label:'Lowest rolling $', labelColor:'#d9534f', bg:'rgba(217,83,79,0.05)', border:'rgba(217,83,79,0.35)', icon:s.topPenalty.icon, name:s.topPenalty.name, weeksText:`${s.topPenalty.badStreak} weeks down`, amount:`-$${s.topPenalty.penalty.toFixed(2)}`, amountColor:'#d9534f' });
    }
    const summary = (s.totalBonus > 0 || s.totalPenalty > 0)
        ? `<div style="text-align:center;font-size:10px;color:#b0a0b8;margin-top:6px;">Rolling streak $ this week: ${s.totalBonus > 0 ? `<b style="color:#27ae60;">+$${s.totalBonus.toFixed(2)}</b> earned` : ''}${s.totalBonus > 0 && s.totalPenalty > 0 ? ' · ' : ''}${s.totalPenalty > 0 ? `<b style="color:#d9534f;">-$${s.totalPenalty.toFixed(2)}</b> lost` : ''}</div>`
        : '';
    return html + summary;
}

function buildVictoriaReportHtml(habitsArr, totalBalance, weekEndingOverride, starsEarnedOverride) {
    const now      = new Date();
    const months   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const weekEnding = weekEndingOverride || (months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear());
    const TC  = { punish: '#d9534f', low: '#e67e22', goal: '#27ae60', bonus: '#8e44ad' };
    const TB  = { punish: 'rgba(217,83,79,0.07)', low: 'rgba(230,126,34,0.07)', goal: 'rgba(39,174,96,0.07)', bonus: 'rgba(142,68,173,0.07)' };
    const PIL = { punish: 'rgba(217,83,79,0.12)', low: 'rgba(230,126,34,0.12)', goal: 'rgba(39,174,96,0.12)', bonus: 'rgba(142,68,173,0.12)' };
    const tierOrder = { bonus: 3, goal: 2, low: 1, punish: 0 };

    const cur  = h => (h.history?.[6] !== undefined) ? h.history[6] : (h.history?.[h.history.length - 1] ?? 0);
    const pay  = (h, t) => ({ punish: h.valPunish||0, low: h.valLow||0, goal: h.valGoal||0, bonus: h.valBonus||0 }[t]);

    // Stars gained during the reported week. Prefer the explicit override
    // (the snapshot-window total passed by the report callers); otherwise fall
    // back to "this week so far" since last Monday midnight.
    let starsThisWeek;
    if (typeof starsEarnedOverride === 'number') {
        starsThisWeek = starsEarnedOverride;
    } else {
        const nowD = new Date();
        const dow  = nowD.getDay();
        const mon  = new Date(nowD);
        mon.setDate(nowD.getDate() - dow + (dow === 0 ? -6 : 1));
        mon.setHours(0, 0, 0, 0);
        const weekStart = mon.getTime();
        starsThisWeek = (state.starLog || [])
            .filter(e => e.ts >= weekStart && (e.type === 'earn' || e.type === 'luckyDraw'))
            .reduce((sum, e) => sum + (e.amount || 0), 0);
    }

    // ── YOU CRUSHED IT ───────────────────────────────────────────────
    // Goal or Bonus only · sort: tier desc → payout desc → streak desc (all of them)
    const wins = habitsArr
        .filter(h => !h.excused)
        .map(h => { const c = cur(h), t = getTier(h, c), s = computeStreaksFromHistory(state.weeklyHistory, h.id); return { icon: h.icon, name: h.name, t, payout: pay(h, t), streak: s.streak, bountyDollars: h.bountyDollars || 0, bountyStars: h.bountyStars || 0, bountyExcuseTokens: h.bountyExcuseTokens || 0, bountyNote: h.bountyNote || '' }; })
        .filter(a => a.t === 'goal' || a.t === 'bonus')
        .sort((a, b) => tierOrder[b.t] !== tierOrder[a.t] ? tierOrder[b.t] - tierOrder[a.t] : b.payout !== a.payout ? b.payout - a.payout : b.streak - a.streak);

    // ── SO CLOSE ────────────────────────────────────────────────────
    // Not at Bonus · sort by biggest dollar gap to next tier (all of them)
    const soClose = habitsArr
        .filter(h => !h.excused)
        .map(h => { const c = cur(h), t = getTier(h, c); if (t === 'bonus') return null; const nt = t === 'punish' ? 'low' : t === 'low' ? 'goal' : 'bonus'; const gap = Math.abs(pay(h, nt) - pay(h, t)); return gap > 0 ? { icon: h.icon, name: h.name, nt, gap } : null; })
        .filter(x => x)
        .sort((a, b) => b.gap - a.gap);

    const totalStr = `${totalBalance >= 0 ? '+' : ''}$${Math.abs(totalBalance).toFixed(2)}`;
    const balColor = totalBalance >= 0 ? '#27ae60' : '#d9534f';

    const winsHtml = wins.length ? wins.map(w => `
        <div style="display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:10px;margin-bottom:8px;background:${TB[w.t]};">
            <div style="font-size:22px;flex-shrink:0;">${w.icon}</div>
            <div style="flex:1;">
                <div style="font-weight:700;color:#4a3a3a;font-size:12px;margin-bottom:3px;">${w.name}</div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span style="font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;padding:2px 6px;border-radius:4px;background:${PIL[w.t]};color:${TC[w.t]};">${w.t.toUpperCase()}</span>
                    ${w.streak >= 2 ? `<span style="font-size:10px;font-weight:600;color:#e6a02a;">🔥 ${w.streak}-week streak</span>` : ''}
                    ${w.bountyDollars > 0 || w.bountyStars > 0 || w.bountyExcuseTokens > 0 ? `<span style="font-size:9px;font-weight:700;color:#f0c040;background:rgba(240,192,64,0.12);border:1px solid rgba(240,192,64,0.3);padding:1px 6px;border-radius:8px;">🏆 Bounty${w.bountyDollars > 0 ? ' +$'+w.bountyDollars.toFixed(2) : ''}${w.bountyStars > 0 ? ' ✨'+w.bountyStars : ''}${w.bountyExcuseTokens > 0 ? ' 🎫'+w.bountyExcuseTokens : ''}</span>` : ''}
                </div>
            </div>
            <div style="font-family:'Great Vibes',cursive;font-size:22px;color:${TC[w.t]};flex-shrink:0;">+$${w.payout.toFixed(2)}</div>
        </div>`).join('')
        : '<div style="color:#aaa;font-size:11px;padding:8px 0;">Keep pushing — you\'ve got this next week!</div>';

    const soCloseHtml = soClose.length ? soClose.map(s => `
        <div style="display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:10px;margin-bottom:8px;background:rgba(212,163,163,0.05);border-left:3px solid rgba(196,144,196,0.3);">
            <div style="font-size:20px;flex-shrink:0;">${s.icon}</div>
            <div style="flex:1;">
                <div style="font-weight:700;color:#4a3a3a;font-size:12px;margin-bottom:3px;">${s.name}</div>
                <div style="font-size:10px;color:#aaa;">Next tier would have earned +$${s.gap.toFixed(2)} more</div>
            </div>
            <div style="font-family:'Great Vibes',cursive;font-size:20px;color:#c490c4;flex-shrink:0;">+$${s.gap.toFixed(2)}</div>
        </div>`).join('')
        : '<div style="color:#aaa;font-size:11px;padding:8px 0;">Great job hitting your goals!</div>';

    const streaksHtml = _streakSectionStatic(_streakModel(habitsArr, state.weeklyHistory));

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0"><title>Victoria's Weekly Report</title><link href="https://fonts.googleapis.com/css2?family=Great+Vibes&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Montserrat:wght@300;400;600;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#ede9f4;font-family:'Montserrat',sans-serif;min-height:100vh;padding:20px 16px 40px;}.wrap{max-width:420px;margin:0 auto;}.hint{background:#d4a3a3;color:white;text-align:center;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:600;margin-bottom:16px;}@media print{.hint{display:none}body{background:white;padding:0}}</style></head><body><div class="wrap"><div class="hint">📋 Victoria's Weekly Report · ${weekEnding}</div><div style="border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(196,144,196,0.18);"><div style="background:linear-gradient(160deg,#f9ecec 0%,#f5eaf5 50%,#ede8f8 100%);padding:32px 24px 24px;text-align:center;"><div style="font-size:10px;color:#c9a8c9;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:8px;">Week Ending ${weekEnding}</div><div style="font-family:'Great Vibes',cursive;font-size:58px;color:#c490c4;line-height:1;margin-bottom:6px;">Victoria</div><div style="font-family:'Playfair Display',serif;font-size:12px;color:#b8a8c8;font-style:italic;">Weekly Report</div></div><div style="background:linear-gradient(180deg,#fdf8ff 0%,#f8f4fc 100%);padding:28px 24px;text-align:center;border-top:1px solid rgba(196,144,196,0.12);"><div style="font-family:'Great Vibes',cursive;font-size:72px;color:${balColor};line-height:1;margin-bottom:6px;">${totalStr}</div><div style="font-size:9px;text-transform:uppercase;letter-spacing:2px;font-weight:700;color:#ccc;${starsThisWeek>0?'margin-bottom:12px;':''}">This Week's Earnings</div>${starsThisWeek>0?`<div style="display:inline-block;background:rgba(240,192,64,0.12);border:1px solid rgba(240,192,64,0.3);border-radius:20px;padding:5px 14px;font-size:11px;font-weight:600;color:#c8961a;">✨ ${starsThisWeek} star${starsThisWeek!==1?'s':''} earned this week</div>`:''}</div><div style="background:linear-gradient(180deg,#fdf8ff 0%,#f9f4fd 100%);padding:20px 20px 16px;border-top:1px solid rgba(196,144,196,0.12);"><div style="font-family:'Playfair Display',serif;font-size:15px;color:#c490c4;font-style:italic;margin-bottom:14px;padding-bottom:10px;border-bottom:1.5px solid rgba(196,144,196,0.2);">🌟 You Crushed It</div>${winsHtml}</div><div style="background:linear-gradient(180deg,#fdf8ff 0%,#f9f4fd 100%);padding:20px 20px 16px;border-top:1px solid rgba(196,144,196,0.12);"><div style="font-family:'Playfair Display',serif;font-size:15px;color:#c490c4;font-style:italic;margin-bottom:14px;padding-bottom:10px;border-bottom:1.5px solid rgba(196,144,196,0.2);">💪 So Close</div>${soCloseHtml}</div><div style="background:linear-gradient(180deg,#fdf8ff 0%,#f9f4fd 100%);padding:20px 20px 16px;border-top:1px solid rgba(196,144,196,0.12);"><div style="font-family:'Playfair Display',serif;font-size:15px;color:#c490c4;font-style:italic;margin-bottom:14px;padding-bottom:10px;border-bottom:1.5px solid rgba(196,144,196,0.2);">🔥 Streaks</div>${streaksHtml}</div><div style="background:linear-gradient(160deg,#f9ecec 0%,#f5eaf5 50%,#ede8f8 100%);padding:24px;text-align:center;border-top:1px solid rgba(196,144,196,0.12);"><div style="font-size:12px;color:#b0a0b8;line-height:1.7;margin-bottom:10px;">You're doing amazing!<br>Keep up the momentum next week. 💕</div><div style="font-family:'Great Vibes',cursive;font-size:30px;color:#c490c4;">— Drew</div></div></div></div></body></html>`;
}

// Re-export for runWeeklyReport in index.html
export { buildVictoriaReportHtml };
