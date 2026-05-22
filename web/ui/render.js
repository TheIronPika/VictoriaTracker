// ─────────────────────────────────────────────────────────────────────
// web/ui/render.js
// Main render loop and all navigation/toggle handlers.
// This is the only UI module that imports from other UI modules —
// it needs renderSeasonalSection (events) and renderHistory (history),
// plus renderEventsManage + renderShopManage for the Manage panel reveal.
// ─────────────────────────────────────────────────────────────────────

import { uiState, saveCollapsedState } from './ui-state.js';
import { state } from '../../Core/state.js';
import { getDayIdx } from '../../Core/utils.js';
import { getTier } from '../../Core/habits.js';
import { isCycleDue, cycleLabel, cycleDueLabel } from '../../Core/cycles.js';
import { computeStreaksFromHistory } from '../../Core/streaks.js';
import { MANAGE_PASSCODE } from '../../Core/config.js';
import { animateMoneyDisplay } from './animations.js';
import { renderSeasonalSection, renderEventsManage } from './events-ui.js';
import { renderShopManage } from './shop-ui.js';
import { renderHistory, destroyHistoryCharts } from './history-ui.js';
import { isPeriodActive, periodDayCount, periodStartDayIdx } from '../../Core/period.js';
import { getRoomPayoutsTotal } from '../../Core/rooms.js';
import { renderPeriodHistory } from './period-ui.js';
import { renderRoomsSection } from './rooms-ui.js';
import { computeForecast } from './manage-ui.js';
import { syncHabits } from '../../Core/habits-data.js';

// ── Main render ───────────────────────────────────────────────────────

