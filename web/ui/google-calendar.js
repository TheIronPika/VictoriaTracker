// ─────────────────────────────────────────────────────────────────────
// web/ui/google-calendar.js
// Browser Google Calendar (read-only) sync for the Planning agenda.
// Uses Google Identity Services (GIS) token flow — no client secret, no
// redirect page. On connect we fetch the primary calendar's events for a
// 4-week window and write them to the Firestore CALENDAR doc, so the
// agenda (which reads that doc) updates everywhere and survives reloads.
//
// Requires (in Google Cloud Console, on the OAuth client in config.js):
//   • client type "Web application"
//   • https://theironpika.github.io as an authorized JavaScript origin
//   • the "Google Calendar API" enabled in the project
// ─────────────────────────────────────────────────────────────────────

import { GOOGLE_CALENDAR_CONFIG } from '../../Core/config.js';
import { syncCalendarEvents } from '../../Core/calendar.js';
import { startOfWeek } from '../../Core/utils.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const FLAG_KEY = 'gcalConnected';

let gisPromise = null;
let tokenClient = null;

// Load the GIS script once.
function loadGis() {
    if (gisPromise) return gisPromise;
    gisPromise = new Promise((resolve, reject) => {
        if (window.google?.accounts?.oauth2) return resolve();
        const s = document.createElement('script');
        s.src = GIS_SRC;
        s.async = true;
        s.defer = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load Google sign-in.'));
        document.head.appendChild(s);
    });
    return gisPromise;
}

async function ensureTokenClient() {
    await loadGis();
    if (!tokenClient) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CALENDAR_CONFIG.clientId,
            scope: SCOPE,
            callback: () => {},   // replaced per request
        });
    }
    return tokenClient;
}

// Request an access token. prompt '' = silent (no UI) if already granted;
// 'consent' forces the account/consent popup.
function requestToken(prompt) {
    return new Promise((resolve, reject) => {
        ensureTokenClient().then(tc => {
            tc.callback = (resp) => {
                if (resp && resp.access_token) resolve(resp.access_token);
                else reject(resp || new Error('No access token returned.'));
            };
            tc.error_callback = (err) => reject(err);
            tc.requestAccessToken({ prompt });
        }).catch(reject);
    });
}

async function fetchEvents(token) {
    // Last week → three weeks out, so "copy last week" + the current and
    // next weeks all have calendar context.
    const start = startOfWeek(new Date());
    start.setDate(start.getDate() - 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 28);

    const url =
        'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
        `?timeMin=${encodeURIComponent(start.toISOString())}` +
        `&timeMax=${encodeURIComponent(end.toISOString())}` +
        '&singleEvents=true&orderBy=startTime&maxResults=250';

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Calendar API error ${res.status}`);
    const data = await res.json();

    return (data.items || []).map(it => ({
        id: it.id,
        title: it.summary || '(busy)',
        startISO: it.start?.dateTime || it.start?.date || null,
        endISO: it.end?.dateTime || it.end?.date || null,
        allDay: !!(it.start && it.start.date),
    })).filter(e => e.startISO);
}

async function sync(prompt) {
    if (!GOOGLE_CALENDAR_CONFIG.clientId) return;
    const token = await requestToken(prompt);
    const events = await fetchEvents(token);
    await syncCalendarEvents(events);
    localStorage.setItem(FLAG_KEY, '1');
    window.renderPlanning?.();
}

// Button entry point: try silent first, fall back to the consent popup.
window.connectGoogleCalendar = async () => {
    try {
        await sync('');
    } catch (_) {
        try {
            await sync('consent');
        } catch (e) {
            const msg = (e && (e.message || e.error || e.type)) || 'unknown error';
            alert(
                'Google Calendar sync failed: ' + msg + '\n\n' +
                'Check that the Calendar API is enabled and that this site is an ' +
                'authorized JavaScript origin on the OAuth client.'
            );
        }
    }
};

// Silent refresh on load if this device has connected before — keeps the
// agenda fresh without a click, and never pops UI (prompt '').
if (GOOGLE_CALENDAR_CONFIG.clientId && localStorage.getItem(FLAG_KEY)) {
    sync('').catch(() => {});
}
