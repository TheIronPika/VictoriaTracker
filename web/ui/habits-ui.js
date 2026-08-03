// ─────────────────────────────────────────────────────────────────────
// web/ui/habits-ui.js
// Habit card interaction: bubble toggle, CRUD, long-press definition modal.
// Firebase writes happen here; re-renders are triggered automatically
// by the watchHabits onSnapshot callback in index.html.
// ─────────────────────────────────────────────────────────────────────

import { uiState, saveCollapsedState } from './ui-state.js';
import { state } from '../../Core/state.js';
import { getDayIdx, escapeHtml } from '../../Core/utils.js';
import { getTier, toCumulative, weekTotal } from '../../Core/habits.js';
import { LUCKY_DRAW_ODDS, WATER_CONFIG } from '../../Core/config.js';
import { syncHabits, toggleExcused as coreToggleExcused, deleteHabit as coreDeleteHabit } from '../../Core/habits-data.js';
import { syncStarData, addStarLog, useExcuseToken, useStreakResetToken, useMarkOffToken, grantMarkOffTokens, awardLuckyDrawStar, luckyDrawWinsToday } from '../../Core/stars.js';
import { playBubblePop, triggerFanfare, checkPerfectWeek, checkStreakMilestones } from './animations.js';
import { showCloverPopup, showLuckyDrawToast } from './lucky-draw.js';

// ── CRUD ──────────────────────────────────────────────────────────────

window.populateNewCatSelect = () => {
    const sel = document.getElementById('newCatSelect');
    if (!sel) return;
    const cats = [...new Set((state.habits || []).map(h => h.cat))].filter(Boolean).sort();
    sel.innerHTML = '<option value="">Select category…</option>'
        + cats.map(c => `<option value="${c.replace(/"/g, '&quot;')}">${escapeHtml(c)}</option>`).join('')
        + '<option value="__new__">✚ Add new…</option>';
    const input = document.getElementById('newCat');
    if (input) { input.value = ''; input.style.display = 'none'; }
};

window.handleNewCatSelect = (sel) => {
    const input = document.getElementById('newCat');
    if (!input) return;
    if (sel.value === '__new__') {
        input.value = '';
        input.style.display = '';
        input.focus();
    } else {
        input.value = sel.value;
        input.style.display = 'none';
    }
};

