// ─────────────────────────────────────────────────────────────────────
// web/ui/render.js
// Main render loop and all navigation/toggle handlers.
// This is the only UI module that imports from other UI modules —
// it needs renderSeasonalSection (events) and renderHistory (history),
// plus renderEventsManage + renderShopManage for the Manage panel reveal.
// ─────────────────────────────────────────────────────────────────────

import { uiState, saveCollapsedState } from './ui-state.js';
import { state } from '../../Core/state.js';
import { getDayIdx, escapeHtml, startOfWeek } from '../../Core/utils.js';
import { effectiveDate } from '../../Core/resetState.js';
import { getTier, computeWeeklyPayout, toCumulative } from '../../Core/habits.js';
import { isCycleDue, isCyclic, cycleLabel, cycleDueLabel } from '../../Core/cycles.js';
import { computeStreaksFromHistory } from '../../Core/streaks.js';
import { MANAGE_PASSCODE, TIER_COLORS, WATER_CONFIG } from '../../Core/config.js';
import { animateMoneyDisplay } from './animations.js';
import { renderSeasonalSection, renderEventsManage } from './events-ui.js';
import { getEventPayoutsTotal } from '../../Core/events.js';
import { renderShopManage } from './shop-ui.js';
import { renderHistory, destroyHistoryCharts } from './history-ui.js';
import { isPeriodActive, periodDayCount, periodStartDayIdx } from '../../Core/period.js';
import { getRoomPayoutsTotal } from '../../Core/rooms.js';
import { renderPeriodHistory } from './period-ui.js';
import { renderRoomsSection } from './rooms-ui.js';
import { renderWaterCard } from './water-ui.js';
import { computeForecast } from './manage-ui.js';
import { currentCategoryResults, getCategoryPayoutsTotal } from '../../Core/category-config.js';
import { rewardIsEmpty, formatReward, TIER_LABEL as CAT_TIER_LABEL } from '../../Core/category-payouts.js';

/**
 * The category-payout line under a category header.
 * Returns '' for categories with nothing configured, so an untouched install
 * looks exactly as it did before this feature existed.
 *
 * Shows what the category is banking right now, then what the next rung is
 * worth and how many habits are holding it back:
 *   "📂 Goal +$5 ✨2 · 2 to go for Bonus +$10 ✨5"
 */
function buildCategoryLine(r) {
    if (!r || !r.tier) return '';                       // nothing counting this week
    const earning = !rewardIsEmpty(r.reward);
    const next    = !!r.nextTier;
    if (!earning && !next) return '';                   // category isn't configured

    const bits = [];
    if (earning) {
        bits.push(`<span class="cat-pay-now">${CAT_TIER_LABEL[r.tier]} ${formatReward(r.reward)}</span>`);
    }
    if (next) {
        const n = r.laggards.length;
        bits.push(`<span class="cat-pay-next">${n} to go for `
                + `${CAT_TIER_LABEL[r.nextTier]} ${formatReward(r.nextReward)}</span>`);
    }
    return `<div class="cat-payout-line">📂 ${bits.join(' · ')}</div>`;
}
import { syncHabits } from '../../Core/habits-data.js';
import { setHabits } from '../../Core/state.js';
import { resolveOrderedSections, SECTION_SEASONAL, SECTION_ROOMS } from '../../Core/section-order.js';

// ── Main render ───────────────────────────────────────────────────────

