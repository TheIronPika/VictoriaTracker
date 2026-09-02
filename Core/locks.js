// ─────────────────────────────────────────────────────────────────────
// core/locks.js
// Task locks: a habit can be gated behind a SECONDARY task she has to
// confirm before its bubbles open up. Pure functions — no state, no io.
//
// Shape (all fields live on the habit doc, all optional):
//   lockEnabled     bool    — gate is switched on for this habit
//   lockTask        string  — what she's confirming ("Change the sheets")
//   lockEveryWeeks  int     — re-lock cadence in weekly resets (default 2)
//   locked          bool    — locked RIGHT NOW
//   lockWeeks       int     — resets counted since the last re-lock
//   lockConfirmedAt number  — ts of her last confirm (display/audit only)
//
// Deliberately NOT reusing the cyclic fields (cycleType/cycleNextDue): a
// cyclic habit goes DORMANT — hidden, unscored, no payout. A locked habit is
// still very much in play, it just can't be tapped yet. Overloading the two
// would have made "locked" silently suppress her payout.
// ─────────────────────────────────────────────────────────────────────

export const LOCK_DEFAULT_EVERY_WEEKS = 2;

/** Re-lock cadence in weekly resets. Always >= 1 so the counter terminates. */
export function lockEveryWeeks(h) {
    const n = parseInt(h && h.lockEveryWeeks, 10);
    return Number.isFinite(n) && n >= 1 ? n : LOCK_DEFAULT_EVERY_WEEKS;
}

/** Is the gate switched on for this habit at all? */
export function isLockGated(h) {
    return !!(h && h.lockEnabled);
}

/** Is this habit locked right now? False for every ungated habit. */
export function isLocked(h) {
    return isLockGated(h) && !!h.locked;
}

/** What she's being asked to confirm. Falls back to generic wording. */
export function lockTaskLabel(h) {
    const t = ((h && h.lockTask) || '').trim();
    return t || 'the required task';
}

/**
 * Fields that unlock the habit — she confirmed the secondary task.
 * Does NOT touch lockWeeks: the re-lock cadence runs on the weekly reset
 * clock, so confirming early doesn't buy her a longer unlocked stretch.
 */
export function confirmLockFields(now = Date.now()) {
    return { locked: false, lockConfirmedAt: now };
}

/**
 * Weekly-reset advance for one habit. Returns ONLY the lock fields to merge
 * (or an empty object for an ungated habit, so callers can spread blindly).
 *
 * Counts resets since the last re-lock and re-arms on the Nth:
 *   every=2, starting locked → locked wk1, open wk2, locked wk3, open wk4…
 * i.e. she faces the gate every other week. Re-locking an already-locked
 * habit is a no-op on `locked` but still rolls the counter, so skipping a
 * confirmation can't drift the cadence out of phase.
 */
export function advanceLockOnReset(h) {
    if (!isLockGated(h)) return {};
    const every = lockEveryWeeks(h);
    const weeks = (parseInt(h.lockWeeks, 10) || 0) + 1;
    if (weeks >= every) return { locked: true, lockWeeks: 0 };
    return { locked: h.locked === true, lockWeeks: weeks };
}
