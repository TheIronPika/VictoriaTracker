# VictoriaTracker (PWA) — Full Code Review (2026-09-03)

**Reviewed:** the whole repo — `index.html` (2011 lines), all 17 `web/ui/*.js`, `sw.js`,
`scripts/reset.js`, `manifest.json`, and the shared `Core/`. Companion to
`VictoriaTracker-Native/code-review/2026-09-03-native.md`; read that one first for the
shared-`Core/` findings.

**`Core/` is genuinely in lockstep.** A file-by-file diff against
`VictoriaTracker-Native/core/` shows **21 of 23 files byte-identical**, and the only two
that differ are exactly the two documented patches `sync-core-from-pwa.mjs` applies
(`config.js` OAuth `clientId`, `state.js` `roomsCollapsed` localStorage read). The
two-way reconciliation from 2026-07-30 held. That's a real achievement and it means the
sync script is safe to run again.

**The problems are all in the web layer and the shipping path**, and two of them are
serious enough that they may already be affecting Victoria.

---

## Fix first

### 1. 🔴 The service worker hasn't been bumped since August 7 — every September commit is invisible

`sw.js` still reads `const CACHE = 'victoria-v40'`, and its last commit is **89df430
(2026-08-07)**. Everything since has shipped without a cache bump:

```
71487b0  Rest weeks no longer break habit streaks
28d6505  Add 🔒 task locks
3c47baa  Task lock: lock the bubbles, not the habit icon
81548a6  Task lock: plainer confirm copy
50fab8d  History: collapse Past Weeks to the latest two
74512b5  Trim habit name + category at the data layer
```

The fetch handler is **cache-first for every shell file, including `index.html`**, and
`activate` only deletes caches whose key `!== CACHE` — so an unchanged `CACHE` purges
nothing. A browser that installed v40 keeps serving the August 7 modules indefinitely.
Worse, because `sw.js` is itself byte-identical, the browser never detects an updated
worker, so the `skipWaiting()` in `install` never runs either.

Net effect: **five commits of work are almost certainly not live on any device that
already had the app installed.** This is the "SW cache masks deploys" gotcha, and the fix
is procedural — bump `CACHE` in the same commit as any change to a `SHELL` file.

### 2. 🔴 `Core/locks.js` was never added to the SW `SHELL` list

It is the *only* file on disk missing from `SHELL` (checked exhaustively). Both
`web/ui/render.js:16` and `web/ui/habits-ui.js:15` import it at module top level.

* **Online:** fine — the runtime branch fetches and caches it.
* **Offline cold start:** `caches.match` misses, `fetch` fails, the ES-module graph fails
  to resolve, and **the app renders blank.** No error surfaces to the user.

