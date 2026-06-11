// Victoria Tracker — Weekly Reset Script
// Runs via GitHub Actions every Monday at 4am Central
// Reads habits from Firebase, calculates tiers/payouts/streaks,
// saves history snapshot, sends email report, wipes history.
// Also pays out + resets the room-check tracker and processes bounties,
// mirroring the live UI's cycle gating and period protection so the
// reset and on-screen balance agree.

// Note: no firebase-admin here on purpose — the script authenticates with
// FIREBASE_API_KEY via the REST API helpers below, not a service account.
import fetch from 'node-fetch';

// Single source of truth for per-habit payout math. Same module the browser
// uses, imported here so the headline, Streak $ panel, and Monday reset can
// never silently disagree on what a week is worth.
import { getTier, computeWeeklyPayout } from '../Core/habits.js';
import { isCycleDue, isCyclic, cycleIntervalMs as _cycleIntervalMs } from '../Core/cycles.js';

// ── Firebase init (uses REST API key for Firestore access) ──────────────────
const PROJECT_ID  = process.env.FIREBASE_PROJECT_ID;
const API_KEY     = process.env.FIREBASE_API_KEY;
const BASE_URL    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function firestoreGet(path) {
    const res = await fetch(`${BASE_URL}/${path}?key=${API_KEY}`);
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
}

async function firestoreSet(path, data) {
    const body = toFirestoreDoc(data);
    const res  = await fetch(`${BASE_URL}/${path}?key=${API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`SET ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
}

// ── Firestore value converters ───────────────────────────────────────────────
function toFirestoreDoc(obj) {
    return { fields: toFields(obj) };
}

function toFields(obj) {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
        fields[k] = toValue(v);
    }
    return fields;
}

function toValue(v) {
    if (v === null || v === undefined)   return { nullValue: null };
    if (typeof v === 'boolean')          return { booleanValue: v };
    if (typeof v === 'number') {
        if (Number.isInteger(v))         return { integerValue: String(v) };
        return { doubleValue: v };
    }
    if (typeof v === 'string')           return { stringValue: v };
    if (Array.isArray(v))                return { arrayValue: { values: v.map(toValue) } };
    if (typeof v === 'object')           return { mapValue: { fields: toFields(v) } };
    return { stringValue: String(v) };
}

function fromValue(v) {
    if ('nullValue'    in v) return null;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue'  in v) return Number(v.doubleValue);
    if ('stringValue'  in v) return v.stringValue;
    if ('arrayValue'   in v) return (v.arrayValue.values || []).map(fromValue);
    if ('mapValue'     in v) {
        const obj = {};
        for (const [k, fv] of Object.entries(v.mapValue.fields || {})) {
            obj[k] = fromValue(fv);
        }
        return obj;
    }
    return null;
}

function fromDoc(doc) {
    const obj = {};
    for (const [k, v] of Object.entries(doc.fields || {})) {
        obj[k] = fromValue(v);
    }
    return obj;
}

// Local re-export so other helpers in this file can reference cycleIntervalMs
// without an underscore. (The import alias keeps the import line readable.)
const cycleIntervalMs = _cycleIntervalMs;

