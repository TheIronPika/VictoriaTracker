_Last updated 2026-08-06 by overnight automation (toolkit v1.0.0). Review before relying on it._

# VictoriaTracker — Claude Code Guidelines

**One-liner:** A personalized PWA habit tracker for Victoria that pays out real money weekly, runs entirely on GitHub Pages + Firebase, and resets itself every Monday via GitHub Actions.

---

## Git Workflow

All changes must use feature branches. Never commit directly to `main`.

### Start of every session
```powershell
git checkout main
git pull
git checkout -b feature/<short-description>
```

### During work
Commit after each small working change:
```powershell
git add .
git commit -m "description of what changed"
git push origin feature/<short-description>
```

### When the change is tested and working
```powershell
git checkout main
git merge feature/<short-description>
git push
```

### Rolling back if something breaks
- Switch back to main instantly: `git checkout main`
- Undo last commit (keep history): `git revert HEAD`
- Nuke last commit entirely: `git reset --hard HEAD~1`

---

## Stack & Runtime

| Layer | Technology |
|---|---|
| Frontend | Pure ES modules (no framework), HTML5, CSS3 |
| Database | Firebase Firestore (Realtime SDK v10.7.1) |
| Hosting | GitHub Pages (static, no build step) |
| Automation | GitHub Actions + Node.js 22 |
| Charts | Chart.js 4.4.1 (CDN) |
| Drag-reorder | SortableJS 1.15.2 (CDN) |
| Animations | canvas-confetti 1.9.3 (CDN) |
| Fonts | Google Fonts — Playfair Display, Montserrat, Great Vibes |
| Calendar OAuth | Google Identity Services (GIS, loaded at runtime) |

**Note:** The EmailJS browser SDK is still loaded in `index.html` and `EMAIL_CONFIG` is defined in `config.js`, but `emailjs.send()` is not currently called anywhere — the weekly email feature is inactive.

**No build step.** Modules are loaded directly by the browser via `<script type="module">`. Deployment is `git push` to `main`.

### Run locally
```bash
# Any static server works; GitHub Pages serves from /VictoriaTracker/
python3 -m http.server 8000
# open http://localhost:8000/VictoriaTracker/
```

### Deploy
```powershell
git checkout main
git push   # GitHub Pages auto-publishes in ~30 seconds
```

### Run weekly reset manually
```bash
cd scripts
npm install
# Set env vars first (see GitHub Actions secrets below)
RESET_MODE=propose node reset.js   # just flags the week as pending
RESET_MODE=force   node reset.js   # actually executes the reset
```

Add `FORCE_RESET=1` to skip the idempotency guard if re-running after fixing data by hand.

---

## Project Map

