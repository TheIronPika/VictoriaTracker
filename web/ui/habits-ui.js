// ─────────────────────────────────────────────────────────────────────
// web/ui/habits-ui.js
// Habit card interaction: bubble toggle, CRUD, long-press definition modal.
// Firebase writes happen here; re-renders are triggered automatically
// by the watchHabits onSnapshot callback in index.html.
// ─────────────────────────────────────────────────────────────────────

import { uiState, saveCollapsedState } from './ui-state.js';
import { state } from '../../Core/state.js';
import { getDayIdx } from '../../Core/utils.js';
import { getTier } from '../../Core/habits.js';
import { syncHabits, toggleExcused as coreToggleExcused } from '../../Core/habits-data.js';
import { syncStarData, addStarLog } from '../../Core/stars.js';
import { playBubblePop, triggerFanfare, checkPerfectWeek, checkStreakMilestones } from './animations.js';
import { showCloverPopup, showLuckyDrawToast } from './lucky-draw.js';

// ── CRUD ──────────────────────────────────────────────────────────────

window.addTask = async () => {
    const name = document.getElementById('newName').value.trim();
    const cat  = document.getElementById('newCat').value.trim();
    const icon = document.getElementById('newIcon').value.trim() || '✨';
    if (!name || !cat) return alert('Please enter name and category');

    const numVal = (id, def) => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? def : v; };
    const intVal = (id, def) => { const v = parseInt(document.getElementById(id)?.value);   return isNaN(v) ? def : v; };
    const optNum = (id)      => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? undefined : v; };

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
        cycleType: document.getElementById('newCycleType')?.value || 'none',
        periodSensitive: document.getElementById('newPeriodSensitive')?.checked || false,
        history: [0, 0, 0, 0, 0, 0, 0]
    };

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

    ['newName','newCat','newNote','newStarGoal','newStarBonus','newStarStreak',
     'newStreakBonusPer','newStreakPenaltyPer','newStreakCap'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('newIcon').value              = '';
    document.getElementById('newPeriodSensitive').checked = false;
    document.getElementById('newCycleType').value         = 'none';
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
    uiState.habits = uiState.habits.filter(h => h.id !== id);
    await syncHabits();
};

window.updateField = async (id, field, value) => {
    const h = uiState.habits.find(x => x.id === id);
    if (!h) return;
    if (field === 'note' || field === 'cycleType')           h[field] = value;
    else if (field === 'periodSensitive')                    h[field] = !!value;
    else if (field.startsWith('val'))                        h[field] = parseFloat(value);
    else if (field.startsWith('star'))                       h[field] = parseInt(value) || 0;
    else if (field === 'streakBonusPer' || field === 'streakPenaltyPer' || field === 'streakCap')
                                                              h[field] = parseFloat(value) || 0;
    else                                                      h[field] = parseInt(value)   || 1;
    await syncHabits();
};

window.toggleExcused = async (id) => {
    await coreToggleExcused(id);
};

// ── Bubble interaction ────────────────────────────────────────────────

window.toggleBubble = async (id, val) => {
    const h = uiState.habits.find(x => x.id === id);
    if (!h) return;

    // Auto-expand this habit's category, collapse all others
    if (h.cat) {
        const cats = [...new Set(uiState.habits.map(x => x.cat))];
        cats.forEach(c => { uiState.collapsed[c] = (c !== h.cat); });
        uiState.lastActiveCat = h.cat;
        saveCollapsedState();
    }

    const dIdx   = getDayIdx(uiState.viewingDate);
    const oldQty = h.history[dIdx];
    const newVal = (oldQty === val) ? val - 1 : val;

    const oldTier  = getTier(h, oldQty);
    const newTier  = getTier(h, newVal);
    const willMove = (oldQty === 0 && newVal > 0) || (newVal === 0 && oldQty > 0);

    playBubblePop(newVal >= oldQty);

    if (willMove) {
        const cardEl = document.querySelector(`.habit-card[data-habit-id="${id}"]`);
        if (cardEl) {
            cardEl.classList.add('card-leaving');
            await new Promise(r => setTimeout(r, 150));
        }
    }

    uiState.lastActedId = willMove ? id : null;

    // Propagate value to all remaining days this week
    for (let i = dIdx; i < 7; i++) h.history[i] = newVal;

    // Optimistic render — show the result immediately, don't wait for Firebase
    window.render?.();

    await syncHabits();

    if (newVal > oldQty && newTier !== 'punish' && newTier !== oldTier) {
        triggerFanfare(newTier);
    }

    // ── Lucky draw (2% chance per completion, max once per habit per day) ──
    if (newVal > oldQty) {
        const today = new Date().toISOString().split('T')[0];
        if (h.lastLuckyDrawDate !== today && Math.random() * 100 < 2) {
            state.starBalance += 1;
            h.lastLuckyDrawDate = today;
            addStarLog('luckyDraw', 1, 'Lucky draw! 🍀');
            await syncStarData();
            await syncHabits();

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
        document.getElementById('defOverlay').classList.add('def-open');
        return;
    }
    const h = uiState.habits.find(x => x.id === id);
    if (!h) return;
    document.getElementById('defTitle').innerText = h.icon + '  ' + h.name;
    document.getElementById('defBody').innerText  = h.note && h.note.trim()
        ? h.note
        : 'No definition set yet. Add one in Manage.';
    document.getElementById('defOverlay').classList.add('def-open');
};

window.closeDefinition = () => {
    document.getElementById('defOverlay').classList.remove('def-open');
};
