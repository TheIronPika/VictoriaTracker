// ─────────────────────────────────────────────────────────────────────
// core/events.js
// Seasonal events: date-range based, auto-reset yearly.
// ─────────────────────────────────────────────────────────────────────

import { state, setSeasonalEvents } from './state.js';
import { readDoc, writeDoc } from './firebase.js';
import { FIRESTORE_DOCS, SEASON_META } from './config.js';

/**
 * Load events from Firestore into state.
 */
export async function loadSeasonalEvents() {
    try {
        const data = await readDoc(FIRESTORE_DOCS.EVENTS);
        setSeasonalEvents(data?.events || []);
        state.eventsLoaded = true;
    } catch (e) { console.error('loadSeasonalEvents:', e); }
}

/**
 * Push current events to Firestore.
 */
export async function syncEvents() {
    await writeDoc(FIRESTORE_DOCS.EVENTS, { events: state.seasonalEvents });
}

/**
 * Whether an event should be visible right now based on today's date.
 * Handles year-boundary wrap-around (e.g. Dec 15 – Feb 15).
 */
export function isEventActive(ev) {
    const today = new Date();
    const m = today.getMonth() + 1;
    const d = today.getDate();

    const start = ev.startMonth * 100 + ev.startDay;
    const end   = ev.endMonth   * 100 + ev.endDay;
    const now   = m * 100 + d;

    // Range may wrap across year boundary (e.g. Dec 15 – Feb 15).
    // Completed events stay visible (UI dims them) until the yearly auto-reset
    // baked into completeEvent — so the only thing that hides an event here
    // is the calendar window.
    return (start <= end)
        ? (now >= start && now <= end)
        : (now >= start || now <= end);
}

/**
 * Determine which season key an event belongs to, based on its start month.
 */
export function getEventSeason(ev) {
    for (const [key, meta] of Object.entries(SEASON_META)) {
        if (meta.months.includes(ev.startMonth)) return key;
    }
    return 'spring';
}

/**
 * Mark an event as completed +1. Auto-resets if it's a new year.
 * Returns the updated event, or null if cap reached.
 */
export async function completeEvent(id) {
    const ev = state.seasonalEvents.find(e => e.id === id);
    if (!ev) return null;
    const y = new Date().getFullYear();
    if ((ev.resetYear || 0) < y) {
        ev.completions = 0;
        // Yearly auto-reset also clears the paid-out marker so next year's
        // completions are payable from zero.
        ev.lastPaidCompletions = 0;
        ev.resetYear = y;
    }
    if (ev.completions >= ev.maxCompletions) return null;
    ev.completions++;
    ev.resetYear = y;
    await syncEvents();
    return ev;
}

/**
 * Decrement an event's completion count.
 */
export async function uncompleteEvent(id) {
    const ev = state.seasonalEvents.find(e => e.id === id);
    if (!ev || ev.completions <= 0) return null;
    ev.completions--;
    await syncEvents();
    return ev;
}

/**
 * Delete an event entirely.
 */
export async function deleteEvent(id) {
    setSeasonalEvents(state.seasonalEvents.filter(e => e.id !== id));
    await syncEvents();
}

/**
 * Add a new event. Validates required fields.
 */
export async function addEvent({
    name, icon = '🗓️', note = '',
    startMonth, startDay, endMonth, endDay,
    maxCompletions = 1, payout = 0
}) {
    if (!name) throw new Error('Event requires a name');
    const ev = {
        id: Date.now().toString(),
        name, icon, note,
        startMonth, startDay, endMonth, endDay,
        maxCompletions,
        completions: 0,
        lastPaidCompletions: 0,
        payout,
        resetYear: new Date().getFullYear()
    };
    state.seasonalEvents.push(ev);
    await syncEvents();
    return ev;
}

/**
 * Sum of *unpaid* event dollars right now — counts only completions that
 * haven't been paid out yet at a weekly reset. Mirrors how room payouts
 * work: shown live, paid (and cleared) on Monday.
 */
export function getEventPayoutsTotal() {
    if (!state.eventsLoaded) return 0;
    return (state.seasonalEvents || []).reduce((sum, ev) => {
        const unpaid = (ev.completions || 0) - (ev.lastPaidCompletions || 0);
        if (unpaid <= 0) return sum;
        return sum + unpaid * (ev.payout || 0);
    }, 0);
}