```
VictoriaTracker/
├── index.html            ← ENTRY POINT — loads all modules, inits EmailJS SDK (inactive),
│                           starts Firestore listeners, registers window.maybeShowWeeklyReportAfterReset
│                           for the post-reset popup
├── manifest.json         ← PWA metadata (installable on iOS/Android)
├── sw.js                 ← Service worker — offline caching, app-shell strategy (currently v33)
├── background.jpg        ← App background image
│
├── Core/                 ← Pure logic modules (NO DOM access)
│   ├── config.js         ← All keys/IDs/constants (Firebase, EmailJS, Weather, Google Calendar,
│   │                       passcode, Firestore paths, season metadata, tier colors,
│   │                       LUCKY_DRAW_ODDS — per-tier lucky draw chance: Debt 2% / Low 5% /
│   │                       Goal 7% / Bonus 10%,
│   │                       WATER_CONFIG — dailyGoalOz / incrementOz / linkedHabitId)
│   ├── state.js          ← In-memory app state (habits, stars, history, plans, calendar events,
│   │                       section order, waterData, achievements, resetState, categoryConfig, etc.)
│   │                       — single source of truth for the UI render loop
│   ├── utils.js          ← Pure helpers (date math, money formatting, HTML escaping)
│   ├── firebase.js       ← readDoc / writeDoc / watchDoc / mergeDoc / increment wrappers
│   │                       around Firestore SDK v10.7.1
│   ├── habits.js         ← Tier classification and payout calculation logic (including streak bonuses);
│   │                       weekTotal(history) — sums per-day array to a week total;
│   │                       toCumulative(history) — converts per-day array to cumulative running
│   │                       total for bubble-UI display; getCurrentCount() = weekTotal()
│   ├── habits-data.js    ← Firestore CRUD + onSnapshot listener for habits; NaN guard on val
│   │                       fields so a cleared input never writes $NaN to Firestore
│   ├── weeklyReset.js    ← THE RESET LOGIC — proposeWeeklyReset() + executeWeeklyReset() +
│   │                       resetAlreadyHandledToday() (idempotency check, exported so callers
│   │                       can guard without re-reading Firestore). Shared between
│   │                       scripts/reset.js (GitHub Action) and the in-app approval flow.
│   │                       Takes an injected io={readDoc,writeDoc} so it works under
│   │                       plain Node (REST) and in the browser (Firebase SDK).
│   ├── resetState.js     ← Watches/reads system/reset_state; provides effectiveDate() (pins
│   │                       the UI to the un-reset week while a reset is pending),
│   │                       isResetOverdue(), isResetPromptDue(), snoozeWeeklyReset()
│   │                       (MAX_SNOOZES=2, SNOOZE_MS=15 min).
│   ├── streaks.js        ← Streak computation from weekly_history snapshots (memo-cached)
│   ├── cycles.js         ← Cyclic habit scheduling (weekly/monthly/quarterly/yearly)
│   ├── stars.js          ← Star balance, shop item logic, star log; excuse/streak-reset/mark-off tokens
│   ├── events.js         ← Seasonal events (date-range based)
│   ├── period.js         ← Period tracking + protection logic (skips penalties)
│   ├── rooms.js          ← Household room check streaks
│   ├── history.js        ← Weekly snapshot loading and saving
│   ├── section-order.js  ← Today-view section ordering (persisted to system/ui_config)
│   ├── planning.js       ← Weekly plan-ahead data layer (Firestore CRUD + onSnapshot for PLANS doc)
│   ├── calendar.js       ← Calendar events data layer (Firestore CRUD + onSnapshot for CALENDAR doc)
│   ├── water.js          ← Water tracker: daily ounce logging (system/water_data); addWater() /
│   │                       undoWater() use field-level increments to avoid concurrent-write loss;
│   │                       syncWaterHabit() auto-fills the linked "Drink Water" habit bubble
│   │                       (WATER_CONFIG.linkedHabitId) when the daily goal is crossed;
│   │                       computeWaterStreak() returns consecutive goal-hit days
│   ├── achievements.js   ← Permanent achievement badges (system/achievements_data);
│   │                       watchAchievements() subscribes; unlockAchievement(entry) is idempotent
│   │                       (re-reads doc before writing to avoid a stale-state race wiping badges)
│   ├── category-payouts.js ← Category-wide payout MATH — pure functions, no Firebase import.
│   │                         computeCategoryResult() returns tier/dollars/stars for a category.
│   │                         Imported by weeklyReset.js, category-config.js, and render.js.
│   │                         Keep Firebase out of this file (weeklyReset.js runs in plain Node).
│   └── category-config.js  ← Firestore load/watch/save for system/category_config; imports firebase.
│
├── web/ui/               ← DOM/browser modules (import Core, never the reverse)
│   ├── render.js         ← Main render loop, tab navigation, switchTab(), switchWeeklySub(),
│   │                       handleManageClick() (passcode gate → reveals Manage panel in History tab);
│   │                       renders tappable ⭐ star badge per habit card (toggles per-habit star
│   │                       breakdown breakdown panel)
│   ├── ui-state.js       ← UI-only state (collapsed sections, sort lock, filter modes) — backed by localStorage
│   ├── habits-ui.js      ← Habit cards, bubble toggle, CRUD; excuse/streak-reset/mark-off token flows;
│   │                       lucky draw (tier-scaled odds from LUCKY_DRAW_ODDS, max once per habit per day)
│   ├── events-ui.js      ← Seasonal events display & management
│   ├── shop-ui.js        ← Star shop overlay, redemptions, purchase log; doRedeem() guards against
│   │                       failed spendStars() — tokens are never granted on insufficient balance
│   ├── period-ui.js      ← Period UI: start/end modal (backdate via date strip for both start and end,
│   │                       modal title reflects selected date; endPeriod() sets 23:59:59 on backdate),
│   │                       period history table, clear-week-flag button
│   ├── rooms-ui.js       ← Room check display
│   ├── history-ui.js     ← History charts & weekly breakdowns (5 chart sub-tabs: Balance, Heatmap,
│   │                       Top Earners, By Category, ⚙ Settings); also hosts the "MANAGE 🔒" button.
│   │                       The Settings sub-tab contains View Report, Customize Vibe (hue/saturation
│   │                       sliders, persisted to localStorage), and Daily Reminder (browser
│   │                       notification + time picker, persisted to localStorage).
│   ├── manage-ui.js      ← Settings split-panel (behind passcode 1234): left nav sections are
│   │                       Habits, Add Habit, Events, Stars, Period, Layout, Streak $,
│   │                       Achievements, Category; also hosts the weekly report popup + forecast
│   ├── animations.js     ← Time-of-day colors, weather, greeting, particles;
│   │                       applyVibeOverride() and resetVibeOverride() for user-chosen accent color
│   ├── lucky-draw.js     ← Clover popup + lucky draw animation effects (tier-scaled odds from
│   │                       Core/config.js LUCKY_DRAW_ODDS; triggered from habits-ui.js toggleBubble)
│   ├── planning-ui.js    ← Plan sub-tab (within Weekly): habit grid × 7-day bubbles, calendar agenda,
│   │                       copy-previous-week; no top-level tab — toggled via switchWeeklySub('plan')
│   ├── water-ui.js       ← Water tracker card rendered above sectionsRoot on the Today tab.
│   │                       SVG vessel fill animation; taps call addWater()/undoWater() in Core/water.js.
│   │                       Vessel picker (glass/bottle/tumbler/wine/pool) persisted to
│   │                       localStorage key 'waterVessel'.
│   ├── vessel-geometry.js ← SVG path data for water vessel silhouettes (glass, bottle, tumbler,
│   │                        wine, pool-float). Pure data + shapesToSvg() serializer, no DOM.
│   │                        Kept in sync with the native app's vesselGeometry.ts.
│   ├── achievements-ui.js ← Achievement unlock checks not tied to an existing celebration
│   │                        (checkPerfectMonth, checkCumulativeEarnings, etc.) + badge grid
│   │                        rendered in Manage → Achievements panel.
│   ├── achievement-catalog.js ← Static catalog of all achievement definitions (id, label, emoji,
│   │                             description, type, threshold). Synced with native app's
│   │                             achievementCatalog.ts so badge IDs match across platforms.
│   └── google-calendar.js ← Google Calendar read-only sync (GIS token flow → writes events to Firestore).
│                            No connect button exposed in the UI — auto-syncs silently on load if
│                            device has connected before (localStorage 'gcalConnected' flag).
│
├── scripts/
│   ├── reset.js          ← Node.js weekly reset job (runs in GitHub Actions). Thin adapter:
│   │                       provides a Firestore REST io adapter, then calls proposeWeeklyReset()
│   │                       or executeWeeklyReset() from Core/weeklyReset.js depending on RESET_MODE.
│   └── package.json      ← node-fetch dep for reset script (REST API, no firebase-admin)
│
├── .github/workflows/
│   └── weekly-reset.yml  ← Two cron runs every Monday:
│                           • Mon 09:00 UTC (4 AM Central) — RESET_MODE=propose
│                           • Tue 00:00 UTC (7 PM Central Mon) — RESET_MODE=force
│
├── FIXES.md              ← Running log of overnight-review findings and their resolutions;
│                           the nightly reviewer reads this and won't re-flag resolved items
├── docs/
│   ├── OVERVIEW.md
│   ├── ARCHITECTURE.md
│   └── ARCHITECTURE.png  ← Rendered PNG of the Mermaid diagram (auto-generated)
│
└── icons/                ← PWA icons (192px, 512px)
```

