// ─────────────────────────────────────────────────────────────────────
// core/resetState.js
// Weekly-reset approval state (system/reset_state) for the in-app "last
// chance" prompt. pendingReset/pendingSince/lastWeeklyReset are written by
// weeklyReset.js (propose/execute, shared with the GitHub Action); this
// module owns reading that doc into state plus the snooze bookkeeping the
// approval modal itself drives.
//
// Native-only for now — Victoria approves from the app she actually uses
// day to day (see WeeklyResetModal.tsx). Not synced from the PWA's Core/.
// ─────────────────────────────────────────────────────────────────────

import { state, setResetState } from './state.js';
import { readDoc, writeDoc, watchDoc } from './firebase.js';
import { FIRESTORE_DOCS } from './config.js';
import { getDayIdx, startOfWeek } from './utils.js';

export const MAX_SNOOZES = 2;
export const SNOOZE_MS = 15 * 60 * 1000;

/** One-time load — safe to call multiple times. */
export async function loadResetState() {
    try {
        const data = await readDoc(FIRESTORE_DOCS.RESET);
        if (data) setResetState(data);
    } catch (e) { console.error('loadResetState:', e); }
    state.resetStateLoaded = true;
}

/**
 * Subscribe to live reset_state updates so the propose/force writes (and
 * her own approve/snooze taps from another device) show up without a
 * refresh. Re-renders on update. Returns the unsubscribe fn.
 */
export function watchResetState() {
    return watchDoc(FIRESTORE_DOCS.RESET, (data) => {
        setResetState(data);
        state.resetStateLoaded = true;
        window.render?.();
    });
}

/**
 * Hide the approval prompt for SNOOZE_MS so she can go touch up last
 * week's data, then it reappears. Returns false once she's used both
 * snoozes — the modal has no dismiss path after that, only Approve.
 */
export async function snoozeWeeklyReset() {
    const rs = state.resetState;
    if ((rs.snoozeCount || 0) >= MAX_SNOOZES) return false;
    const next = {
        snoozeCount:  (rs.snoozeCount || 0) + 1,
        snoozedUntil: Date.now() + SNOOZE_MS,
    };
    setResetState(next);
    await writeDoc(FIRESTORE_DOCS.RESET, { ...rs, ...next });
    return true;
}

/**
 * True while the current calendar week's reset hasn't EXECUTED yet — i.e.
 * the habit history arrays still hold last week's data. Covers both the
 * pendingReset approval window and the Monday-midnight → late-cron gap
 * where pendingReset hasn't even been proposed yet (GitHub schedule crons
 * run hours late) but the data week is still the old one.
 */
export function isResetOverdue(now = new Date()) {
    const rs = state.resetState || {};
    if (rs.pendingReset) return true;
    if (!rs.lastWeeklyReset) return false;
    const last = new Date(rs.lastWeeklyReset);
    return !isNaN(last.getTime()) && last < startOfWeek(now);
}

/**
 * The date the UI should treat as "today". Normally the real today; while
 * last week's reset is still un-executed, it's pinned to Sunday of that
 * pending week so the date strip / bubbles / water sync keep addressing
 * the data that's actually in the history arrays.
 */
export function effectiveDate(now = new Date()) {
    if (!isResetOverdue(now)) return now;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - getDayIdx(d) - 1); // Sunday of the pending week
    return d;
}

/**
 * Whether the approval modal should be visible right now. Normally just
 * "propose already fired and she isn't snoozed" — but if the Monday 4am
 * propose never fires at all (e.g. the GitHub Action is down) she'd
 * otherwise have no in-app way to close out the week: effectiveDate()
 * would keep pinning her to last week with nothing prompting her to act.
 * So once the data is overdue by more than a day with no pending flag,
 * surface the modal anyway as a fallback so Approve is reachable.
 */
export function isResetPromptDue(now = new Date()) {
    const rs = state.resetState || {};
    if (rs.snoozedUntil && Date.now() < rs.snoozedUntil) return false;
    if (rs.pendingReset) return true;
    if (!rs.lastWeeklyReset) return false;
    const last = new Date(rs.lastWeeklyReset);
    if (isNaN(last.getTime()) || last >= startOfWeek(now)) return false;
    const daysSinceWeekStart = (now.getTime() - startOfWeek(now).getTime()) / 86400000;
    return daysSinceWeekStart >= 1;
}
