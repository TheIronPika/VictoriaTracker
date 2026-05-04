// Victoria Tracker — Weekly Reset Script
// Runs via GitHub Actions every Monday at 4am Central
// Reads habits from Firebase, calculates tiers/payouts/streaks,
// saves history snapshot, sends email report, wipes history.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fetch from 'node-fetch';

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

// ── Tier logic (mirrors the app exactly) ─────────────────────────────────────
function getTier(h, val) {
    if (val >= (h.bonus || 7)) return 'bonus';
    if (val >= (h.goal  || 5)) return 'goal';
    if (val >= (h.low   || 3)) return 'low';
    return 'punish';
}

// ── Cycle interval helper ────────────────────────────────────────────────────
function cycleIntervalMs(h) {
    const DAY = 86400000;
    switch (h.cycleType) {
        case 'weeks':     return (h.cycleEvery || 1) * 7 * DAY;
        case 'monthly':   return 30  * DAY;
        case 'quarterly': return 91  * DAY;
        case 'yearly':    return 365 * DAY;
        default:          return 0;
    }
}

// ── Main reset ───────────────────────────────────────────────────────────────
async function runReset() {
    const now    = new Date();
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const dateStr = months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();

    console.log(`\n🔄 Victoria Tracker Weekly Reset — ${dateStr}`);
    console.log('─'.repeat(50));

    // ── Load habits ──────────────────────────────────────────────────────────
    console.log('📥 Loading habits from Firebase...');
    const habitsDoc = await firestoreGet('system/habits_list');
    let habits      = fromDoc(habitsDoc).data || [];
    console.log(`   Found ${habits.length} habits`);

    // ── Calculate payouts & report lines ────────────────────────────────────
    let totalMoney = 0;
    let reportLines = [];

    habits.forEach(h => {
        if (h.excused) { reportLines.push(`${h.icon} ${h.name}: EXCUSED`); return; }

        const hist  = (h.history || []).slice(0, 7);
        const cur   = hist[6] !== undefined ? hist[6] : (hist[hist.length - 1] || 0);
        const tier  = getTier(h, cur);
        let payout  = 0;

        if (tier === 'punish') payout = h.valPunish || 0;
        else if (tier === 'low')   payout = h.valLow   || 0;
        else if (tier === 'goal')  payout = h.valGoal  || 0;
        else if (tier === 'bonus') payout = h.valBonus || 0;

        // Streak payouts
        const curStreak    = h.streak    || 0;
        const curBadStreak = h.badStreak || 0;
        if ((tier==='goal'||tier==='bonus') && curStreak>=2 && (h.streakBonusPer||0)>0) {
            const raw = curStreak * h.streakBonusPer;
            const cap = h.streakCap ? parseFloat(h.streakCap) : Infinity;
            payout += Math.min(raw, cap);
        }
        if ((tier==='punish'||tier==='low') && curBadStreak>=2 && (h.streakPenaltyPer||0)>0) {
            const raw = curBadStreak * h.streakPenaltyPer;
            const cap = h.streakCap ? parseFloat(h.streakCap) : Infinity;
            payout -= Math.min(raw, cap);
        }

        totalMoney += payout;
        const tierLabel = { punish:'DEBT', low:'LOW', goal:'GOAL', bonus:'BONUS' }[tier];
        const sign = payout < 0 ? '-$' : '+$';
        reportLines.push(`${h.icon} ${h.name}: ${tierLabel} (${sign}${Math.abs(payout).toFixed(2)})`);
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
    let starDoc     = { balance:0, spent:0, items:[], log:[] };
    try {
        const sd    = await firestoreGet('system/star_data');
        starDoc     = fromDoc(sd);
    } catch(e) { /* first run */ }

    let totalStarsEarned = 0;
    habits.forEach(h => {
        if (h.excused) return;
        const hist  = (h.history || []).slice(0, 7);
        const cur   = hist[6] !== undefined ? hist[6] : (hist[hist.length-1]||0);
        const tier  = getTier(h, cur);
        const newStreak = (tier==='goal'||tier==='bonus') ? (h.streak||0)+1 : 0;
        let earned = 0, reasons = [];
        if (tier==='goal'  && (h.starGoal  ||0)>0) { earned+=h.starGoal;   reasons.push(h.name+' Goal'); }
        if (tier==='bonus' && (h.starBonus ||0)>0) { earned+=h.starBonus;  reasons.push(h.name+' Bonus'); }
        if (newStreak>=2   && (h.starStreak||0)>0) { earned+=h.starStreak; reasons.push(h.name+' Streak'); }
        if (earned > 0) {
            totalStarsEarned += earned;
            starDoc.log = [{ ts: Date.now(), type:'earn', amount:earned, reason:reasons.join(' + ') },
                           ...(starDoc.log||[])].slice(0,200);
        }
    });
    if (totalStarsEarned > 0) {
        starDoc.balance = (starDoc.balance||0) + totalStarsEarned;
        console.log(`   ✅ Awarded ${totalStarsEarned} stars`);
        await firestoreSet('system/star_data', starDoc);
    }

    // ── Update streaks ───────────────────────────────────────────────────────
    console.log('🔥 Updating streaks...');
    habits = habits.map(h => {
        if (h.excused) return { ...h };
        const hist    = (h.history || []).slice(0, 7);
        const cur     = hist[6] !== undefined ? hist[6] : (hist[hist.length-1]||0);
        const tier    = getTier(h, cur);
        const isGood    = tier === 'goal' || tier === 'bonus';
        const streak    = isGood ? (h.streak||0) + 1 : 0;
        const badStreak = !isGood ? (h.badStreak||0) + 1 : 0;
        const best      = Math.max(streak, h.bestStreak||0);
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
        habits: habits.map(h => {
            const hist  = (h.history || []).slice(0, 7);
            const cur   = hist[6] !== undefined ? hist[6] : (hist[hist.length-1]||0);
            const tier  = getTier(h, cur);
            let payout  = 0;
            if (tier==='punish') payout = h.valPunish||0;
            else if (tier==='low')  payout = h.valLow||0;
            else if (tier==='goal') payout = h.valGoal||0;
            else if (tier==='bonus')payout = h.valBonus||0;
            return { id:h.id, name:h.name, icon:h.icon, cat:h.cat, tier, payout, history:hist,
                     thresh:{ punish:h.punish||1, low:h.low||3, goal:h.goal||5, bonus:h.bonus||7 } };
        })
    };
    let weeks = [entry, ...(histDoc.weeks||[])].slice(0, 52);
    await firestoreSet('system/weekly_history', { weeks });
    console.log('   ✅ History saved');

    // ── Wipe history & advance cycles ────────────────────────────────────────
    console.log('🔄 Resetting habits...');
    habits = habits.map(h => {
        if (h.cycleType && h.cycleType !== 'none') {
            const hist3 = (h.history||[]).slice(0,7);
            const cur3  = hist3[6] !== undefined ? hist3[6] : (hist3[hist3.length-1]||0);
            const tier3 = getTier(h, cur3);
            if (tier3 === 'goal' || tier3 === 'bonus') {
                return { ...h, history:[0,0,0,0,0,0,0], excused:false,
                               cycleNextDue: Date.now() + cycleIntervalMs(h) };
            }
        }
        return { ...h, history:[0,0,0,0,0,0,0], excused:false };
    });

    await firestoreSet('system/habits_list', { data: habits });

    // ── Mark reset as done in Firebase ───────────────────────────────────────
    await firestoreSet('system/reset_state', { lastWeeklyReset: now.toDateString() });

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
