// ─────────────────────────────────────────────────────────────────────
// Core/section-order.js
// Today-view section order — categories + Seasonal + Room Check.
//
// Persisted to system/ui_config.sectionOrder as a plain array of strings.
// Each entry is either a habit category name or one of the reserved
// SECTION_SEASONAL / SECTION_ROOMS tokens. Missing sections are appended
// at the end in natural order, so adding a new category never breaks layout.
// ─────────────────────────────────────────────────────────────────────

import { state, setSectionOrder } from './state.js';
import { readDoc, writeDoc, watchDoc } from './firebase.js';
import { FIRESTORE_DOCS, SECTION_SEASONAL, SECTION_ROOMS } from './config.js';

/**
 * One-time load of the section order doc. Safe on first run (no doc → []).
 */
export async function loadSectionOrder() {
    try {
        const data = await readDoc(FIRESTORE_DOCS.UI);
        setSectionOrder((data && data.sectionOrder) || []);
    } catch (e) {
        console.warn('loadSectionOrder failed:', e.message);
        setSectionOrder([]);
    }
    state.sectionOrderLoaded = true;
}

/**
 * Live-subscribe so reorders made elsewhere (another tab/device) sync in.
 * Triggers render() after each update.
 */
export function watchSectionOrder() {
    return watchDoc(FIRESTORE_DOCS.UI, (data) => {
        setSectionOrder((data && data.sectionOrder) || []);
        state.sectionOrderLoaded = true;
        window.render?.();
    });
}

/**
 * Push the current order to Firestore.
 */
export async function saveSectionOrder() {
    await writeDoc(FIRESTORE_DOCS.UI, { sectionOrder: state.sectionOrder });
}

/**
 * Resolve the canonical, in-order list of section IDs that should be rendered
 * right now. Combines the stored order with whatever sections currently exist,
 * dropping stale entries and appending newcomers.
 *
 * @param {string[]} availableIds  every section that exists right now
 * @returns {string[]}              ordered subset of availableIds
 */
export function resolveOrderedSections(availableIds) {
    const available = new Set(availableIds);
    const seen      = new Set();
    const result    = [];
    for (const id of state.sectionOrder) {
        if (available.has(id) && !seen.has(id)) {
            result.push(id);
            seen.add(id);
        }
    }
    // Append any sections the stored order doesn't know about — keeps a new
    // category visible on first load, before anyone reorders.
    for (const id of availableIds) {
        if (!seen.has(id)) result.push(id);
    }
    return result;
}

/**
 * Move a section up/down by one slot in the order, then save.
 *
 * @param {string} id             section id (category name or SECTION_*)
 * @param {-1|1}   direction      -1 = up, +1 = down
 * @param {string[]} availableIds the current set of sections (so we can
 *                                seed missing-from-stored-order sections)
 */
export async function moveSection(id, direction, availableIds) {
    // Start from the resolved order so newly-added sections behave predictably.
    const order = resolveOrderedSections(availableIds);
    const idx   = order.indexOf(id);
    if (idx === -1) return;
    const swapWith = idx + direction;
    if (swapWith < 0 || swapWith >= order.length) return;
    [order[idx], order[swapWith]] = [order[swapWith], order[idx]];
    setSectionOrder(order);
    await saveSectionOrder();
    window.render?.();
}

// Re-export the special tokens so UI modules can import from one place.
export { SECTION_SEASONAL, SECTION_ROOMS };