export function render() {
    buildDateStrip();
    updateFiltersUI();

    // Update period pill in header
    const pill = document.getElementById('periodPill');
    if (pill) {
        if (isPeriodActive()) {
            pill.textContent = `🩸 Day ${periodDayCount()}`;
            pill.classList.remove('period-inactive');
        } else {
            pill.textContent = '🩸';
            pill.classList.add('period-inactive');
        }
    }

    const todayRoot    = document.getElementById('todayRoot');
    const priorityRoot = document.getElementById('priorityRoot');
    const weeklyRoot   = document.getElementById('weeklyRoot');
    const manageRoot   = document.getElementById('manageRoot');
    const manageListRoot = document.getElementById('manageListRoot');

    // Only rebuild manage panel when visible (behind passcode — expensive to rebuild every render)
    const manageVisible = document.getElementById('managePanel')?.style.display !== 'none';

    document.querySelectorAll('.pmode-btn').forEach(b => {
        b.classList.toggle('pmode-active', b.dataset.mode === uiState.priorityMode);
    });

    const dIdx = getDayIdx(uiState.viewingDate);

    // Build HTML strings instead of using += in loops (much faster)
    let todayHtml = '';
    let priorityHtml = '';
    let weeklyHtml = '';
    let manageHtml = '';
    let manageListHtml = '';

    let totalMoney = 0;
    let counts = { punish: 0, low: 0, goal: 0, bonus: 0 };

    const categories = [...new Set(uiState.habits.map(h => h.cat))];

    categories.forEach(cat => {
        const isCol = uiState.collapsed[cat] !== false;
        let items   = uiState.habits.filter(h => h.cat === cat && isCycleDue(h));
        // For manage panel: include ALL habits in this category, not just cycle-due
        let allItemsForManage = uiState.habits.filter(h => h.cat === cat);

        if (!uiState.sortLocked) {
            items.sort((a, b) => {
                const aP = a.history[dIdx] > 0;
                const bP = b.history[dIdx] > 0;
                if (aP && !bP) return 1;
                if (!aP && bP) return -1;
                return 0;
            });
        }

        const miniDotsHtml = items.map(h => {
            if (h.excused) return `<div class="mini-dot" style="background:#c8c8c8;opacity:0.5;"></div>`;
            const t = getTier(h, h.history[dIdx]);
            return `<div class="mini-dot" style="background:var(--grad-${t})"></div>`;
        }).join('');

        todayHtml += `
            <div class="category-header" onclick="window.toggleCol('${cat}')">
                <div style="flex:1">
                    <span class="cat-label">${cat}</span>
                    <div class="status-mini-bar">${miniDotsHtml}</div>
                </div>
                <span style="color:var(--header-pink); font-size:12px; font-weight:bold;">${isCol ? 'SHOW ✦' : 'HIDE ✧'}</span>
            </div>
        `;

        let weekSectionHtml = `
            <div class="weekly-cat-section">
                <h3 class="weekly-cat-label" style="font-family:'Playfair Display'; font-size:14px; margin: 20px 0 10px 5px; color:var(--header-pink); text-transform:uppercase; letter-spacing:1px;">${cat}</h3>
                <div class="weekly-grid">
                    <div class="weekly-row day-labels">
                        <span class="weekly-task-name"></span>
                        <div class="weekly-dots-row">
                            <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>
                        </div>
                    </div>
        `;

        // Manage panel: collapsible category header for left panel list
        let manageCatHtml = '';
        if (manageVisible) {
            const catId = cat.replace(/[^a-zA-Z0-9]/g, '_');
            const mspCatCollapsed = JSON.parse(localStorage.getItem('mspCatCollapsed') || '{}');
            const isCatCollapsed  = mspCatCollapsed[catId] === true;
            manageCatHtml = `<div class="msp-cat-label msp-cat-toggle" onclick="window.toggleMspCat('${catId}')"><span>${cat}</span><span id="msp-chev-${catId}" style="transition:transform 0.2s;display:inline-block;${isCatCollapsed ? 'transform:rotate(-90deg)' : ''}">&#9662;</span></div><div id="msp-cat-${catId}" style="${isCatCollapsed ? 'display:none' : ''}">`;
            manageListHtml += manageCatHtml;
        }

        items.forEach(h => {
            const cur  = h.history[dIdx];
            const tier = getTier(h, cur);
            const periodProtected = isPeriodActive() && !!h.periodSensitive;

            let payout = 0;
            if (!h.excused) {
                if (tier === 'punish')     payout = periodProtected ? 0 : (h.valPunish || 0);
                else if (tier === 'low')   payout = h.valLow;
                else if (tier === 'goal')  payout = h.valGoal;
                else if (tier === 'bonus') payout = h.valBonus;

                if ((tier === 'goal' || tier === 'bonus') && (h.streak || 0) >= 2 && (h.streakBonusPer || 0) > 0) {
                    const raw = (h.streak || 0) * h.streakBonusPer;
                    payout += Math.min(raw, h.streakCap ? parseFloat(h.streakCap) : Infinity);
                }
                if (!periodProtected && (tier === 'punish' || tier === 'low') && (h.badStreak || 0) >= 2 && (h.streakPenaltyPer || 0) > 0) {
                    const raw = (h.badStreak || 0) * h.streakPenaltyPer;
                    payout -= Math.min(raw, h.streakCap ? parseFloat(h.streakCap) : Infinity);
                }
                totalMoney += payout;
                if (tier === 'punish' && h.valPunish < 0) { counts.punish++; }
                else if (tier !== 'punish') { counts[tier]++; }
            }

            const daysRemaining = 7 - dIdx;
            const modeThresh    = uiState.priorityMode === 'bonus' ? h.bonus : h.goal;
            const possible      = daysRemaining * (h.dailyMax || 1);
            const isUrgent      = !h.excused && (modeThresh - cur) >= possible && (modeThresh - cur) > 0;
            const isArriving    = h.id === uiState.lastActedId;

            // Cache streak computation (called twice per habit otherwise)
            const streaks = computeStreaksFromHistory(state.weeklyHistory, h.id);
            const glowClass = streaks.streak >= 14 ? 'glow-intense'
                            : streaks.streak >=  4 ? 'glow-bright'
                            : streaks.streak >=  2 ? 'glow-medium'
                            : streaks.streak >=  1 ? 'glow-light'
                            : '';

            // Forecast badge (📈/📉 vs last week pace)
            const forecast = computeForecast(h);
            const forecastBadgeSpan = forecast
                ? `<span class="forecast-badge ${forecast.dir}" onclick="event.stopPropagation();document.getElementById('fc-${h.id}').classList.toggle('show')">
                       ${forecast.dir === 'up' ? '📈' : '📉'} ${forecast.pace}
                   </span>` : '';
            const forecastDetailDiv = forecast
                ? `<div class="forecast-detail" id="fc-${h.id}">On pace for ${forecast.pace} · last week: ${forecast.lastWeek}</div>`
                : '';

            const periodProtectedCard = isPeriodActive() && !!h.periodSensitive;
            const pStartIdx = periodStartDayIdx(getDayIdx);

            const _DS = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'];
            function dayForBubble(hist, i) {
                for (let d = 0; d < 7; d++) { if ((hist[d] || 0) >= i) return _DS[d]; }
                return '';
            }
            let bubblesHtml = '';
            for (let i = 1; i <= (h.max || 7); i++) {
                const stepTier  = getTier(h, i);
                const isFilled  = i <= cur;
                const dayLetter = isFilled ? dayForBubble(h.history, i) : '';
                const isPaused  = !isFilled && (isPeriodActive() || state.periodData.periodWasThisWeek) && !!h.periodSensitive && dIdx >= pStartIdx;
                bubblesHtml += `<div class="bubble day-bub ${isFilled ? 'filled ' + stepTier : ''} ${isPaused ? 'period-paused' : ''}"
                    style="border-color:var(--color-${stepTier})"
                    onclick="window.toggleBubble('${h.id}',${i})">${dayLetter}</div>`;
            }

            const cardHtml = `
                <div class="habit-card ${isUrgent ? 'priority-border' : ''} ${isArriving ? 'card-arriving' : ''} ${glowClass} ${h.bountyActive ? 'bounty-glow' : ''} ${periodProtectedCard ? 'period-protected-card' : ''}"
                     data-habit-id="${h.id}"
                     ontouchstart="window.startLongPress('${h.id}')"
                     ontouchend="window.cancelLongPress()"
                     ontouchmove="window.cancelLongPress()">
                    <div style="font-size:24px; margin-right:15px;">${h.icon}</div>
                    <div style="flex:1">
                        ${isUrgent ? `<span class="priority-tag">✦ ${uiState.priorityMode === 'bonus' ? 'Bonus' : 'Goal'} at Risk</span>` : ''}
                        ${periodProtectedCard ? '<span class="period-tag">✦ Period protected</span>' : ''}
                        ${h.excused ? '<span class="excused-tag">✦ Excused this week</span>' : ''}
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            <p style="margin:0; font-weight:600;">${h.name}</p>
                            ${streaks.streak >= 1 ? `<span class="streak-badge">🔥 ${streaks.streak}</span>` : ''}
                            ${streaks.badStreak >= 1 ? `<span class="bad-streak-badge">🌧️ ${streaks.badStreak}</span>` : ''}
                            ${cycleLabel(h) ? `<span class="cycle-badge">🔄 ${cycleLabel(h)}</span>` : ''}
                            ${h.bountyActive ? `<span class="bounty-badge">🏆 Bounty</span>` : ''}
                            ${forecastBadgeSpan}
                            <button class="excuse-btn ${h.excused ? 'excuse-on' : ''}" onclick="event.stopPropagation();window.toggleExcused('${h.id}')">${h.excused ? 'Unexcuse' : 'Excuse'}</button>
                        </div>
                        ${forecastDetailDiv}
                        <div class="bubbles">${bubblesHtml}</div>
                    </div>
                </div>`;

            if (!isCol) {
                if (!uiState.activeFilter)                             todayHtml += cardHtml;
                else if (uiState.activeFilter === 'punish' && tier === 'punish' && h.valPunish < 0)
                                                                        todayHtml += cardHtml;
                else if (uiState.activeFilter === tier)                todayHtml += cardHtml;
            }

            if (isUrgent) priorityHtml += cardHtml;

            const weeklyDotsHtml = h.history.map((c, i) => {
                const isActionDay = (i === 0 && c > 0) || (i > 0 && c !== h.history[i - 1]);
                const dayTier     = getTier(h, c);
                return isActionDay && c > 0
                    ? `<div class="weekly-dot-container"><div class="weekly-dot" style="background:var(--grad-${dayTier})"></div></div>`
                    : `<div class="weekly-dot-container"><div class="weekly-dot" style="background:#eee"></div></div>`;
            }).join('');

            weekSectionHtml += `
                <div class="weekly-row">
                    <span class="weekly-task-name">${h.name}</span>
                    <div class="weekly-dots-row">${weeklyDotsHtml}</div>
                </div>`;

            manageHtml += `
                <div class="manage-card">
                    <h4 class="beloved-small" style="font-family:'Great Vibes'; font-size:24px; color:var(--header-pink); margin:0 0 10px 0;">${h.icon} ${h.name}</h4>
                    <div style="margin-bottom:10px; display:flex; gap:20px; align-items:center; flex-wrap:wrap;">
                        <div style="font-size:12px;">Max Circles (week):
                            <input type="number" value="${h.max || 7}" min="1" max="49" style="width:45px; margin-left:4px;"
                            onchange="window.updateField('${h.id}','max',this.value)">
                        </div>
                        <div style="font-size:12px;">Daily Max:
                            <input type="number" value="${h.dailyMax || 1}" min="1" max="7" style="width:40px; margin-left:4px;"
                            onchange="window.updateField('${h.id}','dailyMax',this.value)">
                            <span style="font-size:10px; color:#aaa; margin-left:4px;">completions/day</span>
                        </div>
                    </div>
                    <table class="matrix-table">
                        <tr><th>Tier</th><th>Qty</th><th>$ Payout</th><th>✨ Stars</th></tr>
                        <tr><td style="color:var(--color-punish)">Debt</td><td><input type="number" value="${h.punish}" onchange="window.updateField('${h.id}','punish',this.value)"></td><td><input type="number" value="${h.valPunish}" onchange="window.updateField('${h.id}','valPunish',this.value)"></td><td style="color:#aaa;font-size:10px;text-align:center;">—</td></tr>
                        <tr><td style="color:var(--color-low)">Low</td><td><input type="number" value="${h.low}" onchange="window.updateField('${h.id}','low',this.value)"></td><td><input type="number" value="${h.valLow}" onchange="window.updateField('${h.id}','valLow',this.value)"></td><td style="color:#aaa;font-size:10px;text-align:center;">—</td></tr>
                        <tr><td style="color:var(--color-goal)">Goal</td><td><input type="number" value="${h.goal}" onchange="window.updateField('${h.id}','goal',this.value)"></td><td><input type="number" value="${h.valGoal}" onchange="window.updateField('${h.id}','valGoal',this.value)"></td><td><input type="number" value="${h.starGoal||''}" placeholder="—" min="0" style="width:34px;" onchange="window.updateField('${h.id}','starGoal',this.value)"></td></tr>
                        <tr><td style="color:var(--color-bonus)">Bonus</td><td><input type="number" value="${h.bonus}" onchange="window.updateField('${h.id}','bonus',this.value)"></td><td><input type="number" value="${h.valBonus}" onchange="window.updateField('${h.id}','valBonus',this.value)"></td><td><input type="number" value="${h.starBonus||''}" placeholder="—" min="0" style="width:34px;" onchange="window.updateField('${h.id}','starBonus',this.value)"></td></tr>
                        <tr><td style="color:#f0c040">🔥 Streak</td><td colspan="2" style="font-size:10px;color:#aaa;vertical-align:middle;">Stars per reset if streak ≥ 2</td><td><input type="number" value="${h.starStreak||''}" placeholder="—" min="0" style="width:34px;" onchange="window.updateField('${h.id}','starStreak',this.value)"></td></tr>
                    </table>
                    <div style="margin-top:12px;padding-top:10px;border-top:1px solid #f5f5f5;">
                        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Cycle Schedule</div>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
                            <select style="padding:6px 8px;border:1px solid #eee;border-radius:8px;font-size:12px;font-family:'Montserrat';" onchange="window.updateField('${h.id}','cycleType',this.value)">
                                <option value="none" ${(!h.cycleType||h.cycleType==='none')?'selected':''}>No cycle</option>
                                <option value="weeks" ${h.cycleType==='weeks'?'selected':''}>Every N weeks</option>
                                <option value="monthly" ${h.cycleType==='monthly'?'selected':''}>Monthly</option>
                                <option value="quarterly" ${h.cycleType==='quarterly'?'selected':''}>Quarterly</option>
                                <option value="yearly" ${h.cycleType==='yearly'?'selected':''}>Yearly</option>
                            </select>
                            ${h.cycleType==='weeks' ? `<span style="font-size:12px;">every <input type="number" value="${h.cycleEvery||1}" min="1" max="52" style="width:40px;padding:4px;border:1px solid #eee;border-radius:6px;" onchange="window.updateField('${h.id}','cycleEvery',this.value)"> weeks</span>` : ''}
                            ${h.cycleNextDue ? `<span style="font-size:10px;color:#aaa;">${cycleDueLabel(h)}</span>` : ''}
                        </div>
                    </div>
                    <div style="margin-top:10px;padding-top:10px;border-top:1px solid #f5f5f5;">
                        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Streak Payouts</div>
                        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px;align-items:center;">
                            <label>🔥 Bonus $/streak&nbsp;<input type="number" step="0.05" value="${h.streakBonusPer||''}" placeholder="—" style="width:52px;padding:4px;border:1px solid #eee;border-radius:6px;" onchange="window.updateField('${h.id}','streakBonusPer',this.value)"></label>
                            <label>🌧️ Penalty $/streak&nbsp;<input type="number" step="0.05" value="${h.streakPenaltyPer||''}" placeholder="—" style="width:52px;padding:4px;border:1px solid #eee;border-radius:6px;" onchange="window.updateField('${h.id}','streakPenaltyPer',this.value)"></label>
                            <label>Cap $&nbsp;<input type="number" step="0.25" value="${h.streakCap||''}" placeholder="none" style="width:52px;padding:4px;border:1px solid #eee;border-radius:6px;" onchange="window.updateField('${h.id}','streakCap',this.value)"></label>
                        </div>
                        <div style="font-size:10px;color:#bbb;margin-top:4px;">e.g. $0.25/streak × streak 4 = $1.00 (capped at Cap $)</div>
                    </div>
                    <div style="margin-top:10px;">
                        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Definition / Rules</div>
                        <textarea placeholder="Describe exactly what counts for this habit…"
                            style="width:100%;padding:8px;border:1px solid #eee;border-radius:8px;font-family:'Montserrat';font-size:12px;resize:vertical;min-height:60px;box-sizing:border-box;"
                            onchange="window.updateField('${h.id}','note',this.value)">${h.note || ''}</textarea>
                    </div>
                    <button class="btn-delete" onclick="window.deleteTask('${h.id}')">DELETE TASK</button>
                </div>`;
        });

        // Build manage list items using allItemsForManage (includes cycle-inactive habits)
        if (manageVisible) {
            allItemsForManage.forEach(h => {
                manageListHtml += `<div class="msp-habit-row" onclick="window.showManageDetail('${h.id}')" id="msp-row-${h.id}"><span class="msp-drag-handle">⠿</span>${h.icon} <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h.name}</span>${h.bountyActive ? '<span style="font-size:10px;flex-shrink:0;margin-left:4px" title="Bounty active">🏆</span>' : ''}</div>`;
            });
            manageListHtml += `</div>`;
        }

        weekSectionHtml += `</div></div>`;
        weeklyHtml += weekSectionHtml;
    });

    uiState.lastActedId = null;

    animateMoneyDisplay(totalMoney);
    if (state.eventsLoaded) renderSeasonalSection();

    const slb = document.getElementById('sortLockBtn');
    if (slb) {
        slb.classList.toggle('sort-lock-on', uiState.sortLocked);
        slb.title = uiState.sortLocked ? 'Tasks stay in place (locked)' : 'Completed tasks move to bottom';
    }

    document.getElementById('countPunish').innerText = counts.punish;
    document.getElementById('countLow').innerText    = counts.low;
    document.getElementById('countGoal').innerText   = counts.goal;
    document.getElementById('countBonus').innerText  = counts.bonus;

    // Assign all HTML at once (instead of repeated += operations)
    todayRoot.innerHTML = todayHtml;
    priorityRoot.innerHTML = priorityHtml;
    weeklyRoot.innerHTML = weeklyHtml;
    if (manageVisible) {
        manageRoot.innerHTML = manageHtml;
        if (manageListRoot) {
            manageListRoot.innerHTML = manageListHtml;
            initManageSortable();
        }
    }
}

