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
    const name = document.getElementById('newName').value;
    const cat  = document.getElementById('newCat').value;
    const icon = document.getElementById('newIcon').value || '✨';
    if (!name || !cat) return alert('Please enter name and category');
    const note  = document.getElementById('newNote')?.value.trim() || '';
    const newH  = {
        id: Date.now().toString(), name, icon, cat, note,
        dailyMax: 1, punish: 1, low: 3, goal: 5, bonus: 7, max: 7,
        valPunish: -1.50, valLow: 1.00, valGoal: 2.00, valBonus: 3.00,
        history: [0, 0, 0, 0, 0, 0, 0]
    };
    uiState.habits.push(newH);
    await syncHabits();
    document.getElementById('newName').value = '';
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

    // Re-fetch from state.habits in case watchHabits fired during the wait
    // (watchHabits can replace uiState.habits with fresh Firebase data)
    const hState = state.habits.find(x => x.id === id);
    if (!hState) return;

    uiState.lastActedId = willMove ? id : null;

    // Propagate value to all remaining days this week
    for (let i = dIdx; i < 7; i++) hState.history[i] = newVal;
    
    // Sync uiState.habits with state.habits before rendering
    // This ensures the render operates on the correct (mutated) data
    uiState.habits = state.habits;

    // Optimistic render — show the result immediately, don't wait for Firebase
    window.render?.();

    // Fire fanfare immediately (before the network round-trip)
    if (newVal > oldQty && newTier !== 'punish' && newTier !== oldTier) {
        triggerFanfare(newTier);
    }

    await syncHabits();

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
