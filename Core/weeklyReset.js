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

import { getTier, computeWeeklyPayout, weekTotal, toCumulative, getStarsEarned } from './habits.js';
import { isCycleDue, isCyclic, cycleIntervalMs } from './cycles.js';
import { advanceLockOnReset } from './locks.js';
import { FIRESTORE_DOCS, HISTORY_MAX_WEEKS, STAR_LOG_MAX } from './config.js';
import { startOfWeek } from './utils.js';
// Pure math only — category-payouts.js deliberately avoids ./firebase.js so
// this file still runs under plain Node in the GitHub Action. Persistence for
// that feature lives in category-config.js, which is NOT imported here.
import { computeAllCategoryResults, rewardIsEmpty, TIER_LABEL } from './category-payouts.js';

/**
 * True if a reset already executed for the week containing `now` — the
 * idempotency guard for both modes.
 *
 * Compares WEEKS, not days. It used to be `rs.lastWeeklyReset === now.toDateString()`,
 * an exact string match between a date the app writes in device-LOCAL time and
 * a date the GitHub Action evaluates in UTC. The force cron runs at
 * `0 0 * * 2` — Tuesday 00:00 UTC, which is Monday 19:00 Central — so the two
 * never matched on that path and the guard contributed nothing there. (No
 * double payout resulted, because scripts/reset.js bails on `!rs.pendingReset`
 * first and executeWeeklyReset clears that flag; this guard was simply inert.)
 *
 * A reset is a WEEKLY event, so the week is the right granularity, and
 * startOfWeek() collapses the local/UTC skew: Monday 19:00 Central and
 * Tuesday 00:00 UTC land in the same Monday-anchored week. The stored format
 * is unchanged (toDateString), so isResetOverdue/isResetPromptDue in
 * resetState.js keep parsing it exactly as before.
 *
 * Set FORCE_RESET=1 to deliberately run a second reset inside one week.
 */
