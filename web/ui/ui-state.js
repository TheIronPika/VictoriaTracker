// ─────────────────────────────────────────────────────────────────────
// web/ui/ui-state.js
// UI-local state — view-specific variables that have nothing to do with
// Firebase data. Imported by every UI module so they share one source
// of truth for things like which category is open, sort lock, etc.
// ─────────────────────────────────────────────────────────────────────

export const uiState = {
    // Kept in sync by the watchHabits callback in index.html
    habits: [],

    // Date navigation
    viewingDate: new Date(),

    // Filter bar — which tier is highlighted (null = all)
    activeFilter: null,

    // The habit id that should play the "arrive" animation on next render
    lastActedId: null,

    // Chart.js instances — tracked so we can destroy before rebuilding
    historyCharts: [],

    // Animated balance counter state
    displayedMoney: 0,
    moneyAnimFrame: null,

    // Priority tab mode: 'goal' | 'bonus'
    priorityMode: localStorage.getItem('priorityMode') || 'goal',

    // Sort lock: when true, completed tasks stay in place
    sortLocked: localStorage.getItem('sortLocked') === '1',

    // Last category the user interacted with — survives reload
    lastActiveCat: localStorage.getItem('lastActiveCat') || null,

    // Category collapse map { [catName]: boolean }
    collapsed: (() => {
        try { return JSON.parse(localStorage.getItem('collapsedState') || '{}'); }
        catch (e) { return {}; }
    })(),

    // Seasonal events section collapsed
    seasonalCollapsed: localStorage.getItem('seasonalCollapsed') !== 'false',

    // Item pending confirmation in the star shop
    pendingRedeem: null,

    // Shared Web Audio context — lazily created on first use
    audioCtx: null,

    // Long-press timer handle
    longPressTimer: null,
};

// ─── Persistence helpers ──────────────────────────────────────────────

export function saveCollapsedState() {
    localStorage.setItem('collapsedState', JSON.stringify(uiState.collapsed));
    if (uiState.lastActiveCat) localStorage.setItem('lastActiveCat', uiState.lastActiveCat);
    else localStorage.removeItem('lastActiveCat');
}
