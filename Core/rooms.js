// ─────────────────────────────────────────────────────────────────────
// core/rooms.js
// Room-check system: weekly housekeeping tracker with streak bonuses.
// Each room earns a dollar bonus (streak+1, capped at maxStreak) when
// marked clean for the week.
// ─────────────────────────────────────────────────────────────────────

import { state } from './state.js';
import { readDoc, writeDoc, watchDoc } from './firebase.js';
import { FIRESTORE_DOCS, DEFAULT_ROOMS } from './config.js';

/**
 * Load rooms data from Firestore. Seeds DEFAULT_ROOMS on first use.
 */
export async function loadRoomsData() {
    try {
        const data = await readDoc(FIRESTORE_DOCS.ROOMS);
        if (data) {
            state.roomsData = data.rooms || [];
        } else {
            state.roomsData = DEFAULT_ROOMS.map(r => ({ ...r }));
            await syncRoomsData();
        }
        state.roomsLoaded = true;
    } catch (e) { console.error('loadRoomsData:', e); }
}

/**
 * Subscribe to live rooms_data updates so a "mark clean" from her phone
 * reflects on the desktop without a refresh. Re-renders on update.
 */
export function watchRoomsData() {
    return watchDoc(FIRESTORE_DOCS.ROOMS, (data) => {
        if (data) state.roomsData = data.rooms || [];
        state.roomsLoaded = true;
        window.render?.();
    });
}

/** Push current rooms state to Firestore. */
export async function syncRoomsData() {
    await writeDoc(FIRESTORE_DOCS.ROOMS, { rooms: state.roomsData });
}

/**
 * Toggle a room's checked state. Returns the updated room or null.
 */
export async function toggleRoomCheck(id) {
    const room = state.roomsData.find(r => r.id === id);
    if (!room) return null;
    room.checked = !room.checked;
    await syncRoomsData();
    return room;
}

/**
 * Sum of room payouts for all currently-checked rooms.
 * Each room earns Math.min(streak + 1, maxStreak) dollars.
 */
export function getRoomPayoutsTotal() {
    if (!state.roomsLoaded) return 0;
    return state.roomsData.reduce((sum, r) => {
        if (!r.checked) return sum;
        // Mirror the reset script's NaN-safe guards so a malformed room
        // never leaks NaN into the headline total.
        return sum + Math.min((r.streak || 0) + 1, r.maxStreak || 0);
    }, 0);
}
