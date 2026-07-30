// ─────────────────────────────────────────────────────────────────────
// Core/weeklyReset.js
// Weekly reset orchestration — the single source of truth for "what
// happens at Monday reset". Shared by:
//   • scripts/reset.js        (unattended GitHub Action, Node + REST io)
//   • native WeeklyResetModal (Victoria's in-app approval, Firebase SDK io)
//
// Deliberately takes an injected `io = { readDoc, writeDoc }` instead of
// importing ./firebase.js directly — firebase.js uses browser/CDN or npm
// SDK imports that don't run under plain Node, so this file stays usable
// from the GitHub Action too. Both firebase.js implementations (web + the
// native npm one) already expose the same readDoc([col,id])/writeDoc
// signature, so the browser/native callers can just pass those straight
// through.
//
// Two phases, matching the "last chance to approve" flow:
//   proposeWeeklyReset — Monday 4am: flips reset_state.pendingReset so the
//     app can prompt Victoria. Makes NO other changes — nothing is paid
//     out, wiped, or snapshotted until executeWeeklyReset runs, so she can
//     still go fix last week's data first.
//   executeWeeklyReset — the actual reset: payouts, star awards, streak
//     updates, history snapshot, room/event reset, cycle advancement,
//     period flag cleanup. Runs either when she approves in-app, or from
//     the unattended force-fallback if she never does.
// ─────────────────────────────────────────────────────────────────────

import { getTier, computeWeeklyPayout, weekTotal, toCumulative } from './habits.js';
import { isCycleDue, isCyclic, cycleIntervalMs } from './cycles.js';
import { FIRESTORE_DOCS, HISTORY_MAX_WEEKS } from './config.js';

/** True if a reset already executed today — idempotency guard for both modes. */
export async function resetAlreadyHandledToday(io, now = new Date()) {
    const rs = (await io.readDoc(FIRESTORE_DOCS.RESET)) || {};
    return rs.lastWeeklyReset === now.toDateString();
}

/**
 * Monday 4am: mark a reset as pending approval. Idempotent — calling this
 * again while a reset is already pending is a no-op (doesn't restart her
 * snooze count). Returns true if it actually flipped the flag.
 */
export async function proposeWeeklyReset(io, now = new Date()) {
    const rs = (await io.readDoc(FIRESTORE_DOCS.RESET)) || {};
    if (rs.pendingReset) return false;
    await io.writeDoc(FIRESTORE_DOCS.RESET, {
        lastWeeklyReset: rs.lastWeeklyReset || null,
        pendingReset:    true,
        pendingSince:    now.getTime(),
        snoozeCount:     0,
        snoozedUntil:    null,
    });
    return true;
}

/**
 * The actual reset. Same math that used to live only in scripts/reset.js —
 * reads habits/rooms/events/period, computes payouts, awards stars, rolls
 * streaks, snapshots history, wipes the week, resets rooms, advances event
 * watermarks and cyclic due-dates, then clears the pending/approval state.
 * Returns a small summary for logging.
 */