**Most important entry point:** `index.html` — it wires everything together: imports all Core and UI modules, starts the Firestore `watchHabits()` listener, kicks off animations/weather, and subscribes to live updates for plans, calendar events, water data, and achievements. Also loads `section-order.js` for the draggable Today-view layout.

**Most important reset file:** `Core/weeklyReset.js` — contains the single implementation of the Monday reset logic (payouts, star awards, streak updates, history snapshot, room/event reset, cycle advancement, category payouts). This is the file to edit if reset behavior needs to change.

**Tab structure (as of 2026-08-06):**
- Tab 0 — **Today**: water tracker card (above sections), habit cards, bubble toggle, room checks, seasonal events
- Tab 1 — **Priorities**: priority-filtered habits
- Tab 2 — **Weekly**: overview matrix with sub-tabs **Overview | Plan** (Plan is the planning grid)
- Tab 3 — **History**: charts + collapsible week entries; five chart sub-tabs (Balance, Heatmap, Top Earners, By Category, ⚙ Settings); the "MANAGE 🔒" button unlocks the Manage panel below it

---

## Data Model & State

All data lives in **Firebase Firestore**, project `victoria-tracker-1d2ab`, collection `system`:

| Document | Key shape |
|---|---|
| `habits_list` | `{ data: Habit[] }` |
| `weekly_history` | `{ weeks: WeeklySnapshot[] }` (max 52) |
| `star_data` | `{ balance, spent, excuseTokens, streakResetTokens, markOffTokens, items: ShopItem[], log: StarLog[] }` |
| `seasonal_events` | `{ events: Event[] }` |
| `period_data` | `{ active, startTs, startDayIdx, history: PeriodHistory[], periodWasThisWeek }` |
| `rooms_data` | `{ rooms: Room[] }` |
| `reset_state` | `{ lastWeeklyReset, pendingReset, pendingSince, snoozeCount, snoozedUntil }` |
| `ui_config` | `{ sectionOrder: string[] }` |
| `weekly_plans` | `{ plans: { "YYYY-MM-DD": { [habitId]: [bool x7] } } }` (max 16 weeks retained) |
| `calendar_events` | `{ events: CalendarEvent[] }` where each event is `{ id, title, startISO, endISO, allDay? }` |
| `category_config` | `{ categories: { [catName]: { punish\|low\|goal\|bonus: { dollars, stars?, restWeek?, dayPass?, freshStart? } } } }` — see item 25 |
| `achievements_data` | `{ unlocked: Achievement[] }` where each is `{ id, achId, label, ts }` — permanent, never cleared by reset |
| `water_data` | `{ goal: number, history: { "YYYY-MM-DD": ounces } }` — field-level increment writes; goal default 120 oz |