function initManageSortable() {
    if (typeof Sortable === 'undefined') return;
    document.querySelectorAll('[id^="msp-cat-"]').forEach(container => {
        if (container._sortable) container._sortable.destroy();
        container._sortable = new Sortable(container, {
            animation: 150,
            handle: '.msp-drag-handle',
            ghostClass: 'msp-row-ghost',
            onEnd() {
                const newOrder = [];
                document.querySelectorAll('[id^="msp-cat-"]').forEach(cat => {
                    cat.querySelectorAll('.msp-habit-row').forEach(row => {
                        const id = row.id.replace('msp-row-', '');
                        const h = uiState.habits.find(x => x.id === id);
                        if (h) newOrder.push(h);
                    });
                });
                uiState.habits = newOrder;
                syncHabits();
            }
        });
    });
}

// Debounce render() to batch multiple calls into one animation frame
let renderScheduled = false;
function debouncedRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
        render();
        renderScheduled = false;
    });
}
window.render = debouncedRender;

// ── Date strip ────────────────────────────────────────────────────────

export function buildDateStrip() {
    const strip       = document.getElementById('dateStrip');
    strip.innerHTML   = '';
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - getDayIdx(startOfWeek));
    for (let i = 0; i < 7; i++) {
        const d        = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        const isActive = d.toDateString() === uiState.viewingDate.toDateString();
        strip.innerHTML += `
            <div class="date-item ${isActive ? 'active' : ''}" onclick="window.setDate('${d.toISOString()}')">
                <div class="day-label">${d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</div>
                <div class="day-num">${d.getDate()}</div>
            </div>`;
    }
}

