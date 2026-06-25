// ─────────────────────────────────────────────────────────────────────
// web/ui/planning-ui.js
// The Planning tab: pre-fill the week ahead. A grid of habit rows × 7 day
// bubbles (tap to plan), day headers with calendar-density bars and
// free-day highlights, streak badges, conflict dots from the calendar,
// a "copy last week" shortcut, and the week agenda below. Tapping a task
// name opens a detail sheet with editable time estimate + day toggles.
// Pure intent — this view never touches habit.history.
// ─────────────────────────────────────────────────────────────────────

import { uiState } from './ui-state.js';
import { state } from '../../Core/state.js';
import { escapeHtml, weekDates } from '../../Core/utils.js';
import { computeStreaksFromHistory } from '../../Core/streaks.js';
import { isCycleDue } from '../../Core/cycles.js';
import { getTier } from '../../Core/habits.js';
import { syncHabits } from '../../Core/habits-data.js';
import {
    getPlannedDays, setPlannedDay, clearPlannedDays, copyPreviousWeek,
} from '../../Core/planning.js';
import { busyDays, eventCounts, eventsByDay } from '../../Core/calendar.js';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Module-local UI state (not Firebase data, stays out of Core state).
let openTaskId  = null;   // habit id of the open detail sheet, or null
let timeEditing = false;  // is the time-estimate input showing?
let agendaOpen  = true;   // agenda section expanded?

// ── helpers ───────────────────────────────────────────────────────────