**Habit object (critical fields):**
```js
{
  id, name, icon, cat, note,
  punish: 1, low: 3, goal: 5, bonus: 7, max: 7, dailyMax: 1,
  valPunish: -1.50, valLow: 1.00, valGoal: 2.00, valBonus: 3.00,
  starGoal: 0, starBonus: 0, starStreak: 0,
  streakBonusPer: 0, streakPenaltyPer: 0, streakCap: 0,
  cycleType: 'none'|'weeks'|'monthly'|'quarterly'|'yearly',
  cycleEvery: 1, cycleNextDue: timestamp,
  periodSensitive: false, excused: false,
  history: [0,0,0,0,0,0,0],  // PER-DAY counts Mon–Sun (index 6 = Sun).
                              // Each cell = completions logged ON that day alone (not cumulative).
                              // Use weekTotal(h.history) for the week total; toCumulative(h.history)
                              // for the running-total view the bubble UI renders.
  streak: 0, badStreak: 0, bestStreak: 0,
  // Set by streak-reset token; tells weeklyReset.js the bad streak was manually cleared:
  badStreakResetTs: timestamp,
  // Tracks synthetic (mark-off token) completions by day index { "0": 1, "3": 2, ... }
  markOffDays: { [dayIdx]: count },
  // Lucky draw: last date a star was won for this habit (YYYY-MM-DD); caps once per day:
  lastLuckyDrawDate: string,
  // Optional bounty fields (cleared on reset after triggered):
  bountyActive: bool, bountyDollars: number, bountyStars: number,
  bountyExcuseTokens: number, bountyStreakResetTokens: number, bountyNote: string
}
```

**Shop item shape:**
```js
{
  id, icon, name, cost,
  isExcuseToken?: true,       // redeeming grants one Rest Week 🌿
  isStreakResetToken?: true,  // redeeming grants one Fresh Start ☀️
  isMarkOffToken?: true       // redeeming grants one Day Pass 🎫
}
```

**UI naming vs. internal identifiers (2026-08-03 rename).** "Excuse" → "Rest Week" 🌿, "Mark Off" → "Day Pass" 🎫, "Streak Reset" → "Fresh Start" ☀️. Only visible copy changed — field/function names (`excuseTokens`, `markOffTokens`, `streakResetTokens`, `useExcuseToken`, etc.) and Firestore doc shape are untouched.

**In-memory state** lives in `Core/state.js`. It is populated from Firestore on every `onSnapshot` callback and is the single source of truth for the UI render loop. Also holds `sectionOrder[]`, `weeklyPlans{}`, `calendarEvents[]`, `waterData`, `achievements[]`, `resetState`, and `categoryConfig{}`.

**UI-only state** (collapsed sections, sort lock, priority mode, filter mode, etc.) lives in `web/ui/ui-state.js` and is backed by `localStorage`. It is lost on cache clear but has no effect on data integrity.

