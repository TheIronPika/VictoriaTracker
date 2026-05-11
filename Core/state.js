// ─────────────────────────────────────────────────────────────────────
// core/state.js
// Shared in-memory state. All modules read/write through this object.
// Keep this minimal — UI-specific state (collapsed, lastActedId, etc.)
// stays in the web layer, not here.
// ─────────────────────────────────────────────────────────────────────

export const state = {
    // Habits
    habits: [],

    // Weekly history snapshots (most recent first, max HISTORY_MAX_WEEKS).
    weeklyHistory: [],
    historyLoaded: false,

    // Seasonal events
    seasonalEvents: [],
    eventsLoaded: false,

    // Star system
    starBalance: 0,
    starsSpent:  0,
    shopItems:   [],
    starLog:     [],
    shopLoaded:  false,

    // Bookkeeping
    initialLoadDone: false,

    // Period tracking (system/period_data)
    periodData: { active: false, startTs: null, startDayIdx: null, history: [], periodWasThisWeek: false },
    periodLoaded: false,

    // Room check system (system/rooms_data)
    roomsData: [],
    roomsLoaded: false,
    roomsCollapsed: localStorage ? (localStorage.getItem('roomsCollapsed') !== 'false') : true,
};

// ─── Mutators ────────────────────────────────────────────────────────
// Going through setters (vs. direct writes) lets us add validation,
// change events, or persistence hooks later without touching callers.

export function setHabits(list)        { state.habits = list; }
export function setWeeklyHistory(list) { state.weeklyHistory = list; }
export function setSeasonalEvents(list){ state.seasonalEvents = list; }
export function setStarBalance(n)      { state.starBalance = n; }
export function setStarsSpent(n)       { state.starsSpent = n; }
export function setShopItems(list)     { state.shopItems = list; }
export function setStarLog(list)       { state.starLog = list; }