export function render() {
    // Keep viewingDate inside the EFFECTIVE week before anything reads it.
    // While last week's reset is still un-executed (Monday 00:00 → approval or
    // the 7pm force-run), habit.history still holds LAST week's per-day data,
    // so rendering against the real "today" would point the date strip and the
    // bubbles at the wrong week — and a tap would overwrite an unpaid day
    // before it is scored and snapshotted. Mirrors the native app's
    // useAppData effect: snap only when the WEEK differs, so a deliberate
    // same-week date-strip selection is never yanked away.
    const eff = effectiveDate();
    if (startOfWeek(uiState.viewingDate).getTime() !== startOfWeek(eff).getTime()) {
        uiState.viewingDate = eff;
    }
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

    const sectionsRoot = document.getElementById('sectionsRoot');
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

    // Build HTML strings instead of using += in loops (much faster).
    // categoryHtmlById is per-category Today markup so each can be inserted as
    // its own <div data-section-id="..."> child of sectionsRoot (lets Manage >
    // Layout interleave categories with the Seasonal and Room Check cards).
    const categoryHtmlById = new Map();
    let priorityHtml = '';
    let weeklyHtml = '';
    let manageHtml = '';
    let manageListHtml = '';

    let totalMoney = 0;
    let counts = { punish: 0, low: 0, goal: 0, bonus: 0 };

    const categories = [...new Set(uiState.habits.map(h => h.cat))];

    // Category-wide payout state for every category, computed once per render
    // from the same pure math the Monday reset uses (Core/category-payouts.js),
    // so the header line can never promise something the reset won't pay.
    const catResultsById = new Map(currentCategoryResults().map(r => [r.cat, r]));

    categories.forEach(cat => {
        const isCol = uiState.collapsed[cat] !== false;
        let items   = uiState.habits.filter(h => h.cat === cat && isCycleDue(h));
        // For manage panel: include ALL habits in this category, not just cycle-due
        let allItemsForManage = uiState.habits.filter(h => h.cat === cat);

        // Per-category Today markup — built into a local string, attached to
        // categoryHtmlById at the end of the loop.
        let todayHtml = '';

        // Recurring/cyclic habits (🔄 every-N-weeks/monthly/etc.) don't show up
        // daily, so they're easy to forget — pin them above the regular daily
        // habits unconditionally, even while the sort lock is on (the lock only
        // freezes the "done today sinks to the bottom" ordering within each group).
        items.sort((a, b) => {
            const aCyclic = isCyclic(a);
            const bCyclic = isCyclic(b);
            if (aCyclic !== bCyclic) return aCyclic ? -1 : 1;

            if (uiState.sortLocked) return 0;

            const aP = (toCumulative(a.history)[dIdx] || 0) > 0;
            const bP = (toCumulative(b.history)[dIdx] || 0) > 0;
            if (aP && !bP) return 1;
            if (!aP && bP) return -1;
            return 0;
        });

        const miniDotsHtml = items.map(h => {
            if (h.excused) return `<div class="mini-dot" style="background:#c8c8c8;opacity:0.5;"></div>`;
            const t = getTier(h, toCumulative(h.history)[dIdx] || 0);
            return `<div class="mini-dot" style="background:var(--grad-${t})"></div>`;
        }).join('');

        // Category payout line — only rendered for categories that actually
        // have a reward configured, so unconfigured ones look exactly as
        // before. Uses WEEK-TOTAL tiers (via Core), not the as-of-day
        // cumulative the mini-dots above use; mixing the two would show a
        // line that contradicts what pays out on Monday.
        const catRes = catResultsById.get(cat);
        const catLineHtml = buildCategoryLine(catRes);

        todayHtml += `
            <div class="category-header" onclick="window.toggleCol('${cat}')">
                <div style="flex:1">
                    <span class="cat-label">${escapeHtml(cat)}</span>
                    <div class="status-mini-bar">${miniDotsHtml}</div>
                    ${catLineHtml}
                </div>
                <span style="color:var(--header-pink); font-size:12px; font-weight:bold;">${isCol ? 'SHOW ✦' : 'HIDE ✧'}</span>
            </div>
        `;

        let weekSectionHtml = `
            <div class="weekly-cat-section">
                <h3 class="weekly-cat-label" style="font-family:'Playfair Display'; font-size:14px; margin: 20px 0 10px 5px; color:var(--header-pink); text-transform:uppercase; letter-spacing:1px;">${escapeHtml(cat)}</h3>
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
            manageCatHtml = `<div class="msp-cat-label msp-cat-toggle" onclick="window.toggleMspCat('${catId}')"><span>${escapeHtml(cat)}</span><span id="msp-chev-${catId}" style="transition:transform 0.2s;display:inline-block;${isCatCollapsed ? 'transform:rotate(-90deg)' : ''}">&#9662;</span></div><div id="msp-cat-${catId}" style="${isCatCollapsed ? 'display:none' : ''}">`;
            manageListHtml += manageCatHtml;
        }

        items.forEach(h => {
            // Single source of truth — see Core/habits.js computeWeeklyPayout.
            // Bounty, cyclic late-reduction, period protection, etc. all live
            // there; we just consume the resulting total.
            const result = computeWeeklyPayout(h, { periodActive: isPeriodActive() });
            const { tier, total: payout, weeksLate: wkLate } = result;
            if (!h.excused) {
                totalMoney += payout;
                if (tier === 'punish' && h.valPunish < 0) { counts.punish++; }
                else if (tier !== 'punish') { counts[tier]++; }
            }
            // history stores PER-DAY counts; derive the cumulative view the
            // bubble UI renders so the display is byte-for-byte unchanged.
            const cum = toCumulative(h.history);
            const cur = cum[dIdx] || 0;

            const daysRemaining = 7 - dIdx;
            const modeThresh    = uiState.priorityMode === 'bonus' ? h.bonus : h.goal;
            const possible      = daysRemaining * (h.dailyMax || 1);
            const isUrgent      = !h.excused && (modeThresh - cur) >= possible && (modeThresh - cur) > 0;
            const isArriving    = h.id === uiState.lastActedId;

            // Cache streak computation (called twice per habit otherwise)
            const streaks = computeStreaksFromHistory(state.weeklyHistory, h.id, { badStreakResetTs: h.badStreakResetTs });
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

            // Star value badge — tap reveals which tiers pay stars on this
            // habit. Mirrors core/habits.js getStarsEarned()'s own thresholds
            // (goal tier, bonus tier, 2+ week streak) so it never drifts from
            // what actually gets paid on reset. Deliberately NOT on long-press
            // — that already opens the edit modal (window.startLongPress).
            const starGoal      = h.starGoal   || 0;
            const starBonus     = h.starBonus  || 0;
            const starStreak    = h.starStreak || 0;
            const hasStarValue  = starGoal > 0 || starBonus > 0 || starStreak > 0;
            const starBadgeSpan = hasStarValue
                ? `<span class="star-badge" onclick="event.stopPropagation();document.getElementById('star-${h.id}').classList.toggle('show')">⭐</span>`
                : '';
            const starDetailDiv = hasStarValue
                ? `<div class="star-detail" id="star-${h.id}">
                       ${starGoal   > 0 ? `<div class="star-detail-row"><span>Goal</span><span>+${starGoal} ⭐</span></div>` : ''}
                       ${starBonus  > 0 ? `<div class="star-detail-row"><span>Bonus</span><span>+${starBonus} ⭐</span></div>` : ''}
                       ${starStreak > 0 ? `<div class="star-detail-row"><span>2+ week streak</span><span>+${starStreak} ⭐</span></div>` : ''}
                   </div>`
                : '';

            const periodProtectedCard = isPeriodActive() && !!h.periodSensitive;
            const pStartIdx = periodStartDayIdx(getDayIdx);

            function hexToRgba(hex, alpha) {
                const n = parseInt(hex.slice(1), 16);
                return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
            }
            const _DS = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'];
            function dayForBubble(hist, i, fromIdx = 0) {
                for (let d = fromIdx; d < 7; d++) { if ((hist[d] || 0) >= i) return _DS[d]; }
                return '';
            }
            const markOffCount = h.markOffDays?.[dIdx] || 0;
            const realCount    = Math.max(0, cur - markOffCount);
            const todayIdx     = getDayIdx(effectiveDate());
            // How far a later REAL day (already happened, up through today) has
            // reached, so backdating shows those bubbles as already-claimed
            // (dashed) instead of empty. Bounded at todayIdx — days after today
            // are just a placeholder mirror of today, not marks she's actually
            // earned, so they never get a dashed indicator.
            const futureFloor = Math.max(0, ...cum.slice(dIdx + 1, todayIdx + 1));
            // A day after today has no independent identity yet (it just
            // mirrors today), so editing it would silently redirect to
            // today with no visual cue — confusing (see feedback
            // 2026-07-21). Lock those days from editing instead.
            const isFutureDay = dIdx > todayIdx;
            // The water tracker's linked habit is forward-filled by
            // Core/water.js, so its bubbles are a read-out, not a control —
            // drop the tap affordance (habits-ui.js also refuses the write).
            const isSystemDriven = h.id === WATER_CONFIG.linkedHabitId;
            let bubblesHtml = '';
            for (let i = 1; i <= (h.max || 7); i++) {
                const stepTier   = getTier(h, i);
                const isFilled   = i <= cur;
                const isSynthetic = isFilled && i > realCount;
                const isFuture   = !isFilled && i <= futureFloor;
                // Which day each completion actually belongs to — the
                // delta-shift mutation keeps every day's own contribution
                // distinct, so this correctly attributes bubble N to
                // whichever day the running total first reached N (e.g.
                // bubble 1 = Monday, bubble 2 = Tuesday, if that's the day
                // each one was really added on).
                const dayLetter  = isFilled ? dayForBubble(cum, i)
                                 : isFuture ? dayForBubble(cum, i, dIdx + 1)
                                 : '';
                const isPaused   = !isFilled && !isFuture && (isPeriodActive() || state.periodData.periodWasThisWeek) && !!h.periodSensitive && dIdx >= pStartIdx;
                const bubbleClass = `bubble day-bub ${isFilled ? ('filled ' + (isSynthetic ? 'mark-off' : stepTier)) : ''} ${isFuture ? 'future' : ''} ${isPaused ? 'period-paused' : ''}`;
                const borderColor = isSynthetic ? '#aaa' : `var(--color-${stepTier})`;
                const extraStyle  = isFuture ? `background:${hexToRgba(TIER_COLORS[stepTier], 0.15)};color:${TIER_COLORS[stepTier]};` : '';
                const onclickAttr = (isFutureDay || isSystemDriven) ? '' : `onclick="window.toggleBubble('${h.id}',${i})"`;
                bubblesHtml += `<div class="${bubbleClass}"
                    style="border-color:${borderColor};${extraStyle}"
                    ${onclickAttr}>${dayLetter}</div>`;
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
                        ${h.excused ? '<span class="excused-tag">✦ Resting this week</span>' : ''}
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            <p style="margin:0; font-weight:600;">${escapeHtml(h.name)}</p>
                            ${streaks.streak >= 1 ? `<span class="streak-badge">🔥 ${streaks.streak}</span>` : ''}
                            ${streaks.badStreak >= 1 ? `<span class="bad-streak-badge" onclick="event.stopPropagation();window.resetBadStreak('${h.id}')" style="cursor:pointer" title="Click to use a Fresh Start">🌧️ ${streaks.badStreak}</span>` : ''}
                            ${cycleLabel(h) ? `<span class="cycle-badge">🔄 ${cycleLabel(h)}</span>` : ''}
                            ${wkLate > 0 ? `<span class="cycle-badge" style="background:rgba(217,83,79,0.15);color:#d9534f;border-color:rgba(217,83,79,0.3);" title="Late completion will reduce payout">⏰ ${wkLate}w late</span>` : ''}
                            ${h.bountyActive ? `<span class="bounty-badge">🏆 Bounty</span>` : ''}
                            ${starBadgeSpan}
                            ${forecastBadgeSpan}
                            ${(h.excused || state.excuseTokens > 0) ? `<button class="excuse-btn ${h.excused ? 'excuse-on' : ''}" onclick="event.stopPropagation();window.toggleExcused('${h.id}')">${h.excused ? 'Undo Rest Week' : 'Rest Week'}</button>` : ''}
                            ${(!isFutureDay && !isSystemDriven && state.markOffTokens > 0) ? `<button class="mark-btn" onclick="event.stopPropagation();window.useMarkOffBubble('${h.id}')" title="Use a Day Pass to mark one bubble for today">🎫 +1</button>` : ''}
                        </div>
                        ${forecastDetailDiv}
                        ${starDetailDiv}
                        <div class="bubbles" style="${isFutureDay ? 'opacity:0.45;pointer-events:none;' : ''}">${bubblesHtml}</div>
                    </div>
                </div>`;

            if (!isCol) {
                if (!uiState.activeFilter)                             todayHtml += cardHtml;
                else if (uiState.activeFilter === 'punish' && tier === 'punish' && h.valPunish < 0)
                                                                        todayHtml += cardHtml;
                else if (uiState.activeFilter === tier)                todayHtml += cardHtml;
            }

            if (isUrgent) priorityHtml += cardHtml;

            const weeklyDotsHtml = h.history.slice(0, 7).map((c, i) => {
                // c is this day's own count; color by the cumulative tier
                // reached through this day (unchanged look).
                const dayTier = getTier(h, cum[i]);
                return c > 0
                    ? `<div class="weekly-dot-container"><div class="weekly-dot" style="background:var(--grad-${dayTier})"></div></div>`
                    : `<div class="weekly-dot-container"><div class="weekly-dot" style="background:#eee"></div></div>`;
            }).join('');

            // Surface excused / period-protected status in the Weekly row so
            // it doesn't read as "she failed" when she was actually excused or
            // protected. Pills mirror the badges on the Today card.
            const wkExcused        = !!h.excused;
            const wkPeriodProtected = isPeriodActive() && !!h.periodSensitive;
            const wkFlagClasses    = (wkExcused ? ' is-excused' : '') + (wkPeriodProtected ? ' is-period-protected' : '');
            const wkFlagPills      =
                (wkExcused        ? '<span class="flag-pill excused">✦ Resting</span>'   : '') +
                (wkPeriodProtected ? '<span class="flag-pill period">🩸 Protected</span>' : '');

            weekSectionHtml += `
                <div class="weekly-row${wkFlagClasses}">
                    <span class="weekly-task-name">${escapeHtml(h.name)}${wkFlagPills}</span>
                    <div class="weekly-dots-row">${weeklyDotsHtml}</div>
                </div>`;

            manageHtml += `
                <div class="manage-card">
                    <h4 class="beloved-small" style="font-family:'Great Vibes'; font-size:24px; color:var(--header-pink); margin:0 0 10px 0;">${h.icon} ${escapeHtml(h.name)}</h4>
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
                        <div style="font-size:10px;color:#bbb;margin-top:4px;">Flat per week — every good week adds Bonus $, every bad week subtracts Penalty $. Cap $ limits the per-week amount.</div>
                    </div>
                    <div style="margin-top:10px;">
                        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Definition / Rules</div>
                        <textarea placeholder="Describe exactly what counts for this habit…"
                            style="width:100%;padding:8px;border:1px solid #eee;border-radius:8px;font-family:'Montserrat';font-size:12px;resize:vertical;min-height:60px;box-sizing:border-box;"
                            onchange="window.updateField('${h.id}','note',this.value)">${escapeHtml(h.note || '')}</textarea>
                    </div>
                    <button class="btn-delete" onclick="window.deleteTask('${h.id}')">DELETE TASK</button>
                </div>`;
        });

        // Build manage list items using allItemsForManage (includes cycle-inactive habits)
        if (manageVisible) {
            allItemsForManage.forEach(h => {
                const _cycleTag = (!h.cycleType || h.cycleType === 'none') ? ''
                    : h.cycleType === 'yearly'
                        ? `<span style="font-size:10px;flex-shrink:0;margin-left:4px" title="Seasonal (Yearly)">🌸</span>`
                        : `<span style="font-size:10px;flex-shrink:0;margin-left:4px" title="${cycleLabel(h)}">🔄</span>`;
                manageListHtml += `<div class="msp-habit-row" onclick="window.showManageDetail('${h.id}')" id="msp-row-${h.id}"><span class="msp-drag-handle">⠿</span>${h.icon} <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(h.name)}</span>${_cycleTag}${h.bountyActive ? '<span style="font-size:10px;flex-shrink:0;margin-left:4px" title="Bounty active">🏆</span>' : ''}</div>`;
            });
            manageListHtml += `</div>`;
        }

        weekSectionHtml += `</div></div>`;
        weeklyHtml += weekSectionHtml;
        categoryHtmlById.set(cat, todayHtml);
    });

    uiState.lastActedId = null;

    // Include room + event + category payouts in the headline — the reset pays
    // them out Monday and the Streak $ panel + email report both count them, so
    // the live header should match. (Review M1 + M2.)
    totalMoney += getRoomPayoutsTotal();
    totalMoney += getEventPayoutsTotal();
    totalMoney += getCategoryPayoutsTotal();
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
    renderWaterCard();
    renderTodaySections(sectionsRoot, categoryHtmlById);
    priorityRoot.innerHTML = priorityHtml;
    weeklyRoot.innerHTML = weeklyHtml;
    if (manageVisible) {
        manageRoot.innerHTML = manageHtml;
        if (manageListRoot) {
            manageListRoot.innerHTML = manageListHtml;
            initManageSortable();
        }
    }
    // Refresh the Layout panel if it's open (a new category may have appeared).
    window.renderSectionOrderManage?.();
}

// ── Today section ordering ────────────────────────────────────────────
//
// sectionsRoot owns three kinds of children:
//   • seasonalRoot  (data-section-id="__seasonal__") — written by events-ui
//   • roomsRoot     (data-section-id="__rooms__")    — written by rooms-ui
//   • per-category divs (data-section-id="<cat name>") — rebuilt here every render
//
// We wipe just the per-category divs, recreate them from categoryHtmlById,
// then walk the resolved order and appendChild so all three kinds end up in
// the user's chosen sequence. The special cards keep their own innerHTML
// across renders (they have their own render functions and listeners).
function renderTodaySections(sectionsRoot, categoryHtmlById) {
    if (!sectionsRoot) return;

    // Remove stale category divs (leave the special cards alone).
    sectionsRoot.querySelectorAll('[data-section-type="category"]').forEach(n => n.remove());

    // Append new category divs (order here is the natural habits-array order;
    // resolveOrderedSections below will sort everything into the final order).
    for (const [cat, html] of categoryHtmlById) {
        const div = document.createElement('div');
        div.dataset.sectionType = 'category';
        div.dataset.sectionId   = cat;
        div.innerHTML = html;
        sectionsRoot.appendChild(div);
    }

    // Apply the user's chosen order.
    // availableIds is in the *default* layout (Seasonal → categories → Rooms)
    // so a fresh install with no stored order matches the pre-feature look.
    const availableIds = [
        SECTION_SEASONAL,
        ...categoryHtmlById.keys(),
        SECTION_ROOMS,
    ];
    const ordered = resolveOrderedSections(availableIds);
    for (const id of ordered) {
        const node = sectionsRoot.querySelector(`[data-section-id="${cssEscape(id)}"]`);
        if (node) sectionsRoot.appendChild(node); // appendChild on an existing child moves it
    }
}

// CSS.escape polyfill — category names can contain spaces or punctuation
// that break attribute selectors otherwise.
function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
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
                // Update state.habits too — syncHabits() serializes state,
                // not uiState. Reassigning only uiState would let the reorder
                // snap back on the next Firestore snapshot.
                setHabits(newOrder);
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
    // effectiveDate(), not new Date() — during the pending-reset window the
    // strip must show the week the history arrays actually hold. Named
    // weekStart so it doesn't shadow the imported startOfWeek() helper.
    const weekStart = effectiveDate();
    weekStart.setDate(weekStart.getDate() - getDayIdx(weekStart));
    for (let i = 0; i < 7; i++) {
        const d        = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
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
    if (idx === 3)      renderHistory();
    else if (idx === 2) {
        // Weekly tab: render whichever sub-tab is active.
        render();
        if (_weeklySub === 'plan') window.renderPlanning?.();
    }
    else render();
};

// ── Weekly sub-tab (Overview vs. Plan) ────────────────────────────────
// The Plan view was originally a top-level tab but didn't fit the bar.
// It now lives inside Weekly as a sub-toggle, mirroring the Priorities tab's
// Goal/Bonus pmode-toggle styling so it reads as the same kind of control.
let _weeklySub = 'overview';
window.switchWeeklySub = (which) => {
    _weeklySub = which === 'plan' ? 'plan' : 'overview';
    document.querySelectorAll('#weeklySubTabs .pmode-btn').forEach(b => {
        b.classList.toggle('pmode-active', b.dataset.weeklySub === _weeklySub);
    });
    const weeklyRoot   = document.getElementById('weeklyRoot');
    const planningRoot = document.getElementById('planningRoot');
    if (weeklyRoot)   weeklyRoot.style.display   = (_weeklySub === 'overview') ? '' : 'none';
    if (planningRoot) planningRoot.style.display = (_weeklySub === 'plan')     ? '' : 'none';
    if (_weeklySub === 'plan') window.renderPlanning?.();
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