function weekRangeLabel(date) {
    const d = weekDates(date);
    const first = d[0], last = d[6];
    const sameMonth = first.getMonth() === last.getMonth();
    const f = first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const l = last.toLocaleDateString('en-US', sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
    return `Week of ${f} – ${l}`;
}

function densityBarsHtml(count) {
    if (count <= 0) return '<div class="plan-density"></div>';
    const cls = count >= 3 ? 'verybusy' : 'busy';
    const n = Math.min(count, 2);
    let bars = '';
    for (let i = 0; i < n; i++) bars += `<div class="plan-dbar ${cls}"></div>`;
    return `<div class="plan-density">${bars}</div>`;
}

// ── main render ─────────────────────────────────────────────────────────

export function renderPlanning() {
    const root = document.getElementById('planningRoot');
    if (!root) return;

    const date   = uiState.viewingDate;
    const habits = (uiState.habits || []).filter(h => isCycleDue(h));
    const busy   = busyDays(date);
    const counts = eventCounts(date);

    // Day-header row
    let headCols = '';
    for (let i = 0; i < 7; i++) {
        const free = counts[i] === 0 ? 'free' : '';
        headCols += `
            <div class="plan-col">
                <div class="plan-dayhead ${free}">
                    <div class="plan-dayletter">${DAY_LETTERS[i]}</div>
                    ${densityBarsHtml(counts[i])}
                </div>
            </div>`;
    }

    // Task rows
    let rows = '';
    habits.forEach(h => {
        const planned = getPlannedDays(date, h.id);
        const streak  = computeStreaksFromHistory(state.weeklyHistory, h.id).streak;
        const dm      = h.dailyMax || 1;   // a planned day = doing it dailyMax times
        let bubbles = '';
        let planN = 0;  // running count of planned days → tier each bubble reaches
        for (let i = 0; i < 7; i++) {
            let planCls = '', tierStyle = '';
            if (planned[i]) {
                planN++;
                const tier = getTier(h, planN * dm);   // count in completions, like the Today bubbles
                planCls = 'planned';
                tierStyle = ` style="background:var(--grad-${tier});border-color:var(--color-${tier})"`;
            }
            const confCls = busy[i] ? 'conflict' : '';
            const dot     = busy[i] ? '<div class="plan-conflict-dot"></div>' : '';
            bubbles += `
                <div class="plan-col">
                    <div class="plan-bubble ${planCls} ${confCls}"${tierStyle} onclick="window.planToggle('${h.id}',${i})">${dot}</div>
                </div>`;
        }
        rows += `
            <div class="plan-row">
                <div class="plan-taskinfo" onclick="window.openPlanTask('${h.id}')">
                    <div class="plan-taskhead">
                        <span class="plan-emoji">${h.icon || '✨'}</span>
                        <span class="plan-name">${escapeHtml(h.name)}</span>
                        ${streak >= 1 ? `<span class="plan-streak">🔥 ${streak}</span>` : ''}
                    </div>
                    <div class="plan-goal">Goal: ${h.goal || 7}×/wk</div>
                </div>
                <div class="plan-bubbles">${bubbles}</div>
            </div>`;
    });

    const gridHtml = habits.length === 0
        ? `<div class="plan-empty">No habits to plan yet. Add some in Manage.</div>`
        : `<div class="plan-grid">
               <div class="plan-row plan-headrow">
                   <div class="plan-taskinfo"></div>
                   <div class="plan-bubbles">${headCols}</div>
               </div>
               ${rows}
           </div>`;

    root.innerHTML = `
        <div class="plan-week-label">${weekRangeLabel(date)}</div>
        <div class="plan-actionbar">
            <button class="plan-copy-btn" onclick="window.planCopyLastWeek()">📋 Copy last week's plan</button>
        </div>
        ${gridHtml}
        ${agendaHtml(date)}
    `;
}

// ── agenda ──────────────────────────────────────────────────────────────

function agendaHtml(date) {
    const byDay = eventsByDay(date);
    const dates = weekDates(date);
    const total = byDay.reduce((n, b) => n + b.length, 0);
    let body = '';
    if (total === 0) {
        body = `
            <div class="plan-agenda-empty">
                <div>No calendar events yet.</div>
            </div>`;
    } else {
        for (let i = 0; i < 7; i++) {
            const d = dates[i];
            const header = `${DAY_LABELS[i]}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
            const events = byDay[i];
            const evHtml = events.length === 0
                ? `<div class="plan-noevents">No events</div>`
                : events.map(ev => `
                    <div class="plan-event">
                        <div class="plan-event-time">${ev.timeLabel}</div>
                        <div class="plan-event-name">${escapeHtml(ev.title)}</div>
                    </div>`).join('');
            body += `<div class="plan-day-block"><div class="plan-day-header">${header}</div>${evHtml}</div>`;
        }
    }

    return `
        <div class="plan-agenda">
            <div class="plan-agenda-head" onclick="window.planAgendaToggle()">
                <span class="plan-agenda-title">📅 This week</span>
                <span class="plan-agenda-headright">
                    <span class="plan-agenda-toggle">${agendaOpen ? 'HIDE ✧' : 'SHOW ✦'}</span>
                </span>
            </div>
            ${agendaOpen ? `<div class="plan-agenda-body">${body}</div>` : ''}
        </div>`;
}

// ── detail sheet ────────────────────────────────────────────────────────

function renderPlanTaskModal() {
    const overlay = document.getElementById('planTaskOverlay');
    const bodyEl  = document.getElementById('planTaskBody');
    if (!overlay || !bodyEl) return;

    const h = (uiState.habits || []).find(x => x.id === openTaskId);
    if (!h) { closePlanTask(); return; }

    const date    = uiState.viewingDate;
    const planned = getPlannedDays(date, h.id);
    const busy    = busyDays(date);
    const byDay   = eventsByDay(date);
    const goal     = h.goal || 7;
    const dm       = h.dailyMax || 1;                    // a planned day = dailyMax completions
    const goalDays = Math.max(1, Math.ceil(goal / dm));  // days needed to hit goal
    const count    = planned.filter(Boolean).length;
    const streak   = computeStreaksFromHistory(state.weeklyHistory, h.id).streak;

    // Conflicts = events on days this habit is planned.
    const conflictLines = [];
    for (let i = 0; i < 7; i++) {
        if (planned[i] && byDay[i].length) {
            byDay[i].forEach(ev => conflictLines.push(`${DAY_LABELS[i]}: ${ev.timeLabel} ${escapeHtml(ev.title)}`));
        }
    }

    let dayBtns = '';
    for (let i = 0; i < 7; i++) {
        const sel  = planned[i] ? 'sel' : '';
        const bsy  = busy[i] ? 'busy' : '';
        dayBtns += `
            <button class="plan-daybtn ${sel} ${bsy}" onclick="window.planDayToggle('${h.id}',${i})">
                <span class="plan-daybtn-day">${DAY_LABELS[i]}</span>
                <span class="plan-daybtn-status">${busy[i] ? 'Busy' : 'Free'}</span>
            </button>`;
    }

    let steps = '';
    for (let i = 0; i < goalDays; i++) steps += `<div class="plan-step ${i < count ? 'done' : ''}"></div>`;

    const timeSection = timeEditing
        ? `<div class="plan-time-editrow">
               <input id="planTimeInput" class="plan-time-input" type="text" value="${escapeHtml(h.timeEstimate || '')}" placeholder="e.g. 30 min">
               <button class="plan-time-save" onclick="window.planSaveTime('${h.id}')">Save</button>
           </div>`
        : `<div class="plan-time-display" onclick="window.planEditTime()">
               <span>⏱️ ${h.timeEstimate ? escapeHtml(h.timeEstimate) : 'Add estimate'}</span>
               <span class="plan-time-edithint">Edit</span>
           </div>`;

    bodyEl.innerHTML = `
        <div class="plan-modal-head">
            <div class="plan-modal-titlewrap">
                <span class="plan-modal-emoji">${h.icon || '✨'}</span>
                <div>
                    <div class="plan-modal-title">${escapeHtml(h.name)}</div>
                    <div class="plan-modal-sub">Goal: ${goal}× per week${dm > 1 ? ` · ${dm}×/day` : ''}</div>
                </div>
            </div>
            <button class="plan-modal-close" onclick="window.closePlanTask()">×</button>
        </div>

        <div class="plan-time-box">
            <div class="plan-time-label">Time estimate</div>
            ${timeSection}
        </div>

        ${conflictLines.length ? `
            <div class="plan-banner">
                <div class="plan-banner-title">Calendar conflicts</div>
                ${conflictLines.map(l => `<div class="plan-banner-line">${l}</div>`).join('')}
            </div>` : ''}

        <div class="plan-section-label">Select days to plan</div>
        <div class="plan-daygrid">${dayBtns}</div>

        <div class="plan-progress">
            <div class="plan-progress-label">Weekly goal: ${count}/${goalDays} days</div>
            <div class="plan-progress-steps">${steps}</div>
        </div>

        ${streak >= 1 ? `<div class="plan-streak-stat">Streak: <span>🔥 ${streak} week${streak !== 1 ? 's' : ''}</span></div>` : ''}

        <div class="plan-modal-btns">
            <button class="plan-clear-btn" onclick="window.planClear('${h.id}')">Clear</button>
            <button class="plan-done-btn" onclick="window.closePlanTask()">Done</button>
        </div>`;

    overlay.style.display = 'flex';

    if (timeEditing) {
        const inp = document.getElementById('planTimeInput');
        if (inp) { inp.focus(); inp.select(); }
    }
}

function closePlanTask() {
    const overlay = document.getElementById('planTaskOverlay');
    if (overlay) overlay.style.display = 'none';
    openTaskId = null;
    timeEditing = false;
}

// ── window.* handlers ────────────────────────────────────────────────────

window.renderPlanning = renderPlanning;

window.planToggle = (habitId, dayIdx) => {
    setPlannedDay(uiState.viewingDate, habitId, dayIdx).catch(() => {});
    renderPlanning(); // state mutates synchronously before the sync await
};

window.openPlanTask = (habitId) => {
    openTaskId = habitId;
    timeEditing = false;
    renderPlanTaskModal();
};

window.closePlanTask = closePlanTask;

window.planDayToggle = (habitId, dayIdx) => {
    setPlannedDay(uiState.viewingDate, habitId, dayIdx).catch(() => {});
    renderPlanTaskModal();
    renderPlanning();
};

window.planClear = (habitId) => {
    clearPlannedDays(uiState.viewingDate, habitId).catch(() => {});
    renderPlanTaskModal();
    renderPlanning();
};

window.planCopyLastWeek = () => {
    copyPreviousWeek(uiState.viewingDate).then(copied => {
        if (copied) renderPlanning();
        else alert("There's no plan saved for last week yet.");
    }).catch(() => {});
};

window.planEditTime = () => {
    timeEditing = true;
    renderPlanTaskModal();
};

window.planSaveTime = (habitId) => {
    const inp = document.getElementById('planTimeInput');
    const h = (uiState.habits || []).find(x => x.id === habitId);
    if (h && inp) {
        const v = inp.value.trim();
        if (v) h.timeEstimate = v; else delete h.timeEstimate;
        syncHabits().catch(() => {});
    }
    timeEditing = false;
    renderPlanTaskModal();
    renderPlanning();
};

window.planAgendaToggle = () => {
    agendaOpen = !agendaOpen;
    renderPlanning();
};

