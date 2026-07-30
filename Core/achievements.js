// ─────────────────────────────────────────────────────────────────────
// core/achievements.js
// Permanent achievement badges. Follows the stars.js / events.js pattern:
// watchAchievements() subscribes; unlockAchievement() is idempotent.
// ─────────────────────────────────────────────────────────────────────

import { readDoc, watchDoc, writeDoc } from './firebase.js';
import { state } from './state.js';
import { FIRESTORE_DOCS } from './config.js';

export function watchAchievements() {
    return watchDoc(FIRESTORE_DOCS.ACHIEVEMENTS, data => {
        state.achievements = data?.unlocked || [];
        if (typeof window !== 'undefined' && window.render) window.render();
    });
}

export async function syncAchievements() {
    await writeDoc(FIRESTORE_DOCS.ACHIEVEMENTS, { unlocked: state.achievements || [] });
}

/**
 * Unlock an achievement. No-op if already unlocked (idempotent by entry.id).
 * Returns true if newly unlocked, false if already present.
 *
 * Re-reads the doc before writing: celebration checks can run before the
 * achievements snapshot arrives (parallel loads race on launch), and writing
 * from a stale/empty state.achievements would overwrite the whole doc and
 * wipe every previously-unlocked badge.
 */
export async function unlockAchievement(entry) {
    try {
        const data = await readDoc(FIRESTORE_DOCS.ACHIEVEMENTS);
        state.achievements = data?.unlocked || state.achievements || [];
    } catch (e) {
        // Can't merge safely (offline) — skip; every unlock check is
        // idempotent and re-fires on a later launch.
        console.error('unlockAchievement read:', e);
        return false;
    }
    if (state.achievements.find(a => a.id === entry.id)) return false;
    state.achievements.push({ ...entry, ts: Date.now() });
    try { await syncAchievements(); } catch (e) { console.error('unlockAchievement sync:', e); }
    return true;
}