window.addTask = async () => {
    const name = document.getElementById('newName').value.trim();
    const cat  = document.getElementById('newCat').value.trim();
    const icon = document.getElementById('newIcon').value.trim() || '✨';
    if (!name || !cat) return alert('Please enter name and category');

    const numVal = (id, def) => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? def : v; };
    const intVal = (id, def) => { const v = parseInt(document.getElementById(id)?.value);   return isNaN(v) ? def : v; };
    const optNum = (id)      => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? undefined : v; };

    const cycleType = document.getElementById('newCycleType')?.value || 'none';

    // "First due" date — only meaningful for cyclic habits. Hides the new
    // habit from the live UI until this calendar day (local midnight).
    // Parse YYYY-MM-DD as a local date so the user sees the day they picked.
    let cycleNextDue = 0;
    const firstDueStr = document.getElementById('newCycleFirstDue')?.value;
    if (cycleType !== 'none' && firstDueStr) {
        const [y, m, d] = firstDueStr.split('-').map(Number);
        if (y && m && d) cycleNextDue = new Date(y, m - 1, d).getTime();
    }

    const newH = {
        id: Date.now().toString(), name, icon, cat,
        note: document.getElementById('newNote')?.value.trim() || '',
        punish:   intVal('newPunish',   1),
        low:      intVal('newLow',      3),
        goal:     intVal('newGoal',     5),
        bonus:    intVal('newBonus',    7),
        max:      intVal('newMax',      7),
        dailyMax: intVal('newDailyMax', 1),
        valPunish: numVal('newValPunish', -1.50),
        valLow:    numVal('newValLow',    1.00),
        valGoal:   numVal('newValGoal',   2.00),
        valBonus:  numVal('newValBonus',  3.00),
        cycleType,
        periodSensitive: document.getElementById('newPeriodSensitive')?.checked || false,
        history: [0, 0, 0, 0, 0, 0, 0]
    };
    if (cycleNextDue) newH.cycleNextDue = cycleNextDue;

    const starGoal         = optNum('newStarGoal');
    const starBonus        = optNum('newStarBonus');
    const starStreak       = optNum('newStarStreak');
    const streakBonusPer   = optNum('newStreakBonusPer');
    const streakPenaltyPer = optNum('newStreakPenaltyPer');
    const streakCap        = optNum('newStreakCap');
    if (starGoal         !== undefined) newH.starGoal         = starGoal;
    if (starBonus        !== undefined) newH.starBonus        = starBonus;
    if (starStreak       !== undefined) newH.starStreak       = starStreak;
    if (streakBonusPer   !== undefined) newH.streakBonusPer   = streakBonusPer;
    if (streakPenaltyPer !== undefined) newH.streakPenaltyPer = streakPenaltyPer;
    if (streakCap        !== undefined) newH.streakCap        = streakCap;

    uiState.habits.push(newH);
    await syncHabits();

    ['newName','newNote','newStarGoal','newStarBonus','newStarStreak',
     'newStreakBonusPer','newStreakPenaltyPer','newStreakCap'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    window.populateNewCatSelect();
    document.getElementById('newIcon').value              = '';
    document.getElementById('newPeriodSensitive').checked = false;
    document.getElementById('newCycleType').value         = 'none';
    const _fd = document.getElementById('newCycleFirstDue'); if (_fd) _fd.value = '';
    document.getElementById('newPunish').value            = '1';
    document.getElementById('newLow').value               = '3';
    document.getElementById('newGoal').value              = '5';
    document.getElementById('newBonus').value             = '7';
    document.getElementById('newMax').value               = '7';
    document.getElementById('newDailyMax').value          = '1';
    document.getElementById('newValPunish').value         = '-1.50';
    document.getElementById('newValLow').value            = '1.00';
    document.getElementById('newValGoal').value           = '2.00';
    document.getElementById('newValBonus').value          = '3.00';
};

window.deleteTask = async (id) => {
    if (!confirm('Are you sure you want to delete this habit?')) return;
    // Route through Core/habits-data.deleteHabit so state.habits is updated
    // (and synced). Updating only uiState.habits leaves state.habits stale and
    // syncHabits() writes the old array — the deleted habit reappears on the
    // next Firestore snapshot.
    await coreDeleteHabit(id);
    uiState.habits = state.habits;
};

window.updateField = async (id, field, value) => {
    const h = uiState.habits.find(x => x.id === id);
    if (!h) return;
    if (field === 'note' || field === 'cycleType' || field === 'bountyNote')
                                                              h[field] = value;
    else if (field === 'periodSensitive')                    h[field] = !!value;
    else if (field === 'cycleNextDue') {
        // Date picker sends "YYYY-MM-DD". Empty value clears the field
        // (cyclic habit becomes visible immediately).
        if (!value) {
            delete h.cycleNextDue;
        } else {
            const [y, mo, d] = String(value).split('-').map(Number);
            if (y && mo && d) h.cycleNextDue = new Date(y, mo - 1, d).getTime();
        }
    }
    else if (field.startsWith('val'))                        h[field] = parseFloat(value);
    else if (field.startsWith('star'))                       h[field] = parseInt(value) || 0;
    else if (field === 'streakBonusPer' || field === 'streakPenaltyPer' || field === 'streakCap')
                                                              h[field] = parseFloat(value) || 0;
    else if (field === 'bountyDollars' || field === 'bountyStars')
                                                              h[field] = parseFloat(value) || 0;
    else if (field === 'bountyExcuseTokens' || field === 'bountyStreakResetTokens')
                                                              h[field] = parseInt(value)   || 0;
    else                                                      h[field] = parseInt(value)   || 1;
    await syncHabits();
};

window.setBounty = async (id) => {
    const h = uiState.habits.find(x => x.id === id);
    if (!h) return;
    h.bountyActive            = true;
    h.bountyDollars           = 0;
    h.bountyStars             = 0;
    h.bountyExcuseTokens      = 0;
    h.bountyStreakResetTokens = 0;
    h.bountyNote              = '';
    await syncHabits();
    window.showManageDetail(id);
};

