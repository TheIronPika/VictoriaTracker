// ─────────────────────────────────────────────────────────────────────
// web/ui/events-ui.js
// Seasonal events: render functions and window.* handlers.
// ─────────────────────────────────────────────────────────────────────

import { uiState } from './ui-state.js';
import { state } from '../../Core/state.js';
import { SEASON_META } from '../../Core/config.js';
import {
    loadSeasonalEvents as coreLoadSeasonalEvents,
    isEventActive,
    completeEvent   as coreCompleteEvent,
    uncompleteEvent as coreUncompleteEvent,
    deleteEvent     as coreDeleteEvent,
    addEvent        as coreAddEvent
} from '../../Core/events.js';
import { playBubblePop } from './animations.js';

// ── Load ──────────────────────────────────────────────────────────────

export async function loadSeasonalEventsUI() {
    await coreLoadSeasonalEvents();
    renderSeasonalSection();
}

// ── Render ────────────────────────────────────────────────────────────

export function renderSeasonalSection() {
    const root = document.getElementById('seasonalRoot');
    if (!root) return;
    const active = state.seasonalEvents.filter(isEventActive);
    if (!active.length) { root.innerHTML = ''; return; }

    const miniDots = active.map(ev => {
        const done = ev.completions >= ev.maxCompletions;
        const meta = Object.values(SEASON_META).find(m => m.months.includes(ev.startMonth)) || SEASON_META.spring;
        return `<div class="mini-dot" style="background:${done ? meta.accent : 'rgba(0,0,0,0.1)'}"></div>`;
    }).join('');

    const _activeSeason = (() => {
        const m = new Date().getMonth() + 1;
        for (const [k, meta] of Object.entries(SEASON_META)) {
            if (meta.months.includes(m)) return meta;
        }
        return SEASON_META.spring;
    })();

    let html = `
        <div class="category-header" onclick="window.toggleSeasonalSection()"
             style="border:1.5px solid ${_activeSeason.border};background:${_activeSeason.bg};">
            <div style="flex:1">
                <span class="cat-label" style="color:${_activeSeason.accent};">Seasonal Events</span>
                <div class="status-mini-bar">${miniDots}</div>
            </div>
            <span style="color:${_activeSeason.accent}; font-size:12px; font-weight:bold;">
                ${uiState.seasonalCollapsed ? 'SHOW ✦' : 'HIDE ✧'}
            </span>
        </div>`;

    if (!uiState.seasonalCollapsed) {
        const bySeason = {};
        active.forEach(ev => {
            let season = 'spring';
            for (const [k, meta] of Object.entries(SEASON_META)) {
                if (meta.months.includes(ev.startMonth)) { season = k; break; }
            }
            if (!bySeason[season]) bySeason[season] = [];
            bySeason[season].push(ev);
        });

        for (const [season, evs] of Object.entries(bySeason)) {
            const meta = SEASON_META[season];
            evs.forEach(ev => {
                const done     = ev.completions >= ev.maxCompletions;
                const pips     = Array.from({ length: ev.maxCompletions }, (_, i) =>
                    `<div class="ev-pip ${i < ev.completions ? 'ev-pip-done' : ''}" style="${i < ev.completions ? 'background:'+meta.accent+';border-color:'+meta.accent : ''}"></div>`
                ).join('');
                const today2   = new Date();
                const endDate  = new Date(today2.getFullYear(), ev.endMonth - 1, ev.endDay);
                const daysLeft = Math.max(0, Math.ceil((endDate - today2) / 86400000));
                html += `
                    <div class="ev-card" style="background:${meta.bg};border-color:${meta.border};${done ? 'opacity:0.6;' : ''}"
                         ontouchstart="window.startLongPress('__ev__${ev.id}')"
                         ontouchend="window.cancelLongPress()"
                         ontouchmove="window.cancelLongPress()">
                        <div class="ev-card-top">
                            <span class="ev-icon">${ev.icon}</span>
                            <div class="ev-info">
                                <div class="ev-name">${ev.name}${done ? ' <span class="ev-done-badge">Done!</span>' : ''}</div>
                                <div class="ev-meta">${ev.completions}/${ev.maxCompletions} complete · ${daysLeft}d left · +$${ev.payout.toFixed(2)}/ea</div>
                            </div>
                            <div class="ev-actions">
                                ${!done ? `<button class="ev-btn-complete" style="background:${meta.accent}" onclick="window.completeEvent('${ev.id}')">+1</button>` : ''}
                                ${ev.completions > 0 ? `<button class="ev-btn-undo" onclick="window.uncompleteEvent('${ev.id}')">↩</button>` : ''}
                            </div>
                        </div>
                        <div class="ev-pips">${pips}</div>
                    </div>`;
            });
        }
    }
    root.innerHTML = html;
}

