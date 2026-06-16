_Last updated 2026-06-15 by overnight automation (toolkit v1.0.0). Review before relying on it._

# VictoriaTracker — Owner's Guide

## What Is This?

VictoriaTracker is a personalized habit and household management app built for Victoria (managed by Drew). It's a Progressive Web App — meaning it installs on a phone like a native app — but it lives at a simple GitHub Pages URL and all its data is stored in the cloud.

The core idea: Victoria logs her habits each day by tapping bubbles. At the end of every week, the app automatically calculates a dollar payout based on how consistently she hit each habit, sends an email summary, and resets everything for the new week. The next time Victoria opens the app after a reset, an interactive report popup appears summarizing the just-completed week — it can be navigated back through past weeks and dismissed when done. Habits that are done consistently earn stars that can be spent in the Star Shop on custom rewards.

It's not a generic habit tracker. It has several interconnected systems:
- **Daily habit logging** with four performance tiers (Debt / Low / Goal / Bonus)
- **Weekly financial payouts** — real money, calculated automatically every Monday
- **Interactive weekly report popup** — auto-shows after each reset; browse past weeks; accessible any time via Manage → View Report
- **Star Shop** — earn stars for strong weeks, spend them on treats
- **Streak bonuses and penalties** — good streaks earn a flat bonus per week; bad streaks deduct a flat penalty per week
- **Bounties** — one-time bonus payouts/stars set on a habit; they fire when she hits Goal or Bonus that week and then clear automatically
- **Period protection** — sensitive habits automatically skip penalties during Victoria's period
- **Room checks** — household room tidiness tracked with streak bonuses
- **Seasonal events** — special date-range tasks like Spring Cleaning
- **Cyclic habits** — habits that only appear on schedule (monthly deep cleans, annual tasks, etc.)
- **Planning tab** — a weekly grid for pre-planning which days to tackle each habit, with a Google Calendar agenda alongside

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
   • config.js        — all keys, constants, Firestore paths
   • state.js         — in-memory app state
   • habits-data.js   — reads/writes Firestore, triggers re-render on change
   • planning.js      — weekly plan-ahead data (intent only, never touches history)
   • calendar.js      — calendar events synced from Google Calendar → Firestore
   • section-order.js — today-view section order, synced live
       │
       ▼
web/ui/ modules (DOM rendering)
   • render.js        — rebuilds the screen after every data change
   • planning-ui.js   — Planning tab: habit grid + calendar agenda
   • manage-ui.js     — settings split-panel + weekly report popup + forecast
   • google-calendar.js — Google Calendar OAuth sync
       │
       ▼
Firebase Firestore (cloud database)
   • 10 documents in the "system" collection
   • real-time sync: any change on one device appears on all others instantly
       │
Every Monday 9:00 AM UTC (4 AM Central):
       │
       ▼
GitHub Actions runs scripts/reset.js
   • computes final tiers and payouts (mirrors Core/habits.js exactly)
   • awards stars, bounties, and excuse tokens
   • applies streak bonuses/penalties; advances cycleNextDue for cyclic habits
   • saves a weekly snapshot to history
   • resets all habit counters to zero; clears bounty fields that fired
   • advances room check streaks; resets room marks
   • advances seasonal event payout watermark
   • sends the weekly email report via EmailJS
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

Go to the repo on GitHub → **Actions** tab → **Weekly Habit Reset** → **Run workflow**. This is useful for testing or if a Monday run failed.

To run locally (requires the env vars from GitHub Secrets):

```bash
cd scripts
npm install
# set FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_APP_ID,
#     EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY
node reset.js
```

Add `FORCE_RESET=1` to the environment if you need to re-run a reset that already ran today.

### View the weekly report

The report popup appears automatically the first time Victoria opens the app after each Monday reset. She can navigate between past weeks using the arrow buttons. To see it again later (or any time), open the app → tap **Manage** → enter passcode **1234** → click **View Report** in the left panel.

### Add or edit a habit

Open the app → tap the **Manage** tab → enter the passcode **1234** → select a habit from the left panel, or click **+ Add Habit**. From there you can edit thresholds, payouts, streak bonuses, cycle type, period sensitivity, and more.

### Use the Planning tab

Tap the **Planning** tab to see the week's habit grid. Each row is a habit; each column is a day (Mon–Sun). Tap a bubble to mark that you're planning to do the habit on that day. Bubbles are colored by which performance tier the planned-day running count would reach on each day. Tap a habit name to open a detail sheet where you can set a time estimate and toggle individual days. Use **Copy Last Week** to carry over last week's plan.

If Google Calendar is connected, the week's events appear below the grid as a scrollable agenda, and days with events show density bars under their column headers.

### Connect Google Calendar