window.clearBounty = async (id) => {
    const h = uiState.habits.find(x => x.id === id);
    if (!h) return;
    delete h.bountyActive;
    delete h.bountyDollars;
    delete h.bountyStars;
    delete h.bountyExcuseTokens;
    delete h.bountyStreakResetTokens;
    delete h.bountyNote;
    await syncHabits();
    window.showManageDetail(id);
};

window.toggleExcused = async (id) => {
    const h = uiState.habits.find(x => x.id === id);
    if (!h) return;

    // Unexcusing is always free
    if (h.excused) {
        await coreToggleExcused(id);
        window.render?.();
        return;
    }

    // Excusing costs a token — show confirmation modal
    const tokens = state.excuseTokens || 0;
    const overlay = document.createElement('div');
    overlay.id        = 'excuseConfirmOverlay';
    overlay.className = 'period-modal-overlay';
    overlay.innerHTML = tokens > 0
        ? `<div class="period-modal-sheet">
               <div class="period-modal-title">🌿 Take a Rest Week?</div>
               <div class="period-modal-sub">
                   <strong>${escapeHtml(h.name)}</strong> takes this week off — your streak stays safe and your payout is untouched.<br><br>
                   You have <strong>${tokens} Rest Week${tokens !== 1 ? 's' : ''}</strong>. You'll have ${tokens - 1} after this.
               </div>
               <div class="period-modal-btns">
                   <button class="period-modal-btn cancel" onclick="document.getElementById('excuseConfirmOverlay').remove()">Cancel</button>
                   <button class="period-modal-btn confirm" id="excuseConfirmBtn">Use Rest Week</button>
               </div>
           </div>`
        : `<div class="period-modal-sheet">
               <div class="period-modal-title">No Rest Weeks left</div>
               <div class="period-modal-sub">
                   You're out of Rest Weeks — pick more up in the star shop.<br><br>
                   Current balance: <strong>✨ ${state.starBalance} stars</strong>
               </div>
               <div class="period-modal-btns">
                   <button class="period-modal-btn cancel" onclick="document.getElementById('excuseConfirmOverlay').remove()">OK</button>
               </div>
           </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    if (tokens > 0) {
        document.getElementById('excuseConfirmBtn').addEventListener('click', async () => {
            overlay.remove();
            const ok = await useExcuseToken();
            if (ok) {
                await coreToggleExcused(id);
                window.render?.();
            }
        });
    }
};

// ── Streak reset token ────────────────────────────────────────────────
// Spend one streak reset token to zero a habit's bad streak (🌧️) without
// requiring a goal week. Sets h.badStreak = 0 immediately, stamps
// h.badStreakResetTs so future history scans + the upcoming Monday reset
// honor the wipe.

window.resetBadStreak = async (id) => {
    const h = uiState.habits.find(x => x.id === id);
    if (!h) return;
    const tokens = state.streakResetTokens || 0;

    const overlay = document.createElement('div');
    overlay.id        = 'streakResetConfirmOverlay';
    overlay.className = 'period-modal-overlay';
    overlay.innerHTML = tokens > 0
        ? `<div class="period-modal-sheet">
               <div class="period-modal-title">☀️ Use a Fresh Start?</div>
               <div class="period-modal-sub">
                   Clears <strong>${escapeHtml(h.name)}</strong>'s 🌧️ missed-week streak — like it never happened.<br><br>
                   You have <strong>${tokens} Fresh Start${tokens !== 1 ? 's' : ''}</strong>. You'll have ${tokens - 1} after this.
               </div>
               <div class="period-modal-btns">
                   <button class="period-modal-btn cancel" onclick="document.getElementById('streakResetConfirmOverlay').remove()">Cancel</button>
                   <button class="period-modal-btn confirm" id="streakResetConfirmBtn">Use Fresh Start</button>
               </div>
           </div>`
        : `<div class="period-modal-sheet">
               <div class="period-modal-title">No Fresh Starts left</div>
               <div class="period-modal-sub">
                   You're out of Fresh Starts — pick more up in the star shop.<br><br>
                   Current balance: <strong>✨ ${state.starBalance} stars</strong>
               </div>
               <div class="period-modal-btns">
                   <button class="period-modal-btn cancel" onclick="document.getElementById('streakResetConfirmOverlay').remove()">OK</button>
               </div>
           </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    if (tokens > 0) {
        document.getElementById('streakResetConfirmBtn').addEventListener('click', async () => {
            overlay.remove();
            const ok = await useStreakResetToken();
            if (!ok) return;
            h.badStreak       = 0;
            h.badStreakResetTs = Date.now();
            await syncHabits();
            window.render?.();
        });
    }
};