**Additional localStorage keys (not in ui-state.js):**
- `vt_vibeHue`, `vt_vibeSat` — user-chosen accent color override (History > Settings > Customize Vibe); absent = time-based auto color
- `vt_reminderEnabled`, `vt_reminderTime` — daily browser notification toggle and time (History > Settings > Daily Reminder)
- `gcalConnected` — set to `'1'` when Google Calendar has been authorized; triggers silent re-fetch on page load
- `vt_lastSeenWeeklyReportId` / `vt_muteWeeklyReportPopup` — weekly report popup gating; `lastSeenWeeklyReportId` tracks the last history-snapshot ID shown (popup won't re-show for the same ID); `muteWeeklyReportPopup` is a permanent per-device mute
- `waterVessel` — selected vessel type for the water tracker card (`glass` | `bottle` | `tumbler` | `wine` | `pool`); defaults to `glass` if absent

---

## External Services & Integration Points

| Service | What it does | How it's configured |
|---|---|---|
| **Firebase Firestore** | Primary database; real-time sync via `onSnapshot` | `FIREBASE_CONFIG` in `Core/config.js`; project `victoria-tracker-1d2ab`. Browser SDK uses public API key directly (no auth). |
| **GitHub Pages** | Static hosting; serves the app at `https://theironpika.github.io/VictoriaTracker/` | Enabled in repo Settings → Pages; publishes `main` branch |
| **GitHub Actions** | Runs the two-phase weekly reset via `scripts/reset.js` twice every Monday | `.github/workflows/weekly-reset.yml`; secrets set in repo Settings → Secrets |
| **EmailJS** | SDK loaded but currently inactive — `emailjs.send()` is not called anywhere | `EMAIL_CONFIG` in `Core/config.js`; SDK initialized in `index.html` but no send occurs |
| **OpenWeatherMap** | Current temperature and conditions shown in header | `WEATHER_CONFIG.openWeatherKey` in `Core/config.js` |
| **OpenUV** | UV index shown in header | `WEATHER_CONFIG.openUVKey` in `Core/config.js` |
| **Google Calendar API** | Fetches events for the Planning agenda and conflict dots | `GOOGLE_CALENDAR_CONFIG.clientId` in `Core/config.js`. No connect button is shown in the UI; `google-calendar.js` auto-syncs silently on load if `localStorage.gcalConnected` is set. To disable entirely, set `clientId` to empty string. |
| **Google Identity Services (GIS)** | Browser OAuth token flow for Google Calendar (no redirect, no secret) | Loaded from `accounts.google.com/gsi/client` at runtime by `web/ui/google-calendar.js` |
| **Firebase SDK CDN** | Loaded from `gstatic.com` at runtime | Version 10.7.1 via ES module imports in `Core/firebase.js` |
| **Google Fonts** | Playfair Display, Montserrat, Great Vibes | `<link>` tag in `index.html`; fetched from `fonts.googleapis.com` |
| **Chart.js, SortableJS, canvas-confetti, EmailJS browser SDK** | Loaded from `cdn.jsdelivr.net` | `<script>` tags in `index.html` |

**GitHub Actions secrets required** (set in repo Settings → Secrets → Actions):
`FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`

**`scripts/reset.js` uses the Firestore REST API, not firebase-admin.** It authenticates with `FIREBASE_API_KEY` via `node-fetch` — not a service account. There is no `firebase-admin` import or dependency.

---

## Conventions & Gotchas

1. **Day index is Monday-first (0 = Mon, 6 = Sun).** `getDayIdx()` in `utils.js` normalizes JS's Sunday-first `Date.getDay()`. `history[6]` is always today (Sunday). This is the index into the 7-element `habit.history` array.

   **`habit.history` stores per-day counts, not a cumulative running total.** `history[i]` is the number of completions logged *on day i alone*. Two helper functions in `Core/habits.js` bridge old and new callers:
   - `weekTotal(history)` — sums the 7 cells to the week's total (replaces reading the last element).
   - `toCumulative(history)` — converts per-day to a cumulative array (Mon through Sun) for bubble display. The UI feeds this into the same rendering logic that previously read the raw array, so visually nothing changed.
   - `getCurrentCount(habit)` now delegates to `weekTotal`.
   - Weekly history snapshots written to `weekly_history` are still stored in cumulative form so the History tab and reset calculations are unchanged.

2. **Streaks are computed from `weekly_history`, not stored counters.** `streaks.js` scans backward through snapshots to derive current and bad streaks. `computeStreaksFromHistory()` is memo-cached by array reference so repeated calls in the same render are O(1). This prevents drift when resets are missed or run manually.

3. **Firestore paths use a two-element tuple `[collection, docId]`.** Always use `FIRESTORE_DOCS.*` constants from `config.js` — never hard-code path strings.

4. **`Core/habits.js` `computeWeeklyPayout()` is the single source of truth for per-habit money math.** The live header (`web/ui/render.js`), the Streak $ panel (`web/ui/manage-ui.js`), and the Monday reset (`Core/weeklyReset.js`) all import and call it. If you change tier / cycle / late / period / bounty / streak math, change it in `habits.js` and all three callers follow automatically. `weeklyReset.js` also imports `getTier`, `isCyclic`, `isCycleDue`, and `cycleIntervalMs` from `Core/` for the same reason.

5. **The weekly reset is a two-phase propose → execute flow.** `Core/weeklyReset.js` exports two functions:
   - `proposeWeeklyReset(io, now)` — called Monday 4am by GitHub Actions. Flips `reset_state.pendingReset = true` only; makes NO data changes. This gives Victoria a window to fix last week's data before anything is scored.
   - `executeWeeklyReset(io, now)` — the actual reset (payouts, snapshots, wipe, etc.). Called either when Victoria approves in-app or by GitHub Actions force mode at 7pm Central Monday.
   - Both functions take an injected `io = { readDoc, writeDoc }` so they work under Node (REST) and browser (Firebase SDK) without modification.
   - Idempotency guard: both check `reset_state.lastWeeklyReset === now.toDateString()` and bail early unless `FORCE_RESET=1` is set.

6. **`Core/resetState.js` owns the UI-side reset approval flow.** It is a separate module from `Core/weeklyReset.js` (which is shared with the GitHub Action and must not grow browser-only deps):
   - `effectiveDate()` — while `isResetOverdue()` is true, returns the Sunday of the un-reset week instead of today, pinning the date strip / bubbles / water sync to the data that's actually in `habit.history`.
   - `isResetPromptDue()` — true when the approval modal should be shown; handles snoozed state and a fallback for when the GitHub Action's propose run never fires.
   - `snoozeWeeklyReset()` — hides the modal for 15 minutes (MAX_SNOOZES = 2 total).
   - Uses `effectiveDate()` in `Core/water.js syncWaterHabit()` so the water-habit link always writes to the correct day index during the reset window.

7. **Period protection skips scoring, not history.** When a period is active, period-sensitive habits keep logging completions normally but the reset ignores their payouts/penalties. Bubbles turn pink for those days. When `periodWasThisWeek` is true (ended mid-week), those habits' streaks are also frozen on reset. Both starting and ending a period support backdating.

8. **Cyclic habits are hidden until their `cycleNextDue` date passes.** The reset advances `cycleNextDue` automatically. Cyclic habits **never take weekly negative payouts** — punish/low weeks pay $0 instead of a penalty. Late completions reduce the positive payout: `weeksLate × streakPenaltyPer` is deducted, floored at $0.

9. **Bounty system.** A habit can have a one-time bounty (`bountyActive`, `bountyDollars`, `bountyStars`, `bountyExcuseTokens`, `bountyStreakResetTokens`). On reset, if the habit lands at goal/bonus that week, the bounty fires and all bounty fields are cleared. The `bounty-glow` card style appears when `bountyActive` is true.

10. **Section order is persisted to `system/ui_config`.** The Today tab's section order (categories + Seasonal + Rooms cards) is reorderable from Manage → Layout. Order is synced live across tabs/devices via `watchSectionOrder()`. New categories not in the stored order are appended at the end automatically. The water tracker card sits *above* the sectionsRoot div and is never part of the section-order system.

11. **`Core/` modules must never import from `web/ui/`.** The dependency arrow is one-way: UI imports Core, never the reverse. This keeps Core testable outside a browser (and specifically makes `Core/weeklyReset.js` and `Core/category-payouts.js` runnable from the GitHub Action).

12. **Manage panel passcode is `1234`** (see `MANAGE_PASSCODE` in `config.js`). It's intentionally public since this is a single-user personal app. Access: History tab → "MANAGE 🔒" button → enter passcode. Sections: Habits, Add Habit, Events, Stars, Period, Layout, Streak $, Achievements, Category.

13. **Service worker caches the app shell only.** Firestore, CDN libraries, and API calls always go network-first. The app shows stale UI when offline but won't lose data. **When adding a new file to the app shell, add it to the `SHELL` array in `sw.js` and bump the `CACHE` version string.** Current version: `victoria-v33`.

14. **History chart rendering is deferred.** Chart.js canvases are only built when the History tab is visible, to avoid expensive re-renders on every Firestore update.

15. **`HISTORY_MAX_WEEKS = 52` and `STAR_LOG_MAX = 200`** are enforced on write. Oldest entries are pruned automatically.

16. **The interactive weekly report popup auto-shows once per device after each reset.** It is gated by a `localStorage` key derived from the reset date, so it fires exactly once per device per week. Victoria (or Drew) can dismiss it or click "Don't show on this device" to permanently mute it per device. The report is also accessible any time from **History → ⚙ Settings → View Report**.

17. **Streak bonus/penalty are flat per-week (not escalating).** `streakBonusPer` is added once per good week; `streakPenaltyPer` is deducted once per bad week. `streakCap` caps the per-week amount. The streak counter itself still grows/resets each week.

18. **The Planning view stores intent, not history.** `Core/planning.js` and `web/ui/planning-ui.js` let Victoria pre-fill which days she plans to do each habit. This data lives in `system/weekly_plans` and **never touches `habit.history`**. It is purely visual — the Plan view has no effect on payouts or streaks. Only the last 16 weeks of plans are retained in Firestore to prevent unbounded growth. The Plan view is a sub-tab within the Weekly tab (`switchWeeklySub('plan')`), not a separate top-level tab.

19. **Calendar events are cached in Firestore.** `web/ui/google-calendar.js` fetches events from Google Calendar (4-week window, starting last week) using the GIS token flow and writes them to `system/calendar_events`. Because that doc is live-watched, events appear on the Planning agenda cross-device without a refresh. There is currently no user-visible connect button in the UI — if `GOOGLE_CALENDAR_CONFIG.clientId` is set and `localStorage.gcalConnected === '1'`, the module silently re-fetches on page load.

20. **Planning bubble colors reflect the tier that planned-day-count-so-far would reach.** Each planning bubble is colored by the performance tier the running planned count would land on for that day of the week, giving a visual preview of the week's expected outcome.

21. **Three token types live in `star_data`.** All three are purchased from the Star Shop and consumed from habit cards. Field/function names are unchanged from before the 2026-08-03 UI rename; only the visible copy uses the new names:
    - **Rest Week** 🌿 (field `excuseTokens`, fns `useExcuseToken`/`addExcuseToken`) — freeze one habit for the week (no payout either direction, streak held). `h.excused = true`.
    - **Fresh Start** ☀️ (field `streakResetTokens`, fns `useStreakResetToken`/`addStreakResetToken`) — zero a habit's bad-streak counter without requiring a goal week. Sets `h.badStreak = 0` and `h.badStreakResetTs = Date.now()`.
    - **Day Pass** 🎫 (field `markOffTokens`, fns `useMarkOffToken`/`addMarkOffToken`) — synthetically add +1 completion to a habit for the current viewing day (as if she actually did it). The synthetic increment is stored in `h.markOffDays[dayIdx]`. Removing a Day Pass bubble refunds the token proportionally.
    - All three token flows show a confirmation modal before consuming a token, and show a "no tokens left — pick more up in the star shop" modal if balance is 0. The Rest Week and Day Pass action buttons are hidden entirely when the respective token balance is 0.
    - Bounties can grant Rest Weeks and/or Fresh Starts (`bountyExcuseTokens`, `bountyStreakResetTokens`); see item 9.
    - `shop-ui.js` `doRedeem()` checks the return value of `spendStars()` before granting tokens — if the balance is insufficient for any reason, the UI is reset without granting anything.

22. **Mark-off completions appear as grey bubbles.** The bubble rendered for a synthetic (mark-off) day is visually distinguished from a real completion to make it clear it was purchased, not earned.

23. **History > Settings sub-tab (⚙).** Contains three user-facing controls:
    - **View Report** — opens the weekly report (same popup as the post-reset auto-show) from the History tab without going into the Manage panel.
    - **Customize Vibe** — hue and saturation sliders override the automatic time-of-day accent color. Values are saved to `localStorage` (`vt_vibeHue`, `vt_vibeSat`). Reset-to-auto removes those keys and restores the time-shift animation.
    - **Daily Reminder** — toggle + time picker; fires a browser `Notification` once per calendar day while the app tab is open. State saved to `localStorage` (`vt_reminderEnabled`, `vt_reminderTime`).

24. **Lucky draw odds scale by tier.** When a bubble tap increases the completion count, there is a per-tier chance of winning a bonus star (max once per habit per day). Odds are defined in `LUCKY_DRAW_ODDS` in `Core/config.js`: Debt 2%, Low 5%, Goal 7%, Bonus 10%. Winning triggers the clover popup and confetti effect via `web/ui/lucky-draw.js`. The last-win date (`h.lastLuckyDrawDate`) is stored on the habit to enforce the once-per-day cap.

25. **NaN guard on payout fields.** `Core/habits-data.js` `updateHabitField()` treats any non-finite `parseFloat()` result (e.g., from a cleared input) as a no-op, keeping the previous Firestore value rather than writing `NaN`. This prevents "$NaN" from appearing in payout totals.

26. **Category-wide payouts (`system/category_config`).** The only cross-habit payout in the app: when every *counting* habit in a category reaches a tier, the category itself pays dollars, stars and all three tokens.
    - **The tier rule:** a category's tier is the **lowest** tier any counting habit reached. All at Goal pays Goal; one straggler at Low drags the whole category to Low.
    - **Counting habits exclude** ALL cyclic habits, resting habits (Rest Week), and period-protected habits. Resting and protected are *neutral* — they neither block the payout nor need to hit tier.
    - **Category payouts are for weekly habits only.** As of 2026-08-06 `computeCategoryResult` filters on `!isCyclic(h)`, not `isCycleDue(h)`. A monthly/quarterly/yearly habit is not a weekly commitment, and including it only on the weeks it fell due made the category quietly harder to clear on those weeks and easier on the rest. Live effect: Pleasers Practice (quarterly), Clean Pantry (monthly), Bad Dragon (quarterly) and Reorginize/Clean Freezer (quarterly) no longer count. **Seasonal events need no exclusion** — they live in `state.seasonalEvents` / `system/seasonal_events`, carry no `cat`, and are never members of `state.habits`, so they have never entered this math.
    - **A category with zero counting habits pays nothing.** Guarded explicitly in `computeCategoryResult` — do not remove.
    - **Debt/Low are dollars-only** (negative = penalty), mirroring habits.
    - **Two modules, deliberately split.** `Core/category-payouts.js` is pure math with NO `./firebase.js` import, because `Core/weeklyReset.js` imports it and must run under plain Node in the GitHub Action. `Core/category-config.js` holds the Firestore load/watch/save and imports firebase. **Keep Firebase out of category-payouts.js.**
    - **Tier math uses the WEEK TOTAL** (`weekTotal(h.history)`), not the as-of-viewed-day cumulative.
    - **Maxed-out habits count as Bonus for category math** (`effectiveCategoryTier`). A habit whose `bonus` threshold exceeds its `max` (weekly ceiling) can never return `'bonus'` from `getTier`, so before 2026-08-06 it pinned its category at Goal forever and the category's bonus reward was unpayable dead config. Hitting its own ceiling now counts as Bonus for the **category minimum only** — the habit's own dollars/stars/streak still come from `getTier`, so a goal-capped habit banks its Goal payout. Promotion is gated to habits already at Goal or better: a habit whose `max` sits below its own thresholds is misconfigured and stays a laggard rather than silently paying a bonus on a punish week.
    - **Results are snapshotted into the weekly history** (`entry.categories`), not re-derived at read time.

27. **Water tracker (`Core/water.js`).** A standalone daily ounce tracker, not a Habit:
    - Owns `system/water_data = { goal, history: { "YYYY-MM-DD": ounces } }`. Default goal: 120 oz/day; tap increment: 10 oz.
    - `addWater()` / `undoWater()` use **field-level increment writes** (not whole-doc rewrites) so taps from phone, a second device, and the home-screen widget all sum correctly under concurrent writes.
    - `syncWaterHabit()` auto-fills the "Drink Water" reward habit (id in `WATER_CONFIG.linkedHabitId`) with exactly ONE bubble when the daily goal is crossed — crossing back under goal removes it. Uses `effectiveDate()` from `Core/resetState.js` so it always writes to the correct day during the Monday reset window.
    - The linked habit is locked against manual bubble taps when a water tracker card is present — the card owns that habit's count.
    - The Today-view card (`web/ui/water-ui.js`) renders an SVG vessel that fills as ounces increase; the vessel shape (glass/bottle/tumbler/wine/pool) is persisted in `localStorage.waterVessel`.

28. **Achievements (`Core/achievements.js`).** Permanent badges stored in `system/achievements_data`:
    - Badge definitions live in `web/ui/achievement-catalog.js` and are synced with the native app's catalog so IDs match across platforms.
    - Categories: streak milestones (7/30/100 weeks per habit, composite IDs like `streak_7_<habitId>`), perfect week, perfect month (4 consecutive), cumulative earnings ($1k, $5k), shop milestones (first / 10 redemptions), first bounty, water streak (7/30/100 days).
    - `unlockAchievement(entry)` re-reads the Firestore doc before writing to avoid a stale-state race that would wipe previously-unlocked badges on concurrent app launches.
    - Perfect-week and streak-milestone unlocks live in `animations.js` (alongside the confetti they accompany). Other checks live in `achievements-ui.js`.
    - Badge grid is displayed in **Manage → Achievements**.

29. **Tappable star badge on habit cards.** `render.js` renders a `⭐` badge on each habit card when the habit has star thresholds configured. Tapping it (without propagation to the card) toggles a per-habit star breakdown panel showing starGoal, starBonus, and starStreak values.

---

## UI Styling Reference

All new UI must match the existing visual language. Before writing any significant UI change, show a description or mockup and get approval first (see process note below).

| Token | Notes |
|---|---|
| **Background** | `background.jpg` watercolor image; cards/panels sit on top with semi-transparent fills so it shows through |
| **Tier colors** | Always sourced from `TIER_COLORS` in `Core/config.js` — never hardcode hex values for tiers |
| **Card/panel style** | Semi-transparent white backgrounds (`rgba(255,255,255,0.N)`); soft rounded corners consistent with surrounding elements |
| **Bubbles** | Gradient fill per tier color; circular; tap toggles with a brief visual response. Mark-off (synthetic) bubbles render grey. |
| **Typography** | System fonts plus Google Fonts (Playfair Display, Montserrat, Great Vibes). Sizes and weights should match surrounding UI (inspect existing cards before adding new text) |
| **Layout** | Tab-based (`switchTab`); new tabs go in index.html tab strip + `<style id="...">` block; new panels use the same card structure as existing ones |
| **Spacing** | Match existing padding/margin patterns — no arbitrary magic numbers |
| **Service worker** | Any new file added to the app shell **must** be added to the `SHELL` array in `sw.js` and the `CACHE` version bumped |

### Process: show before you build

For any **significant UI change** (new tab, new panel, new modal, revised layout), write a short plain-English description of what it will look like — or a rough ASCII/text mockup — and get Drew's approval **before writing the code**. Small tweaks (copy change, color adjustment, adding a badge) can go straight to code.
