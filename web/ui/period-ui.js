// ─────────────────────────────────────────────────────────────────────
// web/ui/period-ui.js
// Period tracking UI: header pill modal, start/end handlers,
// history table in the Manage panel, delete history entries.
// ─────────────────────────────────────────────────────────────────────

import { state } from '../../Core/state.js';
import {
    isPeriodActive, periodDayCount, syncPeriodData
} from '../../Core/period.js';

// ── Modal ─────────────────────────────────────────────────────────────

window.openPeriodModal = () => {
    document.getElementById('periodModalOverlay')?.remove();
    const isActive = isPeriodActive();
    const overlay  = document.createElement('div');
    overlay.id        = 'periodModalOverlay';
    overlay.className = 'period-modal-overlay';
    const days = periodDayCount();
    overlay.innerHTML = `
        <div class="period-modal-sheet">
            <div class="period-modal-title">${isActive ? '🩸 End period' : '🩸 Start period'}</div>
            <div class="period-modal-sub">${isActive
                ? `Period has been active for ${days} day${days !== 1 ? 's' : ''}. Marking it as ended will restore normal payout and streak rules going forward.`
                : "Period-sensitive habits will still earn positive payouts as normal, but won't be penalized or lose streaks while your period is active."
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
    const now = Date.now();
    // dynamic import avoids a top-level circular dep if utils ever changes
    const { getDayIdx } = await import('../../Core/utils.js');
    state.periodData = {
        active: true,
        startTs: now,
        startDayIdx: getDayIdx(new Date()),
        history: state.periodData.history || [],
        periodWasThisWeek: true
    };
    await syncPeriodData();
    window.render?.();
};

window.endPeriod = async () => {
    document.getElementById('periodModalOverlay')?.remove();
    if (state.periodData.active && state.periodData.startTs) {
        const endTs    = Date.now();
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

export function renderPeriodHistory() {
    const root = document.getElementById('periodHistoryRoot');
    if (!root) return;

    const history = state.periodData.history || [];

    const avgCycleDays = history.length >= 2
        ? Math.round((history[0].startTs - history[history.length - 1].startTs) / ((history.length - 1) * 86400000))
        : 0;
    const avgDurationDays = history.length > 0
        ? Math.round(history.reduce((sum, e) => sum + e.duration, 0) / history.length * 10) / 10
        : 0;
    const nextPeriodTs   = history.length > 0 && avgCycleDays > 0
        ? history[0].endTs + (avgCycleDays * 86400000)
        : null;
    const nextPeriodDate = nextPeriodTs ? new Date(nextPeriodTs) : null;
    const nextPeriodStr  = nextPeriodDate
        ? (nextPeriodDate.getMonth() + 1) + '/' + nextPeriodDate.getDate() + '/' + nextPeriodDate.getFullYear()
        : '--';

    const isActive = isPeriodActive();
    let html = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
            <button onclick="window.clearPeriodWeekFlag()"
                style="background:none;border:1px solid rgba(217,83,79,0.3);color:#d9534f;border-radius:8px;padding:6px 14px;font-size:11px;font-weight:600;cursor:pointer;font-family:'Montserrat',sans-serif;letter-spacing:0.5px;">
                ✕ Clear this week's period flag
            </button>
        </div>
        ${isActive ? `<div style="background:rgba(217,83,79,0.08);border:1px solid rgba(217,83,79,0.2);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#d9534f;font-weight:600;">⚠ Period is currently active — this will end it and remove pink bubbles. History log is untouched.</div>` : ''}
        <div class="period-history-card" style="background:rgba(255,255,255,0.85);border-radius:16px;padding:18px;margin-bottom:14px;box-shadow:0 4px 15px rgba(0,0,0,0.04);">
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
