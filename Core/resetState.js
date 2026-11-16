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

/** Local hour on Monday the approval prompt opens — what the propose cron was scheduled for. */
export const PROMPT_HOUR = 4;

/**
 * When the approval modal becomes visible, as epoch ms (0 = already), or
 * null while no reset is waiting. Snoozes push it later.
 *
 * The app opens the prompt itself at Monday PROMPT_HOUR local; it doesn't
 * wait for the GitHub propose cron. That cron is scheduled for 4am Central
 * but fires 10am–2pm or later (2026-11 runs), and until 2026-11-16 the app
 * only stepped in a full day late. So every Monday she sat pinned to Sunday
 * (effectiveDate) with no prompt until the late propose, and if she missed
 * the afternoon window the force cron closed the week at ~midnight Tuesday
 * without her. An early in-app approval is safe: scripts/reset.js propose
 * skips a week resetAlreadyHandledThisWeek() says is done, and force skips
 * anything not pendingReset.
 */
export function resetPromptDueAt(now = new Date()) {
    const rs = state.resetState || {};
    let at;
    if (rs.pendingReset) {
        at = 0;
    } else {
        if (!rs.lastWeeklyReset) return null;
        const last = new Date(rs.lastWeeklyReset);
        const weekStart = startOfWeek(now);
        if (isNaN(last.getTime()) || last >= weekStart) return null;
        at = weekStart.getTime() + PROMPT_HOUR * 3600000;
    }
    return Math.max(at, rs.snoozedUntil || 0);
}

/** Whether the approval modal should be visible right now. */
export function isResetPromptDue(now = new Date()) {
    const at = resetPromptDueAt(now);
    return at !== null && now.getTime() >= at;
}