Open the **Planning** tab → tap **Connect Google Calendar** (visible when `GOOGLE_CALENDAR_CONFIG.clientId` is set in `Core/config.js`). You'll be prompted to sign in with Google. The app fetches a 4-week window of events from your primary calendar and stores them in Firestore so they're visible cross-device. The connection token is browser-session only — you'll need to reconnect after closing the tab.

### Reorder today-view sections

Open the Manage panel (passcode `1234`) → click **Layout** in the left nav → use the up/down arrows to rearrange categories, Seasonal Events, and Room Checks. The order syncs live across all devices.

### Change Firebase or EmailJS credentials

Edit `Core/config.js` — all keys are centralized there. If changing the GitHub Actions reset, also update the corresponding secrets in **GitHub repo Settings → Secrets and Variables → Actions**.

---

## What's Most Likely to Break

### 1. The weekly reset didn't run (no email on Monday)

**Check:** GitHub → Actions tab → see if the Monday run is there and what its status was.

**Common causes:**
- GitHub Actions was paused (repos with no activity for 60 days get their scheduled workflows disabled — re-enable in the Actions tab)
- A Firestore API key or EmailJS secret expired or was rotated and not updated in GitHub Secrets
- The `scripts/package.json` dependencies are outdated

**Fix:** Re-run the workflow manually from the Actions tab. If it fails, look at the logs for the specific error.

### 2. The app loads but shows no data / blank screen

**Check:** Open DevTools → Console tab for errors.

**Common causes:**
- Firebase project billing issue or quota exceeded (check Firebase console)
- `Core/config.js` has the wrong Firebase project ID or API key
- Service worker is serving a stale cached version — force-refresh with Ctrl+Shift+R

**Fix:** Try a hard refresh first. If the Firebase config has changed, update `Core/config.js` and redeploy.

### 3. Email report not sending

**Check:** The GitHub Actions log for the reset job — it will show if the EmailJS call failed.

**Common causes:**
- EmailJS monthly email limit exceeded (free tier: 200/month)
- Template ID or Service ID changed in the EmailJS dashboard but not updated in GitHub Secrets
- `EMAILJS_PUBLIC_KEY` secret is wrong

**Fix:** Log in to EmailJS, verify the service/template IDs match `Core/config.js` and the GitHub Secrets.

### 4. Payout shown in the app doesn't match the email report

The app's "This Week's Balance" display and the reset script both call `computeWeeklyPayout()` from `Core/habits.js`. If they diverge after a code change, it means the logic in `habits.js` was changed but `reset.js` still calls it correctly (or vice versa). The architecture is designed so they share a single function — divergence only happens if someone moved logic out of `habits.js` without updating the callers.

**Fix:** Check `Core/habits.js` `computeWeeklyPayout()` and verify all three callers (`render.js`, `manage-ui.js`, `reset.js`) are using the same function with the same arguments.

### 5. Google Calendar events not showing in the Planning tab

**Common causes:**
- `GOOGLE_CALENDAR_CONFIG.clientId` is empty in `Core/config.js` — integration is disabled
- The OAuth client in Google Cloud Console doesn't have `https://theironpika.github.io` as an authorized JavaScript origin
- The Google Calendar API is not enabled in the Google Cloud project
- The user's browser session expired — reconnect by tapping "Connect Google Calendar" again

**Fix:** Check the browser console for OAuth errors. Verify the client ID and authorized origins in Google Cloud Console.

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
| **Excuse token** | A star-shop item that freezes one habit for one week (no payout either direction) |
| **Period protection** | When Victoria's period is active, period-sensitive habits skip negative payouts and streak penalties |
| **Cyclic habit** | A habit on a schedule (e.g., monthly) that only appears on the Today tab when it's due |
| **Late completion** | When a cyclic habit is completed after its due date; the positive payout is reduced by `weeksLate × streakPenaltyPer` |
| **Room check** | A daily tidiness check for each room; checking in streaks earns bonus payouts at reset |
| **Weekly reset** | The automated Monday job that scores the week, awards stars, saves history, and resets counters |
| **Report popup** | The interactive summary card that auto-shows after each reset; navigable across past weeks |
| **Manage panel** | The admin/settings section of the app, behind passcode `1234` |
| **Section order** | The drag-reorderable order of categories, Seasonal Events, and Room Checks on the Today tab |
| **Planning tab** | A weekly intent grid where Victoria marks which days she plans to do each habit; purely visual, never affects payouts or streaks |
| **Calendar events** | Events fetched from Google Calendar (or stored manually) and shown in the Planning agenda; synced to Firestore so they're visible across devices |
| **GIS** | Google Identity Services — the OAuth library used for browser-based Google Calendar sign-in |
| **PWA** | Progressive Web App — can be installed on a phone home screen and works offline |