export function updateFiltersUI() {
    ['punish', 'low', 'goal', 'bonus'].forEach(t => {
        const el = document.getElementById('filter-' + t);
        if (el) el.classList.toggle('active-filter', uiState.activeFilter === t);
    });
}

// ── window.* navigation handlers ──────────────────────────────────────

window.setDate = (iso) => {
    uiState.viewingDate = new Date(iso);
    render();
};

window.toggleCol = (cat) => {
    const wasCollapsed = uiState.collapsed[cat] !== false;
    if (wasCollapsed) {
        const cats = [...new Set(uiState.habits.map(h => h.cat))];
        cats.forEach(c => { uiState.collapsed[c] = true; });
        uiState.collapsed[cat] = false;
        uiState.lastActiveCat  = cat;
    } else {
        uiState.collapsed[cat] = true;
        if (uiState.lastActiveCat === cat) uiState.lastActiveCat = null;
    }
    saveCollapsedState();
    render();
};

window.toggleFilter = (tier) => {
    uiState.activeFilter = (uiState.activeFilter === tier) ? null : tier;
    render();
};

window.toggleSortLock = () => {
    uiState.sortLocked = !uiState.sortLocked;
    localStorage.setItem('sortLocked', uiState.sortLocked ? '1' : '0');
    const btn = document.getElementById('sortLockBtn');
    if (btn) {
        btn.classList.toggle('sort-lock-on', uiState.sortLocked);
        btn.title = uiState.sortLocked ? 'Tasks stay in place (locked)' : 'Completed tasks move to bottom';
    }
    render();
};