export async function resetAlreadyHandledThisWeek(io, now = new Date()) {
    const rs = (await io.readDoc(FIRESTORE_DOCS.RESET)) || {};
    if (!rs.lastWeeklyReset) return false;
    const last = new Date(rs.lastWeeklyReset);
    if (isNaN(last.getTime())) return false;
    return startOfWeek(last).getTime() === startOfWeek(now).getTime();
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
 *
 * ATOMICITY: every read happens first, then everything is computed, then all
 * seven writes are committed together through io.writeAll(). They used to be
 * seven separate awaited writes, with the reset_state doc — the only thing
 * resetAlreadyHandledThisWeek() checks — written LAST. Any failure before that
 * left the guard false while part of the work had already landed, and the
 * approval modal tells her to try again: a retry after the stars write but
 * before the habits wipe re-awarded every star AND prepended a second copy of
 * the week, which getAllTimeTotal(), the earnings achievements and the streak
 * scan all count as real. Committing as one batch means a failed reset changes
 * nothing at all, so retrying is genuinely safe.
 *
 * io.writeAll is optional — callers that don't provide it fall back to the old
 * sequential writes, so an un-updated adapter still works (just without the
 * atomicity guarantee).
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

    // ── Load category payout config ──────────────────────────────────────
    let categoryConfig = {};
    try {
        const catDoc = await io.readDoc(FIRESTORE_DOCS.CATEGORIES);
        categoryConfig = (catDoc && catDoc.categories) || {};
    } catch (e) { console.warn('   ⚠️  Could not load category config:', e.message); }

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

    // ── Load weekly history ──────────────────────────────────────────────
    // Read UP HERE, not just before the snapshot is written, because
    // getStarsEarned() now derives the streak from it rather than from the
    // stored habit.streak counter. At this point it does NOT yet contain the
    // week being closed, which is exactly what that call wants: the streak
    // through LAST week, to which it adds this one.
    let histDoc = { weeks: [] };
    try {
        const hd = await io.readDoc(FIRESTORE_DOCS.HISTORY);
        if (hd) histDoc = hd;
    } catch (e) { /* first run */ }
    const priorWeeks = histDoc.weeks || [];

    // ── Calculate payouts ────────────────────────────────────────────────
    let totalMoney = 0;
    habits.forEach(h => {
        if (isDormant(h) || h.excused) return;
        const r = computeWeeklyPayout(h, { periodActive, periodWasThisWeek, now: nowTs });
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

    // ── Category-wide payouts ────────────────────────────────────────────
    // Computed ONCE here and reused for money, stars/tokens and the history
    // snapshot, so those three can't disagree. The tier rule (lowest tier
    // among counting habits; resting/protected/dormant habits are neutral)
    // lives in category-payouts.js — do not re-implement it here.
    const categoryResults = computeAllCategoryResults(habits, {
        config: categoryConfig, periodActive, periodWasThisWeek,
    });
    categoryResults.forEach(r => { totalMoney += r.total || 0; });
    const paidCategories = categoryResults.filter(r => r.tier && !rewardIsEmpty(r.reward));
    if (paidCategories.length) {
        console.log(`   📂 ${paidCategories.length} category payout(s): ` +
            paidCategories.map(r => `${r.cat}@${r.tier}`).join(', '));
    }

    console.log(`💰 Total balance: ${(totalMoney < 0 ? '-$' : '+$') + Math.abs(totalMoney).toFixed(2)}`);

    // ── Award stars ──────────────────────────────────────────────────────
    // markOffTokens belongs in this default: writeDoc is a FULL overwrite
    // (firebase.js setDoc, merge:false), so on the first-run path where the
    // stars doc doesn't exist yet, writing a default that omits the field
    // would silently drop her Day Pass balance. Masked until now only because
    // `{ ...sd }` copies it off an existing doc.
    let starDoc = { balance: 0, spent: 0, items: [], log: [],
                    excuseTokens: 0, streakResetTokens: 0, markOffTokens: 0 };
    try {
        const sd = await io.readDoc(FIRESTORE_DOCS.STARS);
        // Copy, don't alias: balance/log/excuseTokens are mutated below, and if
        // an io adapter ever returned a shared or cached object (the SDK and
        // REST ones both return fresh ones today) those edits would survive a
        // failed commit and be re-applied on the retry — exactly the
        // double-award this batch is here to prevent.
        if (sd) starDoc = { ...sd };
    } catch (e) { /* first run */ }

    let totalStarsEarned = 0, totalExcuseAwarded = 0, totalStreakResetAwarded = 0,
        totalMarkOffAwarded = 0;
    habits.forEach(h => {
        if (isDormant(h) || h.excused) return;
        const tier = getTier(h, weekTotal(h.history));
        // The goal/bonus/streak rule lives in habits.js getStarsEarned() — this
        // used to re-implement it inline, against that file's own "change it
        // HERE, don't re-implement" rule, and the two had already drifted on
        // the streak reason string. Bounty stars stay here because the bounty
        // flags they depend on are cleared further down.
        // priorWeeks, not the stored counter — see habits.js getStarsEarned.
        let { earned, reasons } = getStarsEarned(h, { weeklyHistory: priorWeeks });
        if (h.bountyActive && (tier === 'goal' || tier === 'bonus') && (h.bountyStars || 0) > 0) {
            earned += h.bountyStars;
            reasons = [...reasons, h.name + ' Bounty 🏆'];
        }
        if (earned > 0) {
            totalStarsEarned += earned;
            starDoc.log = [{ ts: Date.now(), type: 'earn', amount: earned, reason: reasons.join(' + ') },
                           ...(starDoc.log || [])].slice(0, STAR_LOG_MAX);
        }
        if (h.bountyActive && (tier === 'goal' || tier === 'bonus') && (h.bountyExcuseTokens || 0) > 0) {
            const tokens = h.bountyExcuseTokens;
            totalExcuseAwarded += tokens;
            starDoc.excuseTokens = (starDoc.excuseTokens || 0) + tokens;
            starDoc.log = [{ ts: Date.now(), type: 'excuseToken', amount: tokens, reason: h.name + ' Bounty 🏆' },
                           ...(starDoc.log || [])].slice(0, STAR_LOG_MAX);
        }
        if (h.bountyActive && (tier === 'goal' || tier === 'bonus') && (h.bountyStreakResetTokens || 0) > 0) {
            const tokens = h.bountyStreakResetTokens;
            totalStreakResetAwarded += tokens;
            starDoc.streakResetTokens = (starDoc.streakResetTokens || 0) + tokens;
            starDoc.log = [{ ts: Date.now(), type: 'streakResetToken', amount: tokens, reason: h.name + ' Bounty 🏆' },
                           ...(starDoc.log || [])].slice(0, STAR_LOG_MAX);
        }
    });

    // ── Category stars + tokens ──────────────────────────────────────────
    // Same categoryResults computed above for the money, so the two can't
    // disagree about which categories paid. Day Passes are awarded here for
    // the first time anywhere in the reset — nothing else grants them.
    // TIER_LABEL comes from category-payouts.js — a local copy here said
    // 'Punish' where the shared one says 'Debt', which would have surfaced as
    // two different names for one tier the moment a punish/low tier carried
    // stars. (Unreachable today: readReward now zeroes non-dollar rewards on
    // those tiers, so this reason string is never persisted for them.)
    categoryResults.forEach(r => {
        if (!r.tier) return;                       // nothing counted this week
        const { stars, restWeek, dayPass, freshStart } = r.reward;
        const why = `${r.cat} category — all at ${TIER_LABEL[r.tier]} 📂`;
        const log = (type, amount) => {
            starDoc.log = [{ ts: Date.now(), type, amount, reason: why },
                           ...(starDoc.log || [])].slice(0, STAR_LOG_MAX);
        };
        if (stars > 0) {
            totalStarsEarned += stars;
            log('earn', stars);
        }
        if (restWeek > 0) {
            totalExcuseAwarded += restWeek;
            starDoc.excuseTokens = (starDoc.excuseTokens || 0) + restWeek;
            log('excuseToken', restWeek);
        }
        if (freshStart > 0) {
            totalStreakResetAwarded += freshStart;
            starDoc.streakResetTokens = (starDoc.streakResetTokens || 0) + freshStart;
            log('streakResetToken', freshStart);
        }
        if (dayPass > 0) {
            totalMarkOffAwarded += dayPass;
            starDoc.markOffTokens = (starDoc.markOffTokens || 0) + dayPass;
            log('markOffToken', dayPass);
        }
    });

    // Every write below is staged here and committed as ONE batch at the end.
    const writes = [];

    // totalMarkOffAwarded belongs in this test: a category configured to pay
    // ONLY Day Passes would otherwise mutate starDoc and never write it.
    const starDocChanged = totalStarsEarned > 0 || totalExcuseAwarded > 0
                        || totalStreakResetAwarded > 0 || totalMarkOffAwarded > 0;
    if (totalStarsEarned > 0) starDoc.balance = (starDoc.balance || 0) + totalStarsEarned;
    if (starDocChanged) {
        writes.push([FIRESTORE_DOCS.STARS, starDoc]);
        console.log(`   ✅ Awarded ${totalStarsEarned} stars, ${totalExcuseAwarded} Rest Week(s), ` +
                    `${totalStreakResetAwarded} Fresh Start(s), ${totalMarkOffAwarded} Day Pass(es)`);
    }

    // ── Update streaks ───────────────────────────────────────────────────
    // NOTE: h.streak is no longer what the star payout reads — getStarsEarned()
    // derives that from weekly_history (2026-09-04). The counter is still rolled
    // here because bestStreak is computed from it and the Streak $ panel shows
    // it, but if it ever disagrees with computeStreaksFromHistory(), history
    // wins. Don't reintroduce a payout that reads this field.
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
    // histDoc was read at the top — getStarsEarned needs it before this point.
    const entry = {
        id:           String(Date.now()),
        weekEnding:   dateStr,
        timestamp:    Date.now(),
        totalBalance: totalMoney,
        habits: habits.filter(h => !isDormant(h)).map(h => {
            const hist = (h.history || []).slice(0, 7);
            const r = computeWeeklyPayout(h, { periodActive, periodWasThisWeek, now: nowTs });
            // Bounty as it SETTLED this week. Snapshotted for exactly the same
            // reason `categories` is: the wipe below deletes the bounty fields
            // once one pays, so a report reading them off the live habit shows
            // a currently-armed bounty on every past week and never on the week
            // that actually paid it. Absent on weeks where none triggered (and
            // on every week predating this), which readers must treat as "no
            // bounty" rather than "unknown".
            const bountyPaid = !!h.bountyActive && (r.tier === 'goal' || r.tier === 'bonus');
            return { id: h.id, name: h.name, icon: h.icon, cat: h.cat,
                     // `payout` is the BASE only, kept as-is so existing rows
                     // keep meaning what they always meant. `total` is the real
                     // figure — base + streak + bounty — which is what
                     // totalBalance sums, so Top Earners can stop under-reporting.
                     tier: r.tier, payout: r.base, total: r.total,
                     history: toCumulative(hist),
                     thresh: { punish: h.punish || 1, low: h.low || 3, goal: h.goal || 5, bonus: h.bonus || 7 },
                     excused: !!h.excused,
                     periodProtected: r.periodProtected,
                     ...(bountyPaid ? { bounty: {
                         dollars:    h.bountyDollars           || 0,
                         stars:      h.bountyStars             || 0,
                         restWeek:   h.bountyExcuseTokens      || 0,
                         freshStart: h.bountyStreakResetTokens || 0,
                     } } : {}) };
        }),
        // Settled category results. Snapshotted rather than re-derived at read
        // time because the config can change after the week closes — the same
        // trap bounties fall into, where the reset deletes the bounty fields
        // and the report silently stops showing them.
        // paidCategories, not every scored category: an unconfigured category
        // still resolves to a tier, and snapshotting those would put a
        // zero-value row in the report and grow the history doc for nothing.
        categories: paidCategories
            .map(r => ({ cat: r.cat, tier: r.tier,
                         counting: r.counting.length, atTier: r.atTier,
                         dollars: r.reward.dollars, stars: r.reward.stars,
                         restWeek: r.reward.restWeek, dayPass: r.reward.dayPass,
                         freshStart: r.reward.freshStart }))
    };
    let weeks = [entry, ...(histDoc.weeks || [])].slice(0, HISTORY_MAX_WEEKS);
    writes.push([FIRESTORE_DOCS.HISTORY, { weeks }]);
    console.log('   ✅ History staged');

    // ── Wipe history, clear bounties, advance cycles ─────────────────────
    habits = habits.map(h => {
        // Task locks re-arm on the reset clock even while dormant, so a
        // cyclic habit can't come back due and silently already-open.
        const lockAdv = advanceLockOnReset(h);
        if (isDormant(h)) return { ...h, history: [0, 0, 0, 0, 0, 0, 0], excused: false, markOffDays: {}, ...lockAdv };

        const hist3 = (h.history || []).slice(0, 7);
        const cur3  = weekTotal(hist3);
        const tier3 = getTier(h, cur3);
        const bountyTriggered3 = h.bountyActive && (tier3 === 'goal' || tier3 === 'bonus');

        let updated = { ...h, history: [0, 0, 0, 0, 0, 0, 0], excused: false, markOffDays: {}, ...lockAdv };
        if (bountyTriggered3) {
            delete updated.bountyActive;
            delete updated.bountyDollars;
            delete updated.bountyStars;
            delete updated.bountyExcuseTokens;
            delete updated.bountyStreakResetTokens;
            delete updated.bountyNote;
        }
        if (h.cycleType && h.cycleType !== 'none' && (tier3 === 'goal' || tier3 === 'bonus')) {
            updated.cycleNextDue = Date.now() + cycleIntervalMs(h);
        }
        return updated;
    });
    writes.push([FIRESTORE_DOCS.HABITS, { data: habits }]);

    // ── Reset rooms: advance streaks for cleaned rooms, clear all marks ──
    if (rooms.length) {
        const resetRooms = rooms.map(r => ({
            ...r,
            streak:  r.checked ? Math.min((r.streak || 0) + 1, r.maxStreak || 0) : 0,
            checked: false
        }));
        writes.push([FIRESTORE_DOCS.ROOMS, { rooms: resetRooms }]);
        console.log('   ✅ Rooms staged');
    }

    // ── Advance event payout watermark ───────────────────────────────────
    if (events.length) {
        const paidEvents = events.map(ev => ({ ...ev, lastPaidCompletions: ev.completions || 0 }));
        writes.push([FIRESTORE_DOCS.EVENTS, { events: paidEvents }]);
        console.log('   ✅ Event payout watermark staged');
    }

    // ── Mark reset done, clear pending/approval/snooze state ─────────────
    writes.push([FIRESTORE_DOCS.RESET, {
        lastWeeklyReset: now.toDateString(),
        pendingReset:    false,
        pendingSince:    null,
        snoozeCount:     0,
        snoozedUntil:    null,
    }]);

    // ── Clear period week flags (only if period already ended) ───────────
    if (periodData && !periodActive) {
        writes.push([FIRESTORE_DOCS.PERIOD, {
            active:            false,
            startTs:           null,
            startDayIdx:       null,
            periodWasThisWeek: false,
            history:           periodData.history || []
        }]);
    }

    // ── Commit ───────────────────────────────────────────────────────────
    // One atomic batch: the whole week closes out or nothing does. The
    // sequential fallback keeps an adapter without writeAll working — it just
    // can't promise all-or-nothing, so it re-exposes the partial-reset window.
    if (typeof io.writeAll === 'function') {
        await io.writeAll(writes);
    } else {
        console.warn('   ⚠️  io.writeAll not provided — falling back to non-atomic sequential writes');
        for (const [docPath, data] of writes) await io.writeDoc(docPath, data);
    }

    console.log(`✅ Reset complete! Balance: ${totalMoney.toFixed(2)}, Stars: ${totalStarsEarned}, Habits: ${habits.length}`);
    return { totalMoney, starsEarned: totalStarsEarned, habitsReset: habits.length };
}
