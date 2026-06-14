// ─────────────────────────────────────────────────────────────────────
// core/calendar.js
// Calendar-events data layer for the Planning agenda + conflict dots.
// Events are Google-shaped: { id, title, startISO, endISO, allDay? }.
// Source today is the Firestore CALENDAR doc; Google Calendar sync writes
// into the same doc once enabled, so nothing downstream changes when it's
// turned on.
// ─────────────────────────────────────────────────────────────────────

import { state, setCalendarEvents } from './state.js';
import { writeDoc, watchDoc } from './firebase.js';
import { FIRESTORE_DOCS } from './config.js';
import { startOfWeek, getDayIdx, formatTime } from './utils.js';

/**
 * Subscribe to live calendar-event updates. Returns an unsubscribe function.
 */
export function watchCalendarEvents(callback) {
    return watchDoc(FIRESTORE_DOCS.CALENDAR, (data) => {
        setCalendarEvents(data.events || []);
        state.calendarLoaded = true;
        if (callback) callback(state.calendarEvents);
    });
}

/**
 * Overwrite the stored calendar events (used by the Google sync).
 */
export async function syncCalendarEvents(events) {
    setCalendarEvents(events);
    await writeDoc(FIRESTORE_DOCS.CALENDAR, { events: state.calendarEvents });
}

/**
 * Events that fall on the Mon..Sun week containing `date`, normalized for
 * display. Returns 7 buckets (index 0 = Mon .. 6 = Sun); each bucket is an
 * array of { id, title, start: Date, timeLabel, allDay } sorted by start.
 */
export function eventsByDay(date) {
    const start = startOfWeek(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);                  // exclusive Mon-next-week

    const buckets = [[], [], [], [], [], [], []];
    for (const ev of state.calendarEvents || []) {
        if (!ev || !ev.startISO) continue;
        const s = new Date(ev.startISO);
        if (isNaN(s.getTime()) || s < start || s >= end) continue;
        const idx = getDayIdx(s);
        buckets[idx].push({
            id: ev.id,
            title: ev.title || '(busy)',
            start: s,
            allDay: !!ev.allDay,
            timeLabel: ev.allDay ? 'All day' : formatTime(s),
        });
    }
    buckets.forEach(b => b.sort((a, b2) => a.start - b2.start));
    return buckets;
}

/**
 * Per-day busy flags (Mon..Sun) for the week containing `date`:
 * true when that day has at least one event. Drives the grid conflict dots.
 */
export function busyDays(date) {
    return eventsByDay(date).map(b => b.length > 0);
}

/**
 * Per-day event counts (Mon..Sun) for the density bars under day headers.
 */
export function eventCounts(date) {
    return eventsByDay(date).map(b => b.length);
}