Add `'/VictoriaTracker/Core/locks.js'` to `SHELL` and bump `CACHE` (see #1).

### 3. 🔴 The Manage panel writes garbage into every non-numeric field

`web/ui/habits-ui.js` `window.updateField` ends in
`else h[field] = parseInt(value) || 1;` and has **no branches for `icon`, `lockTask`,
`lockEnabled` or `lockEveryWeeks`** — all four of which the Manage UI wires to it
(`manage-ui.js:265, 370, 375, 379`). Verified:

| edit in Manage | what lands in Firestore |
|---|---|
| Icon → `🚿` | `1` |
| Required task → `"Change the sheets"` | `1` |
| Task-lock switch **on** | `1` (gate reads as on, but `locked`/`lockWeeks` are never initialised, so it doesn't actually lock until two resets later) |
| Task-lock switch **off** | `1` — **the lock cannot be turned off from the PWA** |

And it gets worse than corruption. `Core/locks.js`:

```js
export function lockTaskLabel(h) {
    const t = ((h && h.lockTask) || '').trim();   // 1..trim() → TypeError
```

`render.js:354` calls `escapeHtml(lockTaskLabel(h))` for any locked habit, **inside the
main render loop**. So: enable the lock → type a task → click "🔒 Lock now" → the next
render throws `TypeError: .trim is not a function` and the Today view dies. Because the
corrupt `lockTask: 1` lands in the shared habits doc, **the native app's `HabitCard` hits
the identical throw.**

**Root cause, and the reason this matters beyond the four fields:**
`Core/habits-data.js` `updateHabitField` — which has all four branches, *plus* the NaN
guard and the name/cat trim — **has zero callers in either app.** Both UIs reimplemented
it locally (`web/ui/habits-ui.js window.updateField`,
`components/HabitEditorModal.tsx updateField`) and only the native copy kept up. Every fix
committed to the Core function since July has been inert everywhere.

Either route both UIs through the Core function, or delete it so it stops looking like the
place fixes belong.

### 4. 🔴 The `val*` NaN guard never reached the PWA

Same function, line 151:

```js
else if (field.startsWith('val'))  h[field] = parseFloat(value);   // no guard
```

Clearing a `$` payout box in Manage writes `NaN` to the shared habits doc.
`getBasePayout`'s `habit.valGoal || 0` then reads `NaN` as **`0`** — silently zeroing that
habit's payout — while `render.js:430-433` echoes `value="NaN"` straight back into the
input. This is verbatim the bug the 2026-07-05 review fixed; the fix went into
`Core/habits-data.js`, which (per #3) nothing calls.

---

## High

### 5. 🟠 The streak badge and glow lag the native app by a week

`render.js` uses the raw history-derived `streaks.streak` for both the 🔥 badge and the
`glow-*` class. Native computes `liveStreak = streaks.streak + (curWeekGood ? 1 : 0)` and
uses that for both. Same habit, same Firestore data, two different numbers depending on
which device she opens — and the card glow tier differs too.

### 6. 🟠 The ⭐ star breakdown still claims Goal and Bonus stack

`render.js`'s `starDetailDiv` prints a static table listing Goal, Bonus and Streak rows.
They don't stack — `getStarsEarned` tests `tier === 'goal'` and `tier === 'bonus'` against
one value, so a bonus week pays `starBonus` *instead of* `starGoal`, and if
`starBonus < starGoal` reaching bonus is a pay cut. Native replaced this with
`lib/habitStarInfo.ts`, which surfaces the exclusivity and shows live per-rung status.
Never ported back.

---

## Shared with native (same `Core/`, byte-identical)

These are detailed in the native report; they apply here through the shared data layer and
should be fixed once, in `Core/`:

* **Water taps on a pending-reset Monday rewrite last week's data** (native #1).
  `web/ui/water-ui.js` calls `Core/water.js addWater()`, so the PWA hits the same window.
* **Streak milestones announce the wrong number** (native #3). `animations.js`
  `MILESTONE_LABELS` and `achievement-catalog.js` are identical to native's. Worth noting:
  `animations.js:135-137` carries a comment conceding *"The streak counter and the displayed
  week count are NOT the same scale"* — so this is known and papered over rather than
  unnoticed. There is no scale on which one weekly-history entry is seven weeks; it needs a
  decision, not a comment.
* **The weekly report re-scores closed weeks with today's config** (native #4) —
  `manage-ui.js:437` and `:495` use the same `{ ...live, history: sh.history }` join.
* **The category-payout rule copy is stale** (native #5) — `index.html:1730-1735` and the
  header comment at `manage-ui.js:102-104` both still describe the pre-2026-08-06
  "every habit / lowest tier / not-yet-due" rule.
* **`periodWasThisWeek` doesn't reach the payout or the snapshot** (native #6).
* `streakCap: 0` means unlimited (native #12); `weeklyReset.js` nits (native #16).

**Two native findings that do *not* apply here — the PWA got these right:**

* **Day Pass vs. the task lock.** `habits-ui.js:366` and `:441` both guard `isLocked(h)`
  *and* the future-day case on the write path. Native's long-press sheet is the one missing
  the guard.
* **Tier counters vs. the tier filter.** `render.js` derives both from the same
  `computeWeeklyPayout(...).tier`, so they can't disagree. Native's `TodayView` filter uses
  the as-of-viewed-day cumulative while its counters use the week total.

---

## Medium / low

7. **EmailJS is dead weight *and* a boot-time single point of failure.** Nothing in
   `web/`, `Core/` or `scripts/` references it any more (the weekly email came out of the
   reset in July), but `index.html:17` still loads the CDN bundle and line 72 calls
   `emailjs.init(EMAIL_CONFIG.publicKey)` **at module top level**. If that CDN is ever
   blocked, or someone removes the `<script>` tag during a cleanup without removing the
   init, the bootstrap module throws before a single watcher registers — blank app, no
   error the user can act on. `EMAIL_CONFIG`'s keys are still shipped too.
8. **The stray root `weekly-reset.yml` is still there, and now describes the *old* design.**
   It differs from `.github/workflows/weekly-reset.yml` — it's the pre-propose/force
   single-cron version. GitHub only reads `.github/workflows/`, so it's inert, but it's a
   decoy that documents a reset flow that no longer exists. Flagged in July; still present.
9. **`checkStreakMilestones()` scans every habit on every call.** Native takes a `habitId`
   fast path (a tap can only cross a milestone for its own habit). Minor cost, but it also
   means several confetti bursts can fire at once.
10. **Long-press to edit is touch-only.** The habit card wires `ontouchstart`/`ontouchend`/
    `ontouchmove` with no mouse equivalent, so the definition/edit gesture is unreachable on
    desktop. Probably intentional for a phone-first PWA — noting it so it isn't mistaken for
    a bug later.

---

## Verified clean

* **`Core/` parity** — 21/23 files byte-identical to native; the two diffs are exactly the
  documented sync-script patches. `sync-core-from-pwa.mjs` is trustworthy again.
* **The reset's double-run guard** — `scripts/reset.js` force mode bails on
  `!rs.pendingReset` *before* consulting `resetAlreadyHandledToday`, and
  `executeWeeklyReset` clears that flag. So the local-vs-UTC date-string weakness noted in
  the native report (#10) is not currently reachable as a double payout on this path.
* **The REST `io` adapter** — `firestoreCommit` maps to the `:commit` endpoint correctly and
  `writeAll` is wired, so the force-run reset is atomic the same way the in-app approval is.
* **`escapeHtml` / `jsStr` coverage** — user-entered strings (habit names, categories, event
  names, shop items, lock tasks) are escaped at every `innerHTML` boundary I checked, and
  `jsStr` correctly handles the apostrophe case in `toggleCol('Victoria's')`.
