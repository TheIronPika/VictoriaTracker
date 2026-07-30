// ─────────────────────────────────────────────────────────────────────
// web/ui/period-ui.js
// Period tracking UI: header pill modal, start/end handlers,
// history table in the Manage panel, delete history entries.
// ─────────────────────────────────────────────────────────────────────

import { state } from '../../Core/state.js';
import { uiState } from './ui-state.js';
import {
    isPeriodActive, periodDayCount, syncPeriodData, predictNextPeriod
} from '../../Core/period.js';
import { shortDate } from '../../Core/utils.js';

// Same calendar day? (ignores time-of-day)
function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth()    === b.getMonth()
        && a.getDate()     === b.getDate();
}

// ── Modal ─────────────────────────────────────────────────────────────

window.openPeriodModal = () => {
    document.getElementById('periodModalOverlay')?.remove();
    const isActive = isPeriodActive();
    const overlay  = document.createElement('div');
    overlay.id        = 'periodModalOverlay';
    overlay.className = 'period-modal-overlay';
    const days = periodDayCount();

    // Start day = the day selected in the top date strip (uiState.viewingDate).
    const sel          = uiState.viewingDate || new Date();
    const startIsToday = sameDay(sel, new Date());
    const dayLabel     = sel.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    const endIsToday = sameDay(sel, new Date());

    overlay.innerHTML = `
        <div class="period-modal-sheet">
            <div class="period-modal-title">${isActive ? (endIsToday ? '🩸 End period' : `🩸 End period on ${dayLabel}`) : (startIsToday ? '🩸 Start period' : `🩸 Start period on ${dayLabel}`)}</div>
            <div class="period-modal-sub">${isActive
                ? (endIsToday
                    ? `Period has been active for ${days} day${days !== 1 ? 's' : ''}. Marking it as ended will restore normal payout and streak rules going forward.`
                    : `Backdating the end to ${dayLabel}. Normal payout and streak rules will be restored from that day onward.`)
                : (startIsToday
                    ? "Period-sensitive habits will still earn positive payouts as normal, but won't be penalized or lose streaks while your period is active."
                    : `Backdating the start to ${dayLabel}. Period-sensitive habits won't be penalized or lose streaks from that day onward.`)
            }</div>
            <div class="period-modal-btns">
                <button class="period-modal-btn cancel" onclick="document.getElementById('periodModalOverlay').remove()">Cancel</button>
                ${isActive
                    ? `<button class="period-modal-btn end-btn" onclick="window.endPeriod()">End period</button>`
                    : `<button class="period-modal-btn confirm" onclick="window.startPeriod()">Start period</button>`
                }
            </div>
        </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};

window.startPeriod = async () => {
    document.getElementById('periodModalOverlay')?.remove();
    // dynamic import avoids a top-level circular dep if utils ever changes
    const { getDayIdx } = await import('../../Core/utils.js');
    // Backdate to the selected day in the date strip; keep the exact
    // timestamp when it's today so the day count stays precise.
    const sel     = uiState.viewingDate || new Date();
    const startTs = sameDay(sel, new Date()) ? Date.now() : sel.getTime();
    state.periodData = {
        active: true,
        startTs,
        startDayIdx: getDayIdx(new Date(startTs)),
        history: state.periodData.history || [],
        periodWasThisWeek: true
    };
    await syncPeriodData();
    window.render?.();
};

window.endPeriod = async () => {
    document.getElementById('periodModalOverlay')?.remove();
    if (state.periodData.active && state.periodData.startTs) {
        const sel    = uiState.viewingDate || new Date();
        const endTs  = sameDay(sel, new Date()) ? Date.now() : (() => {
            const d = new Date(sel);
            d.setHours(23, 59, 59, 999);
            return d.getTime();
        })();
        const duration = Math.ceil((endTs - state.periodData.startTs) / 86400000);
        const entry    = {
            id:        state.periodData.startTs.toString(),
            startTs:   state.periodData.startTs,
            endTs,
            duration,
            startDate: new Date(state.periodData.startTs).toLocaleDateString('en-US'),
            endDate:   new Date(endTs).toLocaleDateString('en-US')
        };
        const history = state.periodData.history || [];
        history.unshift(entry);
        state.periodData = { active: false, startTs: null, startDayIdx: null, history, periodWasThisWeek: true };
    } else {
        state.periodData = { active: false, startTs: null, startDayIdx: null, history: state.periodData.history || [], periodWasThisWeek: true };
    }
    await syncPeriodData();
    window.render?.();
};