// ── Main reset ───────────────────────────────────────────────────────────────
async function runReset() {
    const now    = new Date();
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const dateStr = months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();

    console.log(`\n🔄 Victoria Tracker Weekly Reset — ${dateStr}`);
    console.log('─'.repeat(50));

    // ── Idempotency guard ────────────────────────────────────────────────────
    // Reset is unattended and moves real money. If the job is re-triggered
    // (manual workflow_dispatch, retry, local test) and lastWeeklyReset is
    // already today, bail without paying anything. Set FORCE_RESET=1 to
    // override (e.g. you reset a doc by hand and need to re-run).
    try {
        const stateDoc = await firestoreGet('system/reset_state');
        const last     = fromDoc(stateDoc).lastWeeklyReset;
        if (last && last === now.toDateString() && process.env.FORCE_RESET !== '1') {
            console.log(`⚠️  Reset already ran today (${last}). Skipping.`);
            console.log('   Set FORCE_RESET=1 to override.');
            return;
        }
    } catch (e) {
        // First run / no state doc — proceed normally.
    }

    // ── Load habits ──────────────────────────────────────────────────────────
    console.log('📥 Loading habits from Firebase...');
    const habitsDoc = await firestoreGet('system/habits_list');
    let habits      = fromDoc(habitsDoc).data || [];
    console.log(`   Found ${habits.length} habits`);

    // ── Load rooms (room-check housekeeping tracker) ─────────────────────────
    let rooms = [];
    try {
        const roomsDoc = await firestoreGet('system/rooms_data');
        rooms = fromDoc(roomsDoc).rooms || [];
        console.log(`   Found ${rooms.length} rooms`);
    } catch (e) { console.warn('   ⚠️  Could not load rooms:', e.message); }

    // ── Load events (seasonal event payouts) ─────────────────────────────────
    let events = [];
    try {
        const evDoc = await firestoreGet('system/seasonal_events');
        events = fromDoc(evDoc).events || [];
        console.log(`   Found ${events.length} events`);
    } catch (e) { console.warn('   ⚠️  Could not load events:', e.message); }

    // ── Load period state (drives period-protection gating) ──────────────────
    // Mirrors the live UI: when active, periodSensitive habits get zero punish
    // and skip bad-streak penalties. When active OR periodWasThisWeek, their
    // streak/badStreak are frozen.
    let periodActive       = false;
    let periodWasThisWeek  = false;
    let periodData         = null;
    try {
        const periodDoc = await firestoreGet('system/period_data');
        periodData      = fromDoc(periodDoc);
        periodActive       = !!periodData.active;
        periodWasThisWeek  = !!periodData.periodWasThisWeek;
        console.log(`   Period state: active=${periodActive}, wasThisWeek=${periodWasThisWeek}`);
    } catch (e) { console.warn('   ⚠️  Could not load period state:', e.message); }

    // Helpers for per-habit gating
    const isDormant         = h => !isCycleDue(h);
    const periodProtectedH  = h => periodActive && !!h.periodSensitive;
    const streakFrozenH     = h => (periodActive || periodWasThisWeek) && !!h.periodSensitive;

    // ── Calculate payouts & report lines ────────────────────────────────────
    let totalMoney = 0;
    let reportLines = [];

    const nowTs = Date.now();
    habits.forEach(h => {
        if (isDormant(h)) {
            // Cyclic habit not yet due — hidden from live UI, so ignore here too.
            reportLines.push(`${h.icon} ${h.name}: DORMANT (cyclic, not due)`);
            return;
        }
        if (h.excused) { reportLines.push(`${h.icon} ${h.name}: EXCUSED`); return; }

        // Single source of truth — see Core/habits.js computeWeeklyPayout.
        const r = computeWeeklyPayout(h, { periodActive, now: nowTs });
        totalMoney += r.total;

        const tierLabel = { punish:'DEBT', low:'LOW', goal:'GOAL', bonus:'BONUS' }[r.tier];
        const sign = r.total < 0 ? '-$' : '+$';
        const bountyTriggered = h.bountyActive && (r.tier === 'goal' || r.tier === 'bonus');
        const bountyParts = [];
        if (bountyTriggered && (h.bountyDollars || 0) > 0)      bountyParts.push(`+$${h.bountyDollars.toFixed(2)}`);
        if (bountyTriggered && (h.bountyExcuseTokens || 0) > 0) bountyParts.push(`🎫×${h.bountyExcuseTokens}`);
        const bountyNote    = bountyParts.length ? ` 🏆 ${bountyParts.join(' ')} bounty` : '';
        const protectedNote = r.periodProtected ? ' 🩸 period-protected' : '';
        const lateNote      = r.lateReduction > 0 ? ` ⏰ ${r.weeksLate}w late (-$${r.lateReduction.toFixed(2)})` : '';
        reportLines.push(`${h.icon} ${h.name}: ${tierLabel} (${sign}${Math.abs(r.total).toFixed(2)})${bountyNote}${protectedNote}${lateNote}`);
    });

    // ── Room payouts (each cleaned room earns min(streak+1, maxStreak)) ──────
    rooms.forEach(r => {
        if (!r.checked) return;
        const payout = Math.min((r.streak || 0) + 1, r.maxStreak || 0);
        totalMoney += payout;
        reportLines.push(`${r.icon} ${r.name}: CLEAN (+$${payout.toFixed(2)})`);
    });

    // ── Event payouts (pay unpaid completions, advance the watermark) ────────
    // Each event tracks lastPaidCompletions so multi-week events accumulate
    // visually (yearly auto-reset) while still paying every Monday.
    events.forEach(ev => {
        const unpaid = (ev.completions || 0) - (ev.lastPaidCompletions || 0);
        if (unpaid <= 0) return;
        const payout = unpaid * (ev.payout || 0);
        if (!payout) return;
        totalMoney += payout;
        reportLines.push(`${ev.icon} ${ev.name}: ${unpaid}× event (+$${payout.toFixed(2)})`);
    });

    const totalStr = (totalMoney < 0 ? '-$' : '+$') + Math.abs(totalMoney).toFixed(2);
    console.log(`💰 Total balance: ${totalStr}`);

    // ── Send email report ────────────────────────────────────────────────────
    console.log('📧 Sending email report...');
    const reportText =
        `VICTORIA'S WEEKLY REPORT\n` +
        `Week ending ${dateStr}\n` +
        `${'─'.repeat(32)}\n\n` +
        reportLines.join('\n') + '\n\n' +
        `${'─'.repeat(32)}\n` +
        `TOTAL BALANCE: ${totalStr}`;

    const emailRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            service_id:  process.env.EMAILJS_SERVICE_ID,
            template_id: process.env.EMAILJS_TEMPLATE_ID,
            user_id:     process.env.EMAILJS_PUBLIC_KEY,
            template_params: {
                summary_text: reportText
            }
        })
    });
    if (!emailRes.ok) {
        console.warn('   ⚠️  Email failed:', await emailRes.text());
    } else {
        console.log('   ✅ Email sent');
    }

    // ── Award stars ──────────────────────────────────────────────────────────
    console.log('⭐ Calculating star awards...');
    let starDoc     = { balance:0, spent:0, items:[], log:[], excuseTokens:0 };
    try {
        const sd    = await firestoreGet('system/star_data');
        starDoc     = fromDoc(sd);
    } catch(e) { /* first run */ }

    let totalStarsEarned   = 0;
    let totalExcuseAwarded = 0;
    habits.forEach(h => {
        if (isDormant(h)) return;
        if (h.excused) return;
        const hist  = (h.history || []).slice(0, 7);
        const cur   = hist[6] !== undefined ? hist[6] : (hist[hist.length-1]||0);
        const tier  = getTier(h, cur);
        const newStreak = (tier==='goal'||tier==='bonus') ? (h.streak||0)+1 : 0;
        let earned = 0, reasons = [];
        if (tier==='goal'  && (h.starGoal  ||0)>0) { earned+=h.starGoal;   reasons.push(h.name+' Goal'); }
        if (tier==='bonus' && (h.starBonus ||0)>0) { earned+=h.starBonus;  reasons.push(h.name+' Bonus'); }
        if (newStreak>=2   && (h.starStreak||0)>0) { earned+=h.starStreak; reasons.push(h.name+' Streak'); }
        if (h.bountyActive && (tier==='goal'||tier==='bonus') && (h.bountyStars||0)>0) {
            earned+=h.bountyStars; reasons.push(h.name+' Bounty 🏆');
        }
        if (earned > 0) {
            totalStarsEarned += earned;
            starDoc.log = [{ ts: Date.now(), type:'earn', amount:earned, reason:reasons.join(' + ') },
                           ...(starDoc.log||[])].slice(0,200);
        }
        // Excuse token bounty
        if (h.bountyActive && (tier==='goal'||tier==='bonus') && (h.bountyExcuseTokens||0)>0) {
            const tokens = h.bountyExcuseTokens;
            totalExcuseAwarded += tokens;
            starDoc.excuseTokens = (starDoc.excuseTokens||0) + tokens;
            starDoc.log = [{ ts: Date.now(), type:'excuseToken', amount:tokens, reason:h.name+' Bounty 🏆' },
                           ...(starDoc.log||[])].slice(0,200);
        }
    });
    const starDocChanged = totalStarsEarned > 0 || totalExcuseAwarded > 0;
    if (totalStarsEarned > 0) {
        starDoc.balance = (starDoc.balance||0) + totalStarsEarned;
        console.log(`   ✅ Awarded ${totalStarsEarned} stars`);
    }
    if (totalExcuseAwarded > 0) {
        console.log(`   ✅ Awarded ${totalExcuseAwarded} excuse token(s)`);
    }
    if (starDocChanged) {
        await firestoreSet('system/star_data', starDoc);
    }

    // ── Update streaks ───────────────────────────────────────────────────────
    // Dormant cyclic habits and period-sensitive habits (during/after period
    // this week) have their streak frozen — neither incremented nor reset.
    // Cyclic habits: streak only grows on completed cycles (goal/bonus weeks);
    // a punish/low week during a wait does NOT zero the streak and badStreak
    // stays at 0 — there are no weekly negatives for cyclic habits.
    console.log('🔥 Updating streaks...');
    habits = habits.map(h => {
        if (isDormant(h))   return { ...h };
        if (h.excused)      return { ...h };
        if (streakFrozenH(h)) return { ...h };
        const hist    = (h.history || []).slice(0, 7);
        const cur     = hist[6] !== undefined ? hist[6] : (hist[hist.length-1]||0);
        const tier    = getTier(h, cur);
        const isGood    = tier === 'goal' || tier === 'bonus';
        let streak, badStreak;
        if (isCyclic(h)) {
            streak    = isGood ? (h.streak || 0) + 1 : (h.streak || 0);
            badStreak = 0;
        } else {
            streak    = isGood ? (h.streak    || 0) + 1 : 0;
            badStreak = !isGood ? (h.badStreak || 0) + 1 : 0;
        }
        const best = Math.max(streak, h.bestStreak||0);
        return { ...h, streak, badStreak, bestStreak: best };
    });

    // ── Save history snapshot ────────────────────────────────────────────────
    console.log('💾 Saving history snapshot...');
    let histDoc = { weeks: [] };
    try {
        const hd  = await firestoreGet('system/weekly_history');
        histDoc   = fromDoc(hd);
    } catch(e) { /* first run */ }

    const entry = {
        id:           String(Date.now()),
        weekEnding:   dateStr,
        timestamp:    Date.now(),
        totalBalance: totalMoney,
        habits: habits.filter(h => !isDormant(h)).map(h => {
            const hist = (h.history || []).slice(0, 7);
            // Use computeWeeklyPayout so the snapshot's per-habit payout matches
            // what was actually paid out — in particular cyclic-punish records
            // $0 (not valPunish), so the History tab's charts don't show
            // phantom losses for habits that were just in their wait period.
            const r = computeWeeklyPayout(h, { periodActive, now: nowTs });
            return { id:h.id, name:h.name, icon:h.icon, cat:h.cat,
                     tier: r.tier, payout: r.base, history: hist,
                     thresh:{ punish:h.punish||1, low:h.low||3, goal:h.goal||5, bonus:h.bonus||7 } };
        })
    };
    let weeks = [entry, ...(histDoc.weeks||[])].slice(0, 52);
    await firestoreSet('system/weekly_history', { weeks });
    console.log('   ✅ History saved');

    // ── Wipe history, clear bounties, advance cycles ─────────────────────────
    console.log('🔄 Resetting habits...');
    habits = habits.map(h => {
        // Dormant cyclic habits: keep their stored zeros and cycleNextDue,
        // just make sure excused doesn't carry over.
        if (isDormant(h)) {
            return { ...h, history:[0,0,0,0,0,0,0], excused:false };
        }

        const hist3 = (h.history||[]).slice(0,7);
        const cur3  = hist3[6] !== undefined ? hist3[6] : (hist3[hist3.length-1]||0);
        const tier3 = getTier(h, cur3);
        const bountyTriggered3 = h.bountyActive && (tier3 === 'goal' || tier3 === 'bonus');

        let updated = { ...h, history:[0,0,0,0,0,0,0], excused:false };

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

    await firestoreSet('system/habits_list', { data: habits });

    // ── Reset rooms: advance streaks for cleaned rooms, clear all marks ──────
    if (rooms.length) {
        const resetRooms = rooms.map(r => ({
            ...r,
            streak:  r.checked ? Math.min((r.streak || 0) + 1, r.maxStreak || 0) : 0,
            checked: false
        }));
        await firestoreSet('system/rooms_data', { rooms: resetRooms });
        console.log('   ✅ Rooms reset (streaks advanced, marks cleared)');
    }

    // ── Advance event payout watermark ───────────────────────────────────────
    // Don't clear completions — those stay visible until the yearly auto-reset
    // baked into Core/events.js. Just record what we paid so future weeks
    // only pay the new delta.
    if (events.length) {
        const paidEvents = events.map(ev => ({
            ...ev,
            lastPaidCompletions: ev.completions || 0
        }));
        await firestoreSet('system/seasonal_events', { events: paidEvents });
        console.log('   ✅ Event payout watermark advanced');
    }

    // ── Mark reset as done in Firebase ───────────────────────────────────────
    await firestoreSet('system/reset_state', { lastWeeklyReset: now.toDateString() });

    // ── Clear period week flags (only if period already ended) ───────────────
    // If the period is still active, leave it alone — protection should continue
    // into the new week. Only clear periodWasThisWeek when she already ended it.
    console.log('🩸 Updating period flags...');
    if (periodData) {
        if (!periodActive) {
            await firestoreSet('system/period_data', {
                active:            false,
                startTs:           null,
                startDayIdx:       null,
                periodWasThisWeek: false,
                history:           periodData.history || []
            });
            console.log('   ✅ Period ended — week flags cleared');
        } else {
            console.log('   ℹ️  Period still active — leaving protection in place');
        }
    }

    console.log('');
    console.log('✅ Reset complete!');
    console.log(`   Balance: ${totalStr}`);
    console.log(`   Stars earned: ${totalStarsEarned}`);
    console.log(`   Habits reset: ${habits.length}`);
}

runReset().catch(err => {
    console.error('❌ Reset failed:', err);
    process.exit(1);
});
