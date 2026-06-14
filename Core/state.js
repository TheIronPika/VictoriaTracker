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
    starBalance:   0,
    starsSpent:    0,
    shopItems:     [],
    starLog:       [],
    excuseTokens:  0,
    shopLoaded:    false,

    // Bookkeeping
    initialLoadDone: false,

    // Period tracking (system/period_data)
    periodData: { active: false, startTs: null, startDayIdx: null, history: [], periodWasThisWeek: false },
    periodLoaded: false,

    // Room check system (system/rooms_data)
    roomsData: [],
    roomsLoaded: false,
    roomsCollapsed: localStorage ? (localStorage.getItem('roomsCollapsed') !== 'false') : true,

    // Today-view section order (system/ui_config).
    // Array of strings: each is either a category name or one of the
    // SECTION_SEASONAL / SECTION_ROOMS reserved tokens. Sections present in
    // the app but missing from this list are appended at the end in their
    // natural order — so a fresh install / new category Just Works.
    sectionOrder: [],
    sectionOrderLoaded: false,

    // Weekly plan-ahead bubbles (Planning tab). Map keyed by the week's
    // Monday date ("YYYY-MM-DD"); each value is { [habitId]: [bool x7] }
    // for Mon..Sun. Intent only — never touches habit.history.
    weeklyPlans: {},
    weeklyPlansLoaded: false,

    // Calendar events for the Planning agenda + conflict dots.
    // Each event: { id, title, startISO, endISO, allDay? }.
    calendarEvents: [],
    calendarLoaded: false,
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
export function setExcuseTokens(n)     { state.excuseTokens = n; }
export function setSectionOrder(list)  { state.sectionOrder = Array.isArray(list) ? list : []; }
export function setWeeklyPlans(map)    { state.weeklyPlans = (map && typeof map === 'object') ? map : {}; }
export function setCalendarEvents(list){ state.calendarEvents = Array.isArray(list) ? list : []; }