export async function executeWeeklyReset(io, now = new Date()) {
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const dateStr = months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();
    const nowTs = now.getTime();

    console.log(`\n🔄 Victoria Tracker Weekly Reset — ${dateStr}`);

    // ── Load habits ──────────────────────────────────────────────────────
    const habitsDoc = await io.readDoc(FIRESTORE_DOCS.HABITS);
    let habits = (habitsDoc && habitsDoc.data) || [];

    // ── Load rooms ───────────────────────────────────────────────────────
    let rooms = [];
    try {
        const roomsDoc = await io.readDoc(FIRESTORE_DOCS.ROOMS);
        rooms = (roomsDoc && roomsDoc.rooms) || [];
    } catch (e) { console.warn('   ⚠️  Could not load rooms:', e.message); }

    // ── Load events ──────────────────────────────────────────────────────
    let events = [];
    try {
        const evDoc = await io.readDoc(FIRESTORE_DOCS.EVENTS);
        events = (evDoc && evDoc.events) || [];
    } catch (e) { console.warn('   ⚠️  Could not load events:', e.message); }

    // ── Load period state (drives period-protection gating) ────────────────
    let periodActive = false, periodWasThisWeek = false, periodData = null;
    try {
        periodData = await io.readDoc(FIRESTORE_DOCS.PERIOD);
        if (periodData) {
            periodActive      = !!periodData.active;
            periodWasThisWeek = !!periodData.periodWasThisWeek;
        }
    } catch (e) { console.warn('   ⚠️  Could not load period state:', e.message); }

    const isDormant     = h => !isCycleDue(h);
    const streakFrozenH = h => (periodActive || periodWasThisWeek) && !!h.periodSensitive;

    // ── Calculate payouts ────────────────────────────────────────────────
    let totalMoney = 0;
    habits.forEach(h => {
        if (isDormant(h) || h.excused) return;
        const r = computeWeeklyPayout(h, { periodActive, now: nowTs });
        totalMoney += r.total;
    });
    rooms.forEach(r => {
        if (!r.checked) return;
        totalMoney += Math.min((r.streak || 0) + 1, r.maxStreak || 0);
    });
    events.forEach(ev => {
        const unpaid = (ev.completions || 0) - (ev.lastPaidCompletions || 0);
        if (unpaid <= 0) return;
        totalMoney += unpaid * (ev.payout || 0);
    });
    console.log(`💰 Total balance: ${(totalMoney < 0 ? '-$' : '+$') + Math.abs(totalMoney).toFixed(2)}`);

    // ── Award stars ──────────────────────────────────────────────────────
    let starDoc = { balance: 0, spent: 0, items: [], log: [], excuseTokens: 0 };
    try {
        const sd = await io.readDoc(FIRESTORE_DOCS.STARS);
        if (sd) starDoc = sd;
    } catch (e) { /* first run */ }

    let totalStarsEarned = 0, totalExcuseAwarded = 0;
    habits.forEach(h => {
        if (isDormant(h) || h.excused) return;
        const hist = (h.history || []).slice(0, 7);
        const cur  = weekTotal(hist);
        const tier = getTier(h, cur);
        const newStreak = (tier === 'goal' || tier === 'bonus') ? (h.streak || 0) + 1 : 0;
        let earned = 0, reasons = [];
        if (tier === 'goal'  && (h.starGoal  || 0) > 0) { earned += h.starGoal;  reasons.push(h.name + ' Goal'); }
        if (tier === 'bonus' && (h.starBonus || 0) > 0) { earned += h.starBonus; reasons.push(h.name + ' Bonus'); }
        if (newStreak >= 2   && (h.starStreak|| 0) > 0) { earned += h.starStreak;reasons.push(h.name + ' Streak'); }
        if (h.bountyActive && (tier === 'goal' || tier === 'bonus') && (h.bountyStars || 0) > 0) {
            earned += h.bountyStars; reasons.push(h.name + ' Bounty 🏆');
        }
        if (earned > 0) {
            totalStarsEarned += earned;
            starDoc.log = [{ ts: Date.now(), type: 'earn', amount: earned, reason: reasons.join(' + ') },
                           ...(starDoc.log || [])].slice(0, 200);
        }
        if (h.bountyActive && (tier === 'goal' || tier === 'bonus') && (h.bountyExcuseTokens || 0) > 0) {
            const tokens = h.bountyExcuseTokens;
            totalExcuseAwarded += tokens;
            starDoc.excuseTokens = (starDoc.excuseTokens || 0) + tokens;
            starDoc.log = [{ ts: Date.now(), type: 'excuseToken', amount: tokens, reason: h.name + ' Bounty 🏆' },
                           ...(starDoc.log || [])].slice(0, 200);
        }
    });
    const starDocChanged = totalStarsEarned > 0 || totalExcuseAwarded > 0;
    if (totalStarsEarned > 0) starDoc.balance = (starDoc.balance || 0) + totalStarsEarned;
    if (starDocChanged) {
        await io.writeDoc(FIRESTORE_DOCS.STARS, starDoc);
        console.log(`   ✅ Awarded ${totalStarsEarned} stars, ${totalExcuseAwarded} excuse token(s)`);
    }

    // ── Update streaks ───────────────────────────────────────────────────
    // A streak-reset token used this week (h.badStreakResetTs within the past
    // 7 days) keeps badStreak at 0 even if she didn't hit goal — the flag is
    // then cleared so next week ticks normally.
    const tokenResetCutoff = nowTs - 7 * 86400000;
    habits = habits.map(h => {
        if (isDormant(h) || h.excused || streakFrozenH(h)) return { ...h };
        const hist = (h.history || []).slice(0, 7);
        const cur  = weekTotal(hist);
        const tier = getTier(h, cur);
        const isGood = tier === 'goal' || tier === 'bonus';
        const tokenResetThisWeek = !!h.badStreakResetTs && h.badStreakResetTs >= tokenResetCutoff;
        let streak, badStreak;
        if (isCyclic(h)) {
            streak = isGood ? (h.streak || 0) + 1 : (h.streak || 0);
            badStreak = 0;
        } else if (tokenResetThisWeek) {
            streak = isGood ? (h.streak || 0) + 1 : (h.streak || 0);
            badStreak = 0;
        } else {
            streak    = isGood ? (h.streak    || 0) + 1 : 0;
            badStreak = !isGood ? (h.badStreak || 0) + 1 : 0;
        }
        const best = Math.max(streak, h.bestStreak || 0);
        const updated = { ...h, streak, badStreak, bestStreak: best };
        if (updated.badStreakResetTs) delete updated.badStreakResetTs;
        return updated;
    });

    // ── Save history snapshot ────────────────────────────────────────────
    let histDoc = { weeks: [] };
    try {
        const hd = await io.readDoc(FIRESTORE_DOCS.HISTORY);
        if (hd) histDoc = hd;
    } catch (e) { /* first run */ }

    const entry = {
        id:           String(Date.now()),
        weekEnding:   dateStr,
        timestamp:    Date.now(),
        totalBalance: totalMoney,
        habits: habits.filter(h => !isDormant(h)).map(h => {
            const hist = (h.history || []).slice(0, 7);
            const r = computeWeeklyPayout(h, { periodActive, now: nowTs });
            return { id: h.id, name: h.name, icon: h.icon, cat: h.cat,
                     tier: r.tier, payout: r.base, history: toCumulative(hist),
                     thresh: { punish: h.punish || 1, low: h.low || 3, goal: h.goal || 5, bonus: h.bonus || 7 },
                     excused: !!h.excused,
                     periodProtected: r.periodProtected };
        })
    };
    let weeks = [entry, ...(histDoc.weeks || [])].slice(0, HISTORY_MAX_WEEKS);
    await io.writeDoc(FIRESTORE_DOCS.HISTORY, { weeks });
    console.log('   ✅ History saved');

    // ── Wipe history, clear bounties, advance cycles ─────────────────────
    habits = habits.map(h => {
        if (isDormant(h)) return { ...h, history: [0, 0, 0, 0, 0, 0, 0], excused: false, markOffDays: {} };

        const hist3 = (h.history || []).slice(0, 7);
        const cur3  = weekTotal(hist3);
        const tier3 = getTier(h, cur3);
        const bountyTriggered3 = h.bountyActive && (tier3 === 'goal' || tier3 === 'bonus');

        let updated = { ...h, history: [0, 0, 0, 0, 0, 0, 0], excused: false, markOffDays: {} };
        if (bountyTriggered3) {
            delete updated.bountyActive;
            delete updated.bountyDollars;
            delete updated.bountyStars;
            delete updated.bountyExcuseTokens;
            delete updated.bountyNote;
        }
        if (h.cycleType && h.cycleType !== 'none' && (tier3 === 'goal' || tier3 === 'bonus')) {
            updated.cycleNextDue = Date.now() + cycleIntervalMs(h);
        }
        return updated;
    });
    await io.writeDoc(FIRESTORE_DOCS.HABITS, { data: habits });

    // ── Reset rooms: advance streaks for cleaned rooms, clear all marks ──
    if (rooms.length) {
        const resetRooms = rooms.map(r => ({
            ...r,
            streak:  r.checked ? Math.min((r.streak || 0) + 1, r.maxStreak || 0) : 0,
            checked: false
        }));
        await io.writeDoc(FIRESTORE_DOCS.ROOMS, { rooms: resetRooms });
        console.log('   ✅ Rooms reset');
    }

    // ── Advance event payout watermark ───────────────────────────────────
    if (events.length) {
        const paidEvents = events.map(ev => ({ ...ev, lastPaidCompletions: ev.completions || 0 }));
        await io.writeDoc(FIRESTORE_DOCS.EVENTS, { events: paidEvents });
        console.log('   ✅ Event payout watermark advanced');
    }

    // ── Mark reset done, clear pending/approval/snooze state ─────────────
    await io.writeDoc(FIRESTORE_DOCS.RESET, {
        lastWeeklyReset: now.toDateString(),
        pendingReset:    false,
        pendingSince:    null,
        snoozeCount:     0,
        snoozedUntil:    null,
    });

    // ── Clear period week flags (only if period already ended) ───────────
    if (periodData && !periodActive) {
        await io.writeDoc(FIRESTORE_DOCS.PERIOD, {
            active:            false,
            startTs:           null,
            startDayIdx:       null,
            periodWasThisWeek: false,
            history:           periodData.history || []
        });
    }

    console.log(`✅ Reset complete! Balance: ${totalMoney.toFixed(2)}, Stars: ${totalStarsEarned}, Habits: ${habits.length}`);
    return { totalMoney, starsEarned: totalStarsEarned, habitsReset: habits.length };
}
