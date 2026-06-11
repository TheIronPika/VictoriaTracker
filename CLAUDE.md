_Last updated 2026-06-11 by overnight automation (toolkit v1.0.0). Review before relying on it._

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
| Email | EmailJS (browser SDK) |
| Charts | Chart.js 4.4.1 (CDN) |
| Drag-reorder | SortableJS 1.15.2 (CDN) |
| Animations | canvas-confetti 1.9.3 (CDN) |

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
node reset.js
```

---

## Project Map

```
VictoriaTracker/
├── index.html            ← ENTRY POINT — loads all modules, inits EmailJS, starts Firestore listener,
│                           registers window.maybeShowWeeklyReportAfterReset for the post-reset popup
├── manifest.json         ← PWA metadata (installable on iOS/Android)
├── sw.js                 ← Service worker — offline caching, app-shell strategy
├── background.jpg        ← App background image
│
├── Core/                 ← Pure logic modules (NO DOM access)
│   ├── config.js         ← All keys/IDs/constants (Firebase, EmailJS, Weather, passcode, Firestore paths)
│   ├── state.js          ← In-memory app state (habits array, stars, history, section order, etc.)
│   ├── utils.js          ← Pure helpers (date math, money formatting, HTML escaping)
│   ├── firebase.js       ← readDoc / writeDoc / watchDoc wrappers around Firestore SDK v10.7.1
│   ├── habits.js         ← Tier classification and payout calculation logic (including streak bonuses)
│   ├── habits-data.js    ← Firestore CRUD + onSnapshot listener for habits
│   ├── streaks.js        ← Streak computation from weekly_history snapshots (memo-cached)
│   ├── cycles.js         ← Cyclic habit scheduling (weekly/monthly/quarterly/yearly)
│   ├── stars.js          ← Star balance, shop item logic, star log
│   ├── events.js         ← Seasonal events (date-range based)
│   ├── period.js         ← Period tracking + protection logic (skips penalties)
│   ├── rooms.js          ← Household room check streaks
│   ├── history.js        ← Weekly snapshot loading and saving
│   └── section-order.js  ← Today-view section ordering (persisted to system/ui_config)
│
├── web/ui/               ← DOM/browser modules (import Core, never the reverse)
│   ├── render.js         ← Main render loop, tab navigation
│   ├── ui-state.js       ← UI-only state (collapsed sections, sort lock, filter modes) — backed by localStorage
│   ├── habits-ui.js      ← Habit cards, bubble toggle, CRUD
│   ├── events-ui.js      ← Seasonal events display & management
│   ├── shop-ui.js        ← Star shop, redemptions, purchase log
│   ├── period-ui.js      ← Period UI and history
│   ├── rooms-ui.js       ← Room check display
│   ├── history-ui.js     ← History charts & weekly breakdowns (4 chart types, collapsible week entries)
│   ├── manage-ui.js      ← Settings split-panel (behind passcode 1234) + weekly report preview + forecast
│   ├── animations.js     ← Time-of-day colors, weather, greeting, particles
│   └── lucky-draw.js     ← Clover popup + lucky draw animation effects
│
├── scripts/
│   ├── reset.js          ← Node.js weekly reset job (runs in GitHub Actions)
│   └── package.json      ← node-fetch dep for reset script (REST API, no firebase-admin)
│
├── .github/workflows/
│   └── weekly-reset.yml  ← Cron: every Monday 09:00 UTC (4 AM Central)
│
├── docs/
│   ├── OVERVIEW.md
│   └── ARCHITECTURE.md
│
└── icons/                ← PWA icons (192px, 512px)
```

**Most important entry point:** `index.html` — it wires everything together: imports all Core and UI modules, initializes EmailJS, starts the Firestore `watchHabits()` listener, and kicks off animations/weather. Also loads `section-order.js` for the draggable Today-view layout.

---

## Data Model & State

All data lives in **Firebase Firestore**, project `victoria-tracker-1d2ab`, collection `system`:

| Document | Key shape |
|---|---|
| `habits_list` | `{ data: Habit[] }` |
| `weekly_history` | `{ weeks: WeeklySnapshot[] }` (max 52) |
| `star_data` | `{ balance, spent, excuseTokens, items: ShopItem[], log: StarLog[] }` |
| `seasonal_events` | `{ events: Event[] }` |
| `period_data` | `{ active, startTs, startDayIdx, history: PeriodHistory[], periodWasThisWeek }` |
| `rooms_data` | `{ rooms: Room[] }` |
| `reset_state` | `{ lastWeeklyReset }` |
| `ui_config` | `{ sectionOrder: string[] }` |

**Habit object (critical fields):**
```js
{
  id, name, icon, cat, note,
  punish: 1, low: 3, goal: 5, bonus: 7, dailyMax: 1,
  valPunish: -1.50, valLow: 1.00, valGoal: 2.00, valBonus: 3.00,
  starGoal: 0, starBonus: 0, starStreak: 0,
  streakBonusPer: 0, streakPenaltyPer: 0, streakCap: 0,
  cycleType: 'none'|'weeks'|'monthly'|'quarterly'|'yearly',
  cycleEvery: 1, cycleNextDue: timestamp,
  periodSensitive: false, excused: false,
  history: [0,0,0,0,0,0,0],  // Mon–Sun, index 6 = today (Sun)
  streak: 0, badStreak: 0, bestStreak: 0,
  // Optional bounty fields (cleared on reset after triggered):
  bountyActive: bool, bountyDollars: number, bountyStars: number,
  bountyExcuseTokens: number, bountyNote: string
}
```

**In-memory state** lives in `Core/state.js`. It is populated from Firestore on every `onSnapshot` callback and is the single source of truth for the UI render loop. Also holds `sectionOrder[]` for the today-view layout.

**UI-only state** (collapsed sections, sort lock, priority mode, filter mode, etc.) lives in `web/ui/ui-state.js` and is backed by `localStorage`. It is lost on cache clear but has no effect on data integrity.

**Weekly report mute flag** is stored in `localStorage` under a per-week key so the popup only auto-shows once per device per reset.

---

## External Services & Integration Points

| Service | What it does | How it's configured |
|---|---|---|
| **Firebase Firestore** | Primary database; real-time sync via `onSnapshot` | `FIREBASE_CONFIG` in `Core/config.js`; project `victoria-tracker-1d2ab`. Browser SDK uses public API key directly (no auth). |
| **GitHub Pages** | Static hosting; serves the app at `https://theireonpika.github.io/VictoriaTracker/` | Enabled in repo Settings → Pages; publishes `main` branch |
| **GitHub Actions** | Runs `scripts/reset.js` every Monday 09:00 UTC | `.github/workflows/weekly-reset.yml`; secrets set in repo Settings → Secrets |
| **EmailJS** | Sends weekly summary email to Drew | `EMAIL_CONFIG` in `Core/config.js`; secrets also in GitHub Actions. Browser SDK initialized in `index.html`. |
| **OpenWeatherMap** | Current temperature and conditions shown in header | `WEATHER_CONFIG.openWeatherKey` in `Core/config.js` |
| **OpenUV** | UV index shown in header | `WEATHER_CONFIG.openUVKey` in `Core/config.js` |
| **Firebase SDK CDN** | Loaded from `gstatic.com` at runtime | Version 10.7.1 via ES module imports in `Core/firebase.js` |
| **Chart.js, SortableJS, canvas-confetti, EmailJS browser SDK** | Loaded from `cdn.jsdelivr.net` | `<script>` tags in `index.html` |

