_Last updated 2026-07-21 by overnight automation (toolkit v1.0.0). Review before relying on it._

# VictoriaTracker — Owner's Guide

## What Is This?

VictoriaTracker is a personalized habit and household management app built for Victoria (managed by Drew). It's a Progressive Web App — meaning it installs on a phone like a native app — but it lives at a simple GitHub Pages URL and all its data is stored in the cloud.

The core idea: Victoria logs her habits each day by tapping bubbles. At the end of every week, the app automatically calculates a dollar payout based on how consistently she hit each habit and resets everything for the new week. The next time Victoria opens the app after a reset, an interactive report popup appears summarizing the just-completed week — it can be navigated back through past weeks and dismissed when done. Habits that are done consistently earn stars that can be spent in the Star Shop on custom rewards.

It's not a generic habit tracker. It has several interconnected systems:
- **Daily habit logging** with four performance tiers (Debt / Low / Goal / Bonus)
- **Weekly financial payouts** — real money, calculated automatically every Monday
- **Interactive weekly report popup** — auto-shows after each reset; browse past weeks; also accessible from History → ⚙ Settings → View Report
- **Star Shop** — earn stars for strong weeks, spend them on treats or special tokens
- **Lucky draw** — each bubble tap has a tier-scaled chance of winning a bonus star (Debt 2%, Low 5%, Goal 7%, Bonus 10%), max once per habit per day, with a clover popup and confetti fanfare
- **Three token types** — excuse tokens (skip a habit's penalties for the week), streak reset tokens (clear a bad-streak counter), and mark-off tokens (synthetically count one extra completion)
- **Streak bonuses and penalties** — good streaks earn a flat bonus per week; bad streaks deduct a flat penalty per week
- **Bounties** — one-time bonus payouts/stars set on a habit; they fire when she hits Goal or Bonus that week and then clear automatically
- **Period protection** — sensitive habits automatically skip penalties during Victoria's period
- **Room checks** — household room tidiness tracked with streak bonuses
- **Seasonal events** — special date-range tasks like Spring Cleaning
- **Cyclic habits** — habits that only appear on schedule (monthly deep cleans, annual tasks, etc.)
- **Plan view** — a weekly grid for pre-planning which days to tackle each habit, with a calendar agenda alongside; accessed via Weekly → Plan
- **History Settings** — History → ⚙ tab: View Report shortcut, Customize Vibe (accent color sliders), Daily Reminder (browser notification)

---

## How the Pieces Fit Together

```
User taps bubble
       │
       ▼
index.html (entry point)
   loads all JS modules
       │
       ▼
Core/ modules (pure logic, no UI)
   • config.js        — all keys, constants, Firestore paths, LUCKY_DRAW_ODDS per-tier %
   • state.js         — in-memory app state
   • habits-data.js   — reads/writes Firestore, triggers re-render on change;
                         NaN guard prevents cleared inputs from corrupting payout fields
   • weeklyReset.js   — the reset logic: propose + execute phases (shared
                         between GitHub Action and planned in-app approval)
   • stars.js         — star balance, all three token types, shop items
   • planning.js      — weekly plan-ahead data (intent only, never touches history)
   • calendar.js      — calendar events synced from Google Calendar → Firestore
   • section-order.js — today-view section order, synced live
       │
       ▼
web/ui/ modules (DOM rendering)
   • render.js        — rebuilds the screen after every data change; tab nav;
                        switchWeeklySub() toggles Overview vs. Plan within Weekly tab
   • habits-ui.js     — bubble toggle, lucky draw (tier-scaled odds), token flows
   • history-ui.js    — History tab charts (5 sub-tabs: Balance, Heatmap, Top Earners,
                        By Category, ⚙ Settings); Settings sub-tab has View Report,
                        Customize Vibe, and Daily Reminder
   • planning-ui.js   — Plan sub-tab: habit grid + calendar agenda
   • shop-ui.js       — Star Shop: redeem items, grant tokens; guards against failed
                        balance deductions before granting any token
   • period-ui.js     — period start/end (both support backdating; modal title
                        reflects selected date when backdating end)
   • manage-ui.js     — settings split-panel + weekly report popup + forecast
   • animations.js    — time-of-day accent color; Customize Vibe override
   • lucky-draw.js    — clover popup + confetti animation for lucky draw wins
   • google-calendar.js — Google Calendar OAuth sync (silent auto-refresh only;
                          no connect button currently shown in the UI)
       │
       ▼
Firebase Firestore (cloud database)
   • 10 documents in the "system" collection
   • real-time sync: any change on one device appears on all others instantly
       │
Every Monday, GitHub Actions runs scripts/reset.js TWICE:
       │
       ├─ 4:00 AM Central (09:00 UTC Mon) — PROPOSE mode
       │      Flips reset_state.pendingReset = true.
       │      Makes NO other changes — Victoria has until 7pm to fix last week's
       │      data before anything is scored or wiped.
       │
       └─ 7:00 PM Central (00:00 UTC Tue) — FORCE mode
              If Victoria never approved in the app, forces the actual reset
              through so payouts and history can't stall indefinitely.
              Both paths call Core/weeklyReset.js executeWeeklyReset():
              • computes final tiers and payouts (via Core/habits.js)
              • awards stars, bounties, and excuse tokens
              • applies streak bonuses/penalties; advances cycleNextDue for cyclic habits
              • saves a weekly snapshot to history
              • resets all habit counters to zero; clears bounty fields that fired
              • advances room check streaks; resets room marks
              • advances seasonal event payout watermark
              • the app detects the new reset on next open and shows the report popup
```

The app has no backend server. It's purely static files (HTML + JavaScript) hosted for free on GitHub Pages, with Firebase handling data storage and sync.

---

## How Do I...

### Run it locally for development

You need any static file server. The simplest:

```bash
# from the repo root
python3 -m http.server 8000
```

Then open `http://localhost:8000/VictoriaTracker/` in your browser.

The app will connect to the live Firebase database (same data as production), so be careful — any changes you make locally affect real data.

### Deploy a change

```powershell
# 1. Make your change on a feature branch
git checkout -b feature/my-change
# ... edit files ...
git add .
git commit -m "describe the change"
git push origin feature/my-change

# 2. Merge to main when ready
git checkout main
git merge feature/my-change
git push
```

GitHub Pages picks up the new `main` branch automatically within about 30 seconds. There is no build step — what you push is what gets served.

### Trigger the weekly reset manually

Go to the repo on GitHub → **Actions** tab → **Weekly Habit Reset** → **Run workflow**. You'll be prompted to choose `propose` (flag the week as pending) or `force` (run the actual reset). Use `force` if you need to execute the reset immediately.

To run locally (requires the env vars from GitHub Secrets):

```bash
cd scripts
npm install
# set FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_APP_ID
RESET_MODE=force node reset.js
```

Add `FORCE_RESET=1` to the environment if you need to re-run a reset that already ran today.

### View the weekly report

The report popup appears automatically the first time Victoria opens the app after each Monday reset. She can navigate between past weeks using the arrow buttons. To see it again later (or any time), open the app → tap **History** → tap the **⚙** tab → tap **View Report**.

### Add or edit a habit

Open the app → tap **History** → tap **MANAGE 🔒** → enter the passcode **1234** → select a habit from the left panel, or click **+ Add Habit**. From there you can edit thresholds, payouts, streak bonuses, cycle type, period sensitivity, and more. The Add Habit form has a category dropdown showing existing categories, with an option to type a new one.

### Use the Plan view

Tap the **Weekly** tab → tap the **Plan** button (sub-tab toggle). Each row is a habit; each column is a day (Mon–Sun). Tap a bubble to mark that you're planning to do the habit on that day. Bubbles are colored by which performance tier the running planned count would reach on each day. Tap a habit name to open a detail sheet where you can set a time estimate and toggle individual days. Use **Copy Last Week** to carry over last week's plan.

If Google Calendar events have been synced (via the GIS OAuth flow), the week's events appear below the grid as a scrollable agenda, and days with events show density bars under their column headers.

### Reorder today-view sections

Open the Manage panel (History tab → MANAGE 🔒 → passcode `1234`) → click **Layout** in the left nav → use the up/down arrows to rearrange categories, Seasonal Events, and Room Checks. The order syncs live across all devices.

### Customize the accent color (Vibe)

Tap **History** → tap the **⚙** tab → drag the **Hue** and **Intensity** sliders under "Customize the Vibe". The preview circle shows the current color. The choice is saved to `localStorage` and persists across sessions on that device. Tap **Reset to auto** to return to the time-of-day color animation.

### Enable a daily reminder

Tap **History** → tap the **⚙** tab → check **Enable daily reminder** and set a time. The app will fire a browser notification at that time on any day it's open. Permission must be granted in the browser the first time. The setting is per-device, stored in `localStorage`.

### Change Firebase credentials

Edit `Core/config.js` — all keys are centralized there. Also update the corresponding secrets in **GitHub repo Settings → Secrets and Variables → Actions** (`FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`).

### Give Victoria a token (excuse, streak reset, or mark-off)

Tokens are bought from the Star Shop (tap the ✨ stars in the header). Alternatively, in the Manage panel → Stars section, you can award stars directly and Victoria can then spend them in the shop. Tokens appear in the star balance doc and are consumed from habit cards on the Today tab.

---

## What's Most Likely to Break

### 1. The weekly reset didn't run (no balance update on Monday)

**Check:** GitHub → Actions tab → see if the Monday runs are there and what their status was. There are two runs: the "propose" at ~4am and the "force" at ~7pm (both Central time). If neither ran, the week's data wasn't scored.

**Common causes:**
- GitHub Actions was paused (repos with no activity for 60 days get their scheduled workflows disabled — re-enable in the Actions tab)
- A Firestore API key expired or was rotated and not updated in GitHub Secrets
- The `scripts/package.json` dependencies are outdated

**Fix:** Re-run the workflow manually from the Actions tab using `force` mode. If it fails, look at the logs for the specific error.

### 2. The app loads but shows no data / blank screen

**Check:** Open DevTools → Console tab for errors.

**Common causes:**
- Firebase project billing issue or quota exceeded (check Firebase console)
- `Core/config.js` has the wrong Firebase project ID or API key
- Service worker is serving a stale cached version — force-refresh with Ctrl+Shift+R

**Fix:** Try a hard refresh first. If the Firebase config has changed, update `Core/config.js` and redeploy.

### 3. Payout shown in the app doesn't match the reset's calculated balance

The app's "This Week's Balance" display and the reset script both call `computeWeeklyPayout()` from `Core/habits.js`. If they diverge after a code change, the logic in `habits.js` was changed and a caller wasn't updated (or vice versa). The architecture ensures all three callers (`render.js`, `manage-ui.js`, `Core/weeklyReset.js`) share a single function — divergence only happens if logic was moved out of `habits.js` without updating callers.

**Fix:** Check `Core/habits.js` `computeWeeklyPayout()` and verify all three callers are using the same function with the same arguments.

### 4. Google Calendar events not showing in the Plan view

**Common causes:**
- `GOOGLE_CALENDAR_CONFIG.clientId` is empty in `Core/config.js` — integration is disabled
- The device has not previously connected (no `localStorage.gcalConnected` flag) — there is currently no connect button in the UI; to force a sync you would need to temporarily restore the connect button or call `window.connectGoogleCalendar()` from the browser console
- The OAuth client in Google Cloud Console doesn't have `https://theironpika.github.io` as an authorized JavaScript origin
- The Google Calendar API is not enabled in the Google Cloud project

**Fix:** Check the browser console for OAuth errors. Verify the client ID and authorized origins in Google Cloud Console.

### 5. Reset propose/force flow confusion

The "propose" run at 4am only flips a flag (`pendingReset = true`) — it doesn't score anything. If you open the app between 4am and 7pm on Monday and see a pending reset prompt, that's expected. The actual scoring happens either when Victoria approves in the app (planned feature) or when the "force" run fires at 7pm. If you re-run the workflow manually and need to skip the idempotency guard, set `FORCE_RESET=1`.

---

## Glossary

| Term | Meaning |
|---|---|
| **Tier** | Victoria's performance level for a habit in a given week: Debt (below minimum), Low, Goal, or Bonus |
| **Payout** | The dollar amount earned (or deducted) for a habit's tier at the weekly reset |
| **Streak** | Consecutive weeks at Goal or above; breaks on any Low/Debt week |
| **Bad streak** | Consecutive weeks at Low or Debt; triggers a flat weekly penalty |
| **Streak bonus/penalty** | Flat per-week dollar amount added (good streak) or deducted (bad streak); capped by `streakCap` |
| **Bounty** | A one-time bonus (dollars, stars, and/or excuse tokens) set on a habit that fires when she hits Goal/Bonus that week, then clears automatically |
| **Stars** | In-app currency earned for hitting Goal/Bonus tiers; spent in the Star Shop |
| **Lucky draw** | A random bonus star awarded when tapping a bubble; odds scale by tier (Debt 2%, Low 5%, Goal 7%, Bonus 10%); max once per habit per day |
| **Excuse token** | Purchased from the Star Shop; freezes one habit for one week (no payout either direction, streak held) |
| **Streak reset token** | Purchased from the Star Shop; zeroes a habit's bad-streak counter without requiring a goal week |
| **Mark-off token** | Purchased from the Star Shop; synthetically adds +1 completion to a habit for the current day (appears as a grey bubble). Refunded if the bubble is later removed. |
| **Period protection** | When Victoria's period is active, period-sensitive habits skip negative payouts and streak penalties |
| **Cyclic habit** | A habit on a schedule (e.g., monthly) that only appears on the Today tab when it's due |
| **Late completion** | When a cyclic habit is completed after its due date; the positive payout is reduced by `weeksLate × streakPenaltyPer` |
| **Room check** | A daily tidiness check for each room; checking in streaks earns bonus payouts at reset |
| **Propose phase** | The 4am Monday GitHub Actions run that flags the week as ready for reset without changing any habit data |
| **Force phase** | The 7pm Monday GitHub Actions run that executes the actual reset if Victoria never approved in-app |
| **Weekly reset** | The automated Monday scoring process that tallies the week, awards stars, saves history, and resets counters; implemented in `Core/weeklyReset.js` |
| **Report popup** | The interactive summary card that auto-shows after each reset; navigable across past weeks |
| **Manage panel** | The admin/settings section of the app, behind passcode `1234`; accessed from the History tab via the "MANAGE 🔒" button; contains sub-sections: Habits, Add Habit, Events, Stars, Period, Layout, Streak $ |
| **History Settings (⚙)** | The Settings sub-tab within the History tab's chart selector; contains View Report, Customize Vibe, and Daily Reminder; no passcode required |
| **Customize Vibe** | Hue/saturation sliders in History → ⚙ that override the automatic time-of-day accent color; stored per device in localStorage |
| **Daily Reminder** | Browser notification feature in History → ⚙; fires once per day while the tab is open; stored per device in localStorage |
| **Section order** | The drag-reorderable order of categories, Seasonal Events, and Room Checks on the Today tab |
| **Plan view** | A weekly intent grid (Weekly tab → Plan) where Victoria marks which days she plans to do each habit; purely visual, never affects payouts or streaks |
| **Calendar events** | Events fetched from Google Calendar (or stored manually) and shown in the Planning agenda; synced to Firestore so they're visible across devices |
| **GIS** | Google Identity Services — the OAuth library used for browser-based Google Calendar sign-in |
| **PWA** | Progressive Web App — can be installed on a phone home screen and works offline |