// System-driven habits render like any other card but reject manual fill
// attempts: their history is forward-filled from elsewhere, so a bubble tap
// or mark-off would fight that auto-fill (and either hand out a free
// completion or get silently overwritten on the next sync). Right now this
// is only the water tracker's linked "Drink Water" habit — Core/water.js
// syncWaterHabit() owns that habit's bubbles. Mirrors the native app's
// HabitCard `locked` prop; enforced at the handler so every view is covered.
function isSystemDriven(id) {
    return id === WATER_CONFIG.linkedHabitId;
}

// ── Mark-off token ────────────────────────────────────────────────────
// Spend one mark-off token to synthetically add +1 completion to a habit
// for the current viewing day, as if she actually did it.

window.useMarkOffBubble = async (id) => {
    const h = uiState.habits.find(x => x.id === id);
    if (!h) return;
    if (isSystemDriven(id)) return;
    // A day after today has no independent identity yet — editing it isn't
    // meaningful (see toggleBubble below).
    if (getDayIdx(uiState.viewingDate) > getDayIdx(new Date())) return;

    const dIdx   = getDayIdx(uiState.viewingDate);
    const cur    = toCumulative(h.history)[dIdx] || 0; // cumulative through viewed day (for the message)
    const max    = h.max || 7;
    const atMax  = weekTotal(h.history) >= max;
    const tokens = state.markOffTokens || 0;

    const overlay = document.createElement('div');
    overlay.id        = 'markOffConfirmOverlay';
    overlay.className = 'period-modal-overlay';

    if (atMax) {
        overlay.innerHTML = `<div class="period-modal-sheet">
               <div class="period-modal-title">Already at maximum</div>
               <div class="period-modal-sub">
                   <strong>${escapeHtml(h.name)}</strong> is already at the maximum level for this week — no more completions can be added.
               </div>
               <div class="period-modal-btns">
                   <button class="period-modal-btn cancel" onclick="document.getElementById('markOffConfirmOverlay').remove()">OK</button>
               </div>
           </div>`;
    } else if (tokens > 0) {
        overlay.innerHTML = `<div class="period-modal-sheet">
               <div class="period-modal-title">🎫 Use a Day Pass?</div>
               <div class="period-modal-sub">
                   This will mark one bubble for <strong>${escapeHtml(h.name)}</strong> today (${cur} → ${cur + 1}).<br><br>
                   You have <strong>${tokens} Day Pass${tokens !== 1 ? 'es' : ''}</strong>. You'll have ${tokens - 1} after this.
               </div>
               <div class="period-modal-btns">
                   <button class="period-modal-btn cancel" onclick="document.getElementById('markOffConfirmOverlay').remove()">Cancel</button>
                   <button class="period-modal-btn confirm" id="markOffConfirmBtn">Use Day Pass</button>
               </div>
           </div>`;
    } else {
        overlay.innerHTML = `<div class="period-modal-sheet">
               <div class="period-modal-title">No Day Passes left</div>
               <div class="period-modal-sub">
                   You're out of Day Passes — pick more up in the star shop.<br><br>
                   Current balance: <strong>✨ ${state.starBalance} stars</strong>
               </div>
               <div class="period-modal-btns">
                   <button class="period-modal-btn cancel" onclick="document.getElementById('markOffConfirmOverlay').remove()">OK</button>
               </div>
           </div>`;
    }

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    if (tokens > 0 && !atMax) {
        document.getElementById('markOffConfirmBtn').addEventListener('click', async () => {
            overlay.remove();
            const ok = await useMarkOffToken();
            if (!ok) return;
            h.markOffDays = h.markOffDays || {};
            h.markOffDays[dIdx] = (h.markOffDays[dIdx] || 0) + 1;
            // Add one completion to THIS day's own count only.
            h.history[dIdx] = Math.min(h.max || 7, (h.history[dIdx] || 0) + 1);
            await syncHabits();
            window.render?.();
        });
    }
};