window.deletePeriodEntry = async (entryId) => {
    if (!confirm('Delete this period entry?')) return;
    const history = (state.periodData.history || []).filter(e => e.id !== entryId);
    state.periodData = { ...state.periodData, history };
    await syncPeriodData();
    renderPeriodHistory();
};

// ── Clear all period data ────────────────────────────────────────────

window.clearPeriodWeekFlag = async () => {
    if (!confirm('Clear the period protection for this week? This will end any active period, remove pink bubbles and period protection from habits, and clear the period-was-this-week flag. Your period history log will not be changed.')) return;
    state.periodData = {
        ...state.periodData,
        active: false,
        startTs: null,
        startDayIdx: null,
        periodWasThisWeek: false
    };
    await syncPeriodData();
    renderPeriodHistory();
    window.render?.();
};

// ── History panel (Manage tab) ────────────────────────────────────────

// "Cycle Insights" headline + confidence badge, mirroring the native app's
// block in ManageContent.tsx so both read the same prediction the same way.
function renderCycleInsights(prediction, history, isActive) {
    const badge = prediction.confidence === 'estimate'
        ? { text: 'Estimate',        fg: '#1d7a43', bg: 'rgba(39,174,96,0.10)' }
        : prediction.confidence === 'low'
            ? { text: 'Low confidence', fg: '#d9534f', bg: 'rgba(217,83,79,0.12)' }
            : { text: 'Not enough data', fg: '#999',    bg: 'rgba(0,0,0,0.05)' };

    let body;
    if (prediction.confidence === 'none') {
        const need = Math.max(1, 2 - history.length);
        body = `<div style="font-size:12px;color:#bbb;line-height:1.5;">Log ${need} more period${need !== 1 ? 's' : ''} and a prediction shows up here automatically — needs at least two to measure a cycle length.</div>`;
    } else if (isActive) {
        const diff = Math.round((prediction.predictedTs - (state.periodData.startTs || 0)) / 86400000);
        const diffLabel = diff === 0 ? 'right on predicted schedule'
            : diff > 0 ? `${diff} day${diff > 1 ? 's' : ''} later than predicted`
                : `${-diff} day${-diff > 1 ? 's' : ''} earlier than predicted`;
        body = `<div style="font-size:20px;font-weight:500;color:#d9534f;">Started ${shortDate(state.periodData.startTs)}</div>
                <div style="font-size:11px;color:#999;margin-top:3px;">${diffLabel} (predicted ${shortDate(prediction.predictedTs)})</div>`;
    } else {
        const daysUntil = Math.round((prediction.predictedTs - Date.now()) / 86400000);
        const late = daysUntil < 0;
        const headline = daysUntil === 0 ? 'Expected today'
            : late ? `${-daysUntil} day${-daysUntil > 1 ? 's' : ''} late`
                : `In ${daysUntil} day${daysUntil > 1 ? 's' : ''}`;
        body = `<div style="font-size:20px;font-weight:500;color:${late ? '#d9534f' : '#1d7a43'};">${headline}</div>
                <div style="font-size:11px;color:#999;margin-top:3px;">Expected ${shortDate(prediction.predictedTs)} · based on last ${prediction.cyclesUsed + 1} cycles</div>`;
    }

    return `
        <div style="border-bottom:1px solid rgba(0,0,0,0.05);padding-bottom:14px;margin-bottom:16px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <div style="font-size:12px;color:#999;text-transform:uppercase;letter-spacing:0.5px;">Cycle Insights</div>
                <div style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;color:${badge.fg};background:${badge.bg};">${badge.text}</div>
            </div>
            ${body}
        </div>`;
}