export function renderEventsManage() {
    const root = document.getElementById('eventsManageRoot');
    if (!root) return;
    if (!state.seasonalEvents.length) {
        root.innerHTML = '<div style="font-size:12px;color:#9d99b8;padding:8px 0;">No events yet.</div>';
        return;
    }
    root.innerHTML = state.seasonalEvents.map(ev => {
        const meta = Object.values(SEASON_META).find(m => m.months.includes(ev.startMonth)) || SEASON_META.spring;
        return `<div class="manage-card" style="border-left:3px solid ${meta.border};">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span style="font-size:18px;">${ev.icon}</span>
                <span style="font-family:'Great Vibes';font-size:20px;color:${meta.accent};flex:1;">${ev.name}</span>
                <button class="btn-delete" style="padding:4px 10px;font-size:9px;" onclick="window.deleteEvent('${ev.id}')">DELETE</button>
            </div>
            <div style="font-size:11px;color:#ccc8e0;">
                ${ev.startMonth}/${ev.startDay} – ${ev.endMonth}/${ev.endDay} &nbsp;·&nbsp;
                Max: ${ev.maxCompletions} &nbsp;·&nbsp;
                Done: ${ev.completions} &nbsp;·&nbsp;
                $${ev.payout.toFixed(2)}/ea
            </div>
            ${ev.note ? `<div style="font-size:11px;color:#9d99b8;margin-top:4px;">${ev.note}</div>` : ''}
        </div>`;
    }).join('');
}

// ── window.* handlers ─────────────────────────────────────────────────

window.completeEvent = async (id) => {
    const result = await coreCompleteEvent(id);
    if (!result) return;
    playBubblePop(true);
    renderSeasonalSection();
    renderEventsManage();
    window.render?.(); // headline includes unpaid event dollars now
};

window.uncompleteEvent = async (id) => {
    const result = await coreUncompleteEvent(id);
    if (!result) return;
    playBubblePop(false);
    renderSeasonalSection();
    renderEventsManage();
    window.render?.();
};

window.deleteEvent = async (id) => {
    if (!confirm('Delete this event?')) return;
    await coreDeleteEvent(id);
    renderSeasonalSection();
    renderEventsManage();
};

window.addEvent = async () => {
    const icon = document.getElementById('evIcon')?.value.trim()  || '🗓️';
    const name = document.getElementById('evName')?.value.trim();
    const sm   = parseInt(document.getElementById('evStartM')?.value) || 3;
    const sd   = parseInt(document.getElementById('evStartD')?.value) || 1;
    const em   = parseInt(document.getElementById('evEndM')?.value)   || 5;
    const ed   = parseInt(document.getElementById('evEndD')?.value)   || 31;
    const max  = parseInt(document.getElementById('evMax')?.value)    || 1;
    const pay  = parseFloat(document.getElementById('evPay')?.value)  || 5;
    const note = document.getElementById('evNote')?.value.trim()     || '';
    if (!name) { alert('Please enter an event name.'); return; }
    await coreAddEvent({ name, icon, note,
        startMonth: sm, startDay: sd, endMonth: em, endDay: ed,
        maxCompletions: max, payout: pay });
    ['evIcon','evName','evNote'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    renderSeasonalSection();
    renderEventsManage();
};

window.toggleSeasonalSection = () => {
    uiState.seasonalCollapsed = !uiState.seasonalCollapsed;
    localStorage.setItem('seasonalCollapsed', String(uiState.seasonalCollapsed));
    renderSeasonalSection();
};