// ── Bubble interaction ────────────────────────────────────────────────

window.toggleBubble = async (id, val) => {
    const h = uiState.habits.find(x => x.id === id);
    if (!h) return;
    if (isSystemDriven(id)) return;
    // A day after today has no independent identity yet (it just mirrors
    // today) — editing it would silently redirect to today with no visual
    // cue, which is confusing. render.js already omits the onclick for
    // these bubbles; this is a defense-in-depth guard against stale DOM.
    if (getDayIdx(uiState.viewingDate) > getDayIdx(new Date())) return;

    // Auto-expand this habit's category, collapse all others
    if (h.cat) {
        const cats = [...new Set(uiState.habits.map(x => x.cat))];
        cats.forEach(c => { uiState.collapsed[c] = (c !== h.cat); });
        uiState.lastActiveCat = h.cat;
        saveCollapsedState();
    }

    const dIdx     = getDayIdx(uiState.viewingDate);
    const todayIdx = getDayIdx(new Date());
    // history stores PER-DAY counts. A tap either pops a filled bubble
    // (remove) or fills an empty one (add):
    //   • Filled bubble (val <= cur): remove one completion from whichever
    //     day owns that bubble — so a mark can be popped from ANY day's card,
    //     not just the day it was logged on.
    //   • Empty bubble (val > cur): add to the day being viewed — today jumps
    //     straight to the tapped bubble; a past day moves by exactly one so
    //     tapping past the dashed preview bubbles can't overshoot.
    // Either way we write exactly one day's own cell, so no other day is
    // touched and the array can never be corrupted.
    const cum      = toCumulative(h.history);
    const cur      = cum[dIdx] || 0;
    const base     = dIdx > 0 ? (cum[dIdx - 1] || 0) : 0;
    const maxPer   = h.max || 7;
    let targetDay, targetNew;
    if (val <= cur) {
        targetDay = -1;
        for (let d = 0; d < 7; d++) { if ((cum[d] || 0) >= val) { targetDay = d; break; } }
        targetNew = targetDay < 0 ? 0 : Math.max(0, (h.history[targetDay] || 0) - 1);
    } else {
        targetDay = dIdx;
        const newCum = (dIdx === todayIdx) ? val : cur + 1;
        targetNew = Math.max(0, Math.min(maxPer, newCum - base));
    }
    if (targetDay < 0) return;
    const targetOld = h.history[targetDay] || 0;
    if (targetNew === targetOld) return; // no change
    const isUp     = targetNew > targetOld;
    const newCur   = cur + (targetNew - targetOld); // viewed day's cumulative after

    const oldTier  = getTier(h, weekTotal(h.history));
    const willMove = (cur === 0 && newCur > 0) || (newCur === 0 && cur > 0);

    playBubblePop(isUp);

    if (willMove) {
        const cardEl = document.querySelector(`.habit-card[data-habit-id="${id}"]`);
        if (cardEl) {
            cardEl.classList.add('card-leaving');
            await new Promise(r => setTimeout(r, 150));
        }
    }

    uiState.lastActedId = willMove ? id : null;

    // Refund mark-off tokens for any synthetic completions removed from the
    // day being changed.
    let tokenRefund = 0;
    if (targetNew < targetOld) {
        const markOff = h.markOffDays?.[targetDay] || 0;
        if (markOff > 0) {
            const real       = targetOld - markOff;
            const newMarkOff = Math.max(0, Math.min(markOff, targetNew - real));
            tokenRefund      = markOff - newMarkOff;
            h.markOffDays    = h.markOffDays || {};
            if (newMarkOff === 0) delete h.markOffDays[targetDay];
            else h.markOffDays[targetDay] = newMarkOff;
        }
    }

    // The entire mutation: set just the target day's own count. No propagation.
    h.history[targetDay] = targetNew;
    const newTier = getTier(h, weekTotal(h.history));

    // Optimistic render — show the result immediately, don't wait for Firebase
    window.render?.();

    await syncHabits();
    if (tokenRefund > 0) {
        await grantMarkOffTokens(tokenRefund);
        window.render?.();
    }

    if (isUp && newTier !== 'punish' && newTier !== oldTier) {
        triggerFanfare(newTier);
    }

    // ── Lucky draw ────────────────────────────────────────────────────
    // Odds scale with tier, then halve for every real win already landed
    // today (2/5/7/10 -> 1/2.5/3.5/5 after the first, and so on) so more
    // than one is possible in a day but each is less likely than the last.
    // targetDay === todayIdx restricts this to completions actually logged
    // on today's real card — the whole point is to reward filling habits
    // out daily, so backdating a past day's bubble (or popping/re-filling
    // one from an earlier day's card) must never roll for a lucky draw.
    if (isUp && targetDay === todayIdx) {
        const decay   = Math.pow(0.5, luckyDrawWinsToday());
        const oddsPct = LUCKY_DRAW_ODDS[newTier] * decay;
        if (Math.random() * 100 < oddsPct) {
            await awardLuckyDrawStar(undefined, { habitName: h.name, tier: newTier, oddsPct });

            const bubbleEl = document.querySelector(
                `.habit-card[data-habit-id="${id}"] .bubble[onclick*="toggleBubble('${id}',${val})"]`
            );
            if (bubbleEl) showCloverPopup(bubbleEl);
            showLuckyDrawToast();
        }
    }

    checkPerfectWeek();
    checkStreakMilestones();
};

