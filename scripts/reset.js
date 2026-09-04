// Victoria Tracker — Weekly Reset Script
// Runs via GitHub Actions twice a week: Monday 4am Central "propose" and
// Monday 7pm Central "force". Reads/writes Firebase over the REST API
// (no firebase-admin — authenticates with FIREBASE_API_KEY, not a service
// account).
//
// propose: flips system/reset_state.pendingReset so the native app can
//   show Victoria a "week's ready — approve or snooze" prompt. Makes no
//   other changes, so she has a last chance to touch up last week's data
//   before anything is paid out or wiped.
// force: if she never approved in the app, runs the actual reset anyway
//   so payouts/history can't stall indefinitely.
// approve (in the app): calls executeWeeklyReset directly from the client —
//   this script's "force" mode and that approval path share the exact same
//   Core/weeklyReset.js logic, just with different io adapters.
import fetch from 'node-fetch';

import { FIRESTORE_DOCS } from '../Core/config.js';
import { proposeWeeklyReset, executeWeeklyReset, resetAlreadyHandledThisWeek } from '../Core/weeklyReset.js';

// ── Firebase init (uses REST API key for Firestore access) ──────────────────
const PROJECT_ID  = process.env.FIREBASE_PROJECT_ID;
const API_KEY     = process.env.FIREBASE_API_KEY;
const BASE_URL    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function firestoreGet(path) {
    const res = await fetch(`${BASE_URL}/${path}?key=${API_KEY}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
}

async function firestoreSet(path, data) {
    const body = toFirestoreDoc(data);
    const res  = await fetch(`${BASE_URL}/${path}?key=${API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`SET ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
}

/**
 * Commit several whole-document overwrites atomically via the Firestore REST
 * :commit endpoint — the REST counterpart of the SDK's writeBatch(), and the
 * force-mode half of the weekly reset's all-or-nothing guarantee. Writes with
 * no updateMask replace the document, matching writeDoc / setDoc(merge:false).
 *
 * @param {Array<[string, object]>} entries  [['system/habits_list', data], ...]
 */
async function firestoreCommit(entries) {
    const writes = entries.map(([path, data]) => ({
        update: {
            name: `projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
            ...toFirestoreDoc(data)
        }
    }));
    const res = await fetch(`${BASE_URL}:commit?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes })
    });
    if (!res.ok) throw new Error(`COMMIT (${entries.length} writes) failed: ${res.status} ${await res.text()}`);
    return res.json();
}

// ── Firestore value converters ───────────────────────────────────────────────
function toFirestoreDoc(obj) {
    return { fields: toFields(obj) };
}

function toFields(obj) {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
        fields[k] = toValue(v);
    }
    return fields;
}

function toValue(v) {
    if (v === null || v === undefined)   return { nullValue: null };
    if (typeof v === 'boolean')          return { booleanValue: v };
    if (typeof v === 'number') {
        if (Number.isInteger(v))         return { integerValue: String(v) };
        return { doubleValue: v };
    }
    if (typeof v === 'string')           return { stringValue: v };
    if (Array.isArray(v))                return { arrayValue: { values: v.map(toValue) } };
    if (typeof v === 'object')           return { mapValue: { fields: toFields(v) } };
    return { stringValue: String(v) };
}

function fromValue(v) {
    if ('nullValue'    in v) return null;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue'  in v) return Number(v.doubleValue);
    if ('stringValue'  in v) return v.stringValue;
    if ('arrayValue'   in v) return (v.arrayValue.values || []).map(fromValue);
    if ('mapValue'     in v) {
        const obj = {};
        for (const [k, fv] of Object.entries(v.mapValue.fields || {})) {
            obj[k] = fromValue(fv);
        }
        return obj;
    }
    return null;
}

function fromDoc(doc) {
    if (!doc) return null;
    const obj = {};
    for (const [k, v] of Object.entries(doc.fields || {})) {
        obj[k] = fromValue(v);
    }
    return obj;
}

// io adapter — same readDoc/writeDoc/writeAll([col,id]) contract
// Core/firebase.js exposes in the browser, just backed by REST instead of the
// SDK. writeAll is what makes executeWeeklyReset atomic here too: without it
// the reset falls back to sequential writes and a mid-run failure can leave
// the week half-closed.
const io = {
    readDoc:  async ([col, id]) => fromDoc(await firestoreGet(`${col}/${id}`)),
    writeDoc: async ([col, id], data) => { await firestoreSet(`${col}/${id}`, data); },
    writeAll: async (entries) => {
        await firestoreCommit(entries.map(([[col, id], data]) => [`${col}/${id}`, data]));
    },
};

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const now  = new Date();
    const mode = process.env.RESET_MODE || 'propose';

    if (mode === 'propose') {
        if (await resetAlreadyHandledThisWeek(io, now) && process.env.FORCE_RESET !== '1') {
            console.log('⚠️  Reset already ran today. Skipping. (Set FORCE_RESET=1 to override.)');
            return;
        }
        const proposed = await proposeWeeklyReset(io, now);
        console.log(proposed
            ? '📋 Reset proposed — waiting on Victoria to approve in the app.'
            : '📋 A reset is already pending approval. Nothing to do.');
        return;
    }

    if (mode === 'force') {
        const rs = (await io.readDoc(FIRESTORE_DOCS.RESET)) || {};
        if (!rs.pendingReset) {
            console.log('ℹ️  No pending reset to force (already approved, or never proposed). Skipping.');
            return;
        }
        if (await resetAlreadyHandledThisWeek(io, now) && process.env.FORCE_RESET !== '1') {
            console.log('⚠️  Reset already ran today. Skipping. (Set FORCE_RESET=1 to override.)');
            return;
        }
        console.log('⏰ Grace window expired without approval — forcing the reset through.');
        await executeWeeklyReset(io, now);
        return;
    }

    throw new Error(`Unknown RESET_MODE: ${mode}`);
}

main().catch(err => {
    console.error('❌ Reset failed:', err);
    process.exit(1);
});