export function renderPeriodHistory() {
    const root = document.getElementById('periodHistoryRoot');
    if (!root) return;

    const history = state.periodData.history || [];

    // Prediction comes from Core so this agrees with the native app to the
    // day — it averages the gaps between the last few START dates, which is
    // not the same as projecting forward from the last END date.
    const prediction      = predictNextPeriod();
    const hasPrediction   = prediction.confidence !== 'none';
    const avgCycleDays    = hasPrediction ? prediction.avgCycle : 0;
    const avgDurationDays = hasPrediction && prediction.avgDuration != null ? prediction.avgDuration : 0;
    const nextPeriodDate  = hasPrediction ? new Date(prediction.predictedTs) : null;
    const nextPeriodStr   = nextPeriodDate
        ? (nextPeriodDate.getMonth() + 1) + '/' + nextPeriodDate.getDate() + '/' + nextPeriodDate.getFullYear()
        : '--';

    const isActive = isPeriodActive();
    const insightsHtml = renderCycleInsights(prediction, history, isActive);
    let html = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
            <button onclick="window.clearPeriodWeekFlag()"
                style="background:none;border:1px solid rgba(217,83,79,0.3);color:#d9534f;border-radius:8px;padding:6px 14px;font-size:11px;font-weight:600;cursor:pointer;font-family:'Montserrat',sans-serif;letter-spacing:0.5px;">
                ✕ Clear this week's period flag
            </button>
        </div>
        ${isActive ? `<div style="background:rgba(217,83,79,0.08);border:1px solid rgba(217,83,79,0.2);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#d9534f;font-weight:600;">⚠ Period is currently active — this will end it and remove pink bubbles. History log is untouched.</div>` : ''}
        <div class="period-history-card" style="background:rgba(255,255,255,0.85);border-radius:16px;padding:18px;margin-bottom:14px;box-shadow:0 4px 15px rgba(0,0,0,0.04);">
            ${insightsHtml}
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:18px;">
                <div style="background:rgba(232,100,100,0.08);border-radius:8px;padding:1rem;">
                    <div style="font-size:12px;color:#999;margin-bottom:0.5rem;">Next period</div>
                    <div style="font-size:18px;font-weight:500;color:#d9534f;">${nextPeriodStr}</div>
                    ${avgCycleDays > 0 ? `<div style="font-size:11px;color:#bbb;margin-top:0.5rem;">${avgCycleDays} day cycle</div>` : ''}
                </div>
                <div style="background:rgba(232,100,100,0.08);border-radius:8px;padding:1rem;">
                    <div style="font-size:12px;color:#999;margin-bottom:0.5rem;">Avg cycle</div>
                    <div style="font-size:18px;font-weight:500;color:#d9534f;">${avgCycleDays || '--'} days</div>
                    <div style="font-size:11px;color:#bbb;margin-top:0.5rem;">from ${history.length} cycles</div>
                </div>
                <div style="background:rgba(232,100,100,0.08);border-radius:8px;padding:1rem;">
                    <div style="font-size:12px;color:#999;margin-bottom:0.5rem;">Avg duration</div>
                    <div style="font-size:18px;font-weight:500;color:#d9534f;">${avgDurationDays || '--'} days</div>
                    <div style="font-size:11px;color:#bbb;margin-top:0.5rem;">period length</div>
                </div>
                <div style="background:rgba(232,100,100,0.08);border-radius:8px;padding:1rem;">
                    <div style="font-size:12px;color:#999;margin-bottom:0.5rem;">Tracked</div>
                    <div style="font-size:18px;font-weight:500;color:#d9534f;">${history.length} cycles</div>
                    <div style="font-size:11px;color:#bbb;margin-top:0.5rem;">in history</div>
                </div>
            </div>

            ${history.length > 0 ? `
                <div style="border-top:1px solid rgba(0,0,0,0.05);padding-top:1rem;">
                    <div style="font-size:12px;color:#999;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.75rem;">Past periods</div>
                    <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
                        ${history.slice(0, 20).map(e => `
                            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(0,0,0,0.02);border-radius:6px;">
                                <div>
                                    <div style="font-weight:500;">${e.startDate} – ${e.endDate || '—'}</div>
                                    <div style="font-size:11px;color:#999;">${e.duration} day${e.duration !== 1 ? 's' : ''}</div>
                                </div>
                                <button onclick="window.deletePeriodEntry('${e.id}')" style="background:none;border:1px solid rgba(217,83,79,0.35);color:#d9534f;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700;padding:3px 10px;font-family:'Montserrat',sans-serif;">DEL</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : `
                <div style="text-align:center;padding:20px;color:#bbb;font-size:12px;">
                    No period history yet. Start tracking when you begin your next period.
                </div>
            `}
        </div>`;
    root.innerHTML = html;
}