// ── Long-press definition modal ───────────────────────────────────────

window.startLongPress = (id) => {
    uiState.longPressTimer = setTimeout(() => { window.showDefinition(id); }, 500);
};

window.cancelLongPress = () => {
    if (uiState.longPressTimer) { clearTimeout(uiState.longPressTimer); uiState.longPressTimer = null; }
};

window.showDefinition = (id) => {
    // Support long-press on seasonal event cards too
    if (id.startsWith('__ev__')) {
        const evId = id.replace('__ev__', '');
        const ev   = state.seasonalEvents.find(e => e.id === evId);
        if (!ev || !ev.note) return;
        document.getElementById('defTitle').innerText = ev.icon + '  ' + ev.name;
        document.getElementById('defBody').innerText  = ev.note;
        const b = document.getElementById('defBounty'); if (b) b.style.display = 'none';
        document.getElementById('defOverlay').classList.add('def-open');
        return;
    }
    const h = uiState.habits.find(x => x.id === id);
    if (!h) return;
    document.getElementById('defTitle').innerText = h.icon + '  ' + h.name;
    document.getElementById('defBody').innerText  = h.note && h.note.trim()
        ? h.note
        : 'No definition set yet. Add one in Manage.';

    const bountyEl        = document.getElementById('defBounty');
    const bountyDetailsEl = document.getElementById('defBountyDetails');
    if (h.bountyActive && bountyEl) {
        const parts = [];
        if ((h.bountyDollars      || 0) > 0) parts.push(`+$${parseFloat(h.bountyDollars).toFixed(2)} bonus`);
        if ((h.bountyStars        || 0) > 0) parts.push(`✨ ${h.bountyStars} stars`);
        if ((h.bountyExcuseTokens || 0) > 0) parts.push(`🌿 ${h.bountyExcuseTokens} Rest Week${h.bountyExcuseTokens !== 1 ? 's' : ''}`);
        if ((h.bountyStreakResetTokens || 0) > 0) parts.push(`☀️ ${h.bountyStreakResetTokens} Fresh Start${h.bountyStreakResetTokens !== 1 ? 's' : ''}`);
        if (h.bountyNote && h.bountyNote.trim()) parts.push(h.bountyNote.trim());
        bountyDetailsEl.innerText = parts.join(' · ') || 'Bounty active';
        bountyEl.style.display = '';
    } else if (bountyEl) {
        bountyEl.style.display = 'none';
    }

    document.getElementById('defOverlay').classList.add('def-open');
};

window.closeDefinition = () => {
    document.getElementById('defOverlay').classList.remove('def-open');
};