**GitHub Actions secrets required** (set in repo Settings → Secrets → Actions):
`FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`,
`EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`

**`scripts/reset.js` uses the Firestore REST API, not firebase-admin.** It authenticates with `FIREBASE_API_KEY` via `node-fetch` to the REST endpoint — not a service account. There is no `firebase-admin` import or dependency.

---

## Conventions & Gotchas

1. **Day index is Monday-first (0 = Mon, 6 = Sun).** `getDayIdx()` in `utils.js` normalizes JS's Sunday-first `Date.getDay()`. `history[6]` is always today (Sunday). This is the index into the 7-element `habit.history` array.

2. **Streaks are computed from `weekly_history`, not stored counters.** `streaks.js` scans backward through snapshots to derive current and bad streaks. `computeStreaksFromHistory()` is memo-cached by array reference so repeated calls in the same render are O(1). This prevents drift when resets are missed or run manually.

3. **Firestore paths use a two-element tuple `[collection, docId]`.** Always use `FIRESTORE_DOCS.*` constants from `config.js` — never hard-code path strings.

4. **`Core/habits.js` `computeWeeklyPayout()` is the single source of truth for per-habit money math.** The live header (`web/ui/render.js`), the Streak $ panel (`web/ui/manage-ui.js` `_thisWeekBreakdown`), and the Monday reset (`scripts/reset.js`) all import and call it — there is no longer a "browser copy vs. Node copy" to keep in sync. If you change tier / cycle / late / period / bounty / streak math, change it there and the three callers automatically follow. `scripts/reset.js` also imports `getTier`, `isCyclic`, `isCycleDue`, and `cycleIntervalMs` from `Core/` for the same reason. (Streak counter updates, idempotency, history-snapshot shape, and the email report still live in `reset.js` because they're reset-only concerns.)

5. **`scripts/reset.js` is idempotent.** It reads `system/reset_state.lastWeeklyReset` at the top and bails (no payouts, no history snapshot, no star awards, no cycle advance) if it's already today, unless `FORCE_RESET=1` is set. Use that env var if you need to re-run after fixing data by hand.

6. **Period protection skips scoring, not history.** When a period is active, period-sensitive habits keep logging completions normally but the reset ignores their payouts/penalties. Bubbles turn pink for those days. When `periodWasThisWeek` is true (ended mid-week), those habits' streaks are also frozen on reset.

7. **Cyclic habits are hidden until their `cycleNextDue` date passes.** The reset advances `cycleNextDue` automatically. They won't appear on the Today tab when not yet due (`isCycleDue()` returns false). Cyclic habits **never take weekly negative payouts** — punish/low weeks pay $0 instead of a penalty. Late completions reduce the positive payout: `weeksLate × streakPenaltyPer` is deducted, floored at $0.

8. **Bounty system.** A habit can have a one-time bounty (`bountyActive`, `bountyDollars`, `bountyStars`, `bountyExcuseTokens`). On reset, if the habit lands at goal/bonus that week, the bounty fires and all bounty fields are cleared. The `bounty-glow` card style appears when `bountyActive` is true.

9. **Section order is persisted to `system/ui_config`.** The Today tab's section order (categories + Seasonal + Rooms cards) is reorderable from Manage → Layout. Order is synced live across tabs/devices via `watchSectionOrder()`. New categories not in the stored order are appended at the end automatically.

9. **`Core/` modules must never import from `web/ui/`.** The dependency arrow is one-way: UI imports Core, never the reverse. This keeps Core testable outside a browser.

10. **Manage panel passcode is `1234`** (see `MANAGE_PASSCODE` in `config.js`). It's intentionally public since this is a single-user personal app.

11. **Service worker caches the app shell only.** Firestore, CDN libraries, and API calls always go network-first. The app shows stale UI when offline but won't lose data.

12. **History chart rendering is deferred.** Chart.js canvases are only built when the History tab is visible, to avoid expensive re-renders on every Firestore update.

13. **`HISTORY_MAX_WEEKS = 52` and `STAR_LOG_MAX = 200`** are enforced on write. Oldest entries are pruned automatically.

14. **The interactive weekly report popup auto-shows once per device after each reset.** It is gated by a `localStorage` key derived from the reset date, so it fires exactly once per device per week. Victoria (or Drew) can dismiss it or click "Don't show on this device" to permanently mute it per device. The same report is accessible any time via the **View Report** button inside the Manage panel.

15. **Streak bonus/penalty are flat per-week (not escalating).** `streakBonusPer` is added once per good week; `streakPenaltyPer` is deducted once per bad week. `streakCap` caps the per-week amount. The streak counter itself still grows/resets each week.
