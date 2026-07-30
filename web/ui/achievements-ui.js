// ─────────────────────────────────────────────────────────────────────
// web/ui/achievements-ui.js
// Achievement unlock checks that don't hang off an existing celebration,
// plus the badge grid rendered in the Manage panel.
//
// The perfect-week and streak-milestone unlocks live in animations.js
// alongside the confetti they accompany (mirroring the native app's
// lib/celebrations.ts, which shares this file's gating keys — localStorage
// here, AsyncStorage there — so the two apps unlock at the same moments).
// ─────────────────────────────────────────────────────────────────────

import { state } from '../../Core/state.js';
import { unlockAchievement } from '../../Core/achievements.js';
import { computeWaterStreak } from '../../Core/water.js';
import { ACHIEVEMENTS, WATER_MILESTONE_TO_ACHIEVEMENT } from './achievement-catalog.js';

/** Brief bottom toast, same treatment the lucky draw uses. */
function showToast(text) {
    const toast = document.createElement('div');
    toast.className   = 'toast-notification';
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

/** Four consecutive perfect weeks in the stored history. */
export async function checkPerfectMonth() {
    const history = state.weeklyHistory || [];
    if (history.length < 4) return;
    const allPerfect = history.slice(0, 4).every(wk => {
        const habits = wk.habits || [];
        if (!habits.length) return false;
        return habits.every(h => h.excused || h.tier === 'goal' || h.tier === 'bonus');
    });
    if (allPerfect) {
        await unlockAchievement({ id: 'perfect_month', achId: 'perfect_month', label: 'Perfect month' });
    }
}

/** Cumulative earnings across all history weeks. */
export async function checkEarningsTotal() {
    const total = (state.weeklyHistory || []).reduce((s, wk) => s + (wk.totalBalance || 0), 0);
    if (total >= 5000) {
        await unlockAchievement({ id: 'first_five_thousand', achId: 'first_five_thousand', label: 'Five thousand earned' });
    }
    if (total >= 1000) {
        await unlockAchievement({ id: 'first_thousand', achId: 'first_thousand', label: 'First $1,000 earned' });
    }
}

/**
 * Water day-streak against the 7/30/100 milestones. Called right after a
 * tap crosses the goal. Same gating pattern as the habit streak milestones,
 * keyed by day count — there's only ever one water streak.
 */
export async function checkWaterStreakMilestone() {
    const streak = computeWaterStreak();
    const achId  = WATER_MILESTONE_TO_ACHIEVEMENT[streak];
    if (!achId) return;
    const key = `waterStreakMilestone_${streak}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    showToast(`💧 ${streak}-day water streak!`);
    await unlockAchievement({ id: achId, achId, label: `${streak}-day water streak` });
}

// ── Manage panel grid ─────────────────────────────────────────────────

function fmtDate(ts) {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function renderAchievementsManage() {
    const root = document.getElementById('achievementsRoot');
    if (!root) return;

    const unlocked = state.achievements || [];
    // Streak badges use composite per-habit IDs, so collapse to base IDs.
    const unlockedBaseIds = new Set(unlocked.map(a => a.achId || a.id));

    root.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="font-size:12px;color:#999;text-transform:uppercase;letter-spacing:0.5px;">Achievements</div>
            <div style="font-size:12px;color:#888;font-weight:600;">${unlockedBaseIds.size} / ${ACHIEVEMENTS.length}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
            ${ACHIEVEMENTS.map(def => {
                const isUnlocked = unlockedBaseIds.has(def.id);
                const first      = isUnlocked ? unlocked.find(a => (a.achId || a.id) === def.id) : null;
                return `
                    <button onclick="window.showAchievementDetail('${def.id}')"
                        style="min-height:92px;border-radius:14px;padding:10px;cursor:pointer;border:none;
                               display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
                               background:rgba(255,255,255,${isUnlocked ? '0.82' : '0.55'});opacity:${isUnlocked ? '1' : '0.42'};">
                        <div style="font-size:28px;${isUnlocked ? '' : 'opacity:0.4;'}">${def.emoji}</div>
                        <div style="font-size:10px;font-weight:600;color:#4a3a3a;text-align:center;line-height:1.3;${isUnlocked ? '' : 'opacity:0.4;'}">
                            ${isUnlocked ? def.label : '???'}
                        </div>
                        ${first ? `<div style="font-size:8px;color:#999;text-align:center;">${fmtDate(first.ts)}</div>` : ''}
                    </button>`;
            }).join('')}
        </div>`;
}

window.showAchievementDetail = (id) => {
    const def = ACHIEVEMENTS.find(a => a.id === id);
    if (!def) return;
    const entries = (state.achievements || []).filter(a => (a.achId || a.id) === id);
    if (!entries.length) {
        alert(`${def.emoji} ${def.label}\n\nLocked — ${def.description}`);
        return;
    }
    const lines = entries.map(a => `• ${a.label} — ${fmtDate(a.ts)}`).join('\n');
    alert(`${def.emoji} ${def.label}\n\n${def.description}\n\nUnlocked:\n${lines}`);
};
