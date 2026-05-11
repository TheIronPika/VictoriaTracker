// ─────────────────────────────────────────────────────────────────────
// web/ui/rooms-ui.js
// Room-check section: collapsible list with streak badges and payouts.
// ─────────────────────────────────────────────────────────────────────

import { state } from '../../Core/state.js';
import { loadRoomsData as coreLoadRoomsData, syncRoomsData, toggleRoomCheck as coreToggleRoomCheck } from '../../Core/rooms.js';
import { playBubblePop } from './animations.js';

export async function loadRoomsDataUI() {
    await coreLoadRoomsData();
    renderRoomsSection();
}

export function renderRoomsSection() {
    const root = document.getElementById('roomsRoot');
    if (!root) return;
    if (!state.roomsData.length) { root.innerHTML = ''; return; }

    const miniDots = state.roomsData.map(r =>
        `<div class="mini-dot" style="background:${r.checked ? 'var(--color-goal)' : 'rgba(0,0,0,0.1)'}"></div>`
    ).join('');

    let html = `
        <div class="category-header" onclick="window.toggleRoomsSection()" style="border:1.5px solid rgba(212,163,163,0.3);">
            <div style="flex:1;">
                <span class="cat-label">Room Check</span>
                <div class="status-mini-bar">${miniDots}</div>
            </div>
            <span style="color:var(--header-pink);font-size:12px;font-weight:bold;">${state.roomsCollapsed ? 'SHOW ✦' : 'HIDE ✧'}</span>
        </div>`;

    if (!state.roomsCollapsed) {
        state.roomsData.forEach(room => {
            const thisPayout = Math.min(room.streak + 1, room.maxStreak);
            html += `
                <div class="habit-card" style="${room.checked ? 'opacity:0.75;' : ''}">
                    <div style="font-size:24px;margin-right:14px;">${room.icon}</div>
                    <div style="flex:1;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                            <p style="margin:0;font-weight:600;">${room.name}</p>
                            ${room.streak > 0 ? `<span class="streak-badge">🏠 ${room.streak}wk</span>` : ''}
                            <span style="font-size:9px;color:#bbb;font-weight:600;">max ${room.maxStreak}wk</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;">
                            <button onclick="window.toggleRoomCheck('${room.id}')"
                                style="padding:6px 18px;border-radius:20px;border:none;font-size:12px;font-weight:700;cursor:pointer;font-family:'Montserrat',sans-serif;
                                background:${room.checked ? 'var(--color-goal)' : 'rgba(212,163,163,0.2)'};
                                color:${room.checked ? 'white' : '#888'};">
                                ${room.checked ? '✓ Clean' : 'Mark Clean'}
                            </button>
                            <span style="font-size:11px;font-weight:700;color:${room.checked ? 'var(--color-goal)' : '#bbb'};">
                                ${room.checked ? `+$${thisPayout.toFixed(2)} this week` : `next: +$${thisPayout.toFixed(2)}`}
                            </span>
                        </div>
                    </div>
                </div>`;
        });
    }
    root.innerHTML = html;
}

window.toggleRoomCheck = async (id) => {
    const room = await coreToggleRoomCheck(id);
    if (!room) return;
    playBubblePop(room.checked);
    renderRoomsSection();
    window.render?.();
};

window.toggleRoomsSection = () => {
    state.roomsCollapsed = !state.roomsCollapsed;
    localStorage.setItem('roomsCollapsed', String(state.roomsCollapsed));
    renderRoomsSection();
};