window.togglePriorityMode = (mode) => {
    uiState.priorityMode = mode;
    localStorage.setItem('priorityMode', mode);
    document.querySelectorAll('.pmode-btn').forEach(b => {
        b.classList.toggle('pmode-active', b.dataset.mode === mode);
    });
    render();
};

window.toggleManageSection = (id) => {
    const body = document.getElementById('ms-' + id);
    const chv  = document.getElementById('msc-' + id);
    if (!body) return;
    const open = body.style.display === 'none';
    body.style.display = open ? '' : 'none';
    if (chv) chv.style.transform = open ? 'rotate(90deg)' : '';
};

window.switchTab = (idx) => {
    document.querySelectorAll('.tab').forEach((t, i)  => t.classList.toggle('active', i === idx));
    document.querySelectorAll('.view').forEach((v, i) => v.classList.toggle('active', i === idx));
    if (idx === 3) renderHistory(); else render();
};

window.handleManageClick = () => {
    const pw = prompt('Enter passcode:');
    if (pw === MANAGE_PASSCODE) {
        window.switchTab(3);
        setTimeout(() => {
            const panel = document.getElementById('managePanel');
            if (panel) {
                panel.style.display = 'block';
                panel.scrollIntoView({ behavior: 'smooth' });
                renderEventsManage();
                renderShopManage();
                window.render?.();
            }
        }, 80);
    }
};
