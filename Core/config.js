// ─────────────────────────────────────────────────────────────────────
// core/config.js
// Centralized configuration. Edit ONLY this file when keys/IDs change.
// ─────────────────────────────────────────────────────────────────────

export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyB9ztBUJyUvlyycujmDjbTcKT-GIejpsM4",
    authDomain: "victoria-tracker-1d2ab.firebaseapp.com",
    projectId: "victoria-tracker-1d2ab",
    storageBucket: "victoria-tracker-1d2ab.firebasestorage.app",
    messagingSenderId: "893813838454",
    appId: "1:893813838454:web:72ac9f21756d00f8a88557"
};

export const EMAIL_CONFIG = {
    publicKey:  "NBsqPD18bw0R4XtcM",
    serviceId:  "service_gj1f9sj",
    templateId: "template_2cyqti5"
};

export const WEATHER_CONFIG = {
    openWeatherKey: "ff4155f6320e193fc795a67d1b40b6dd",
    openUVKey:      "openuv-q3onrmo2zfflc-io"
};

// Water tracker defaults. goal is per-day ounces; incrementOz is how much
// each tap of the widget/card button adds. Victoria's own goal (once set
// in-app) is stored on the Firestore doc and overrides this default.
// linkedHabitId points at the pre-existing "Drink Water" reward habit so
// every WaterCard/widget tap auto-fills that habit's today bubble instead
// of Victoria tapping it by hand — see water.js syncWaterHabit(). That
// habit's live thresholds are low:4 / goal:6 / bonus:7 / max:7 /
// dailyMax:1, i.e. a one-bubble-per-day shape, which is what it banks.
export const WATER_CONFIG = {
    dailyGoalOz: 120,
    incrementOz: 10,
    linkedHabitId: '1782919978998'
};

// Firestore document paths — [collection, docId]
export const FIRESTORE_DOCS = {
    HABITS:  ['system', 'habits_list'],
    HISTORY: ['system', 'weekly_history'],
    STARS:   ['system', 'star_data'],
    EVENTS:  ['system', 'seasonal_events'],
    RESET:   ['system', 'reset_state'],
    PERIOD:  ['system', 'period_data'],
    ROOMS:   ['system', 'rooms_data'],
    UI:      ['system', 'ui_config'],
    // Weekly plan-ahead bubbles (Planning tab). One doc holds every week's
    // plan, keyed by the week's Monday date ("YYYY-MM-DD").
    PLANS:    ['system', 'weekly_plans'],
    // Calendar events shown in the Planning agenda + used for conflict dots.
    // Google-shaped events; populated by Google Calendar sync once enabled.
    CALENDAR: ['system', 'calendar_events'],
    // Permanent achievement badges — additive, never mutated by week resets.
    ACHIEVEMENTS: ['system', 'achievements_data'],
    // Water tracker: { goal, history: { 'YYYY-MM-DD': ounces } }
    WATER: ['system', 'water_data'],
    // Category-wide payouts: { categories: { [catName]: { punish|low|goal|bonus:
    // { dollars, stars?, restWeek?, dayPass?, freshStart? } } } }.
    // See Core/category-payouts.js.
    CATEGORIES: ['system', 'category_config'],
};

// Google Calendar OAuth. Leave clientId '' to keep the integration disabled
// (the Planning agenda then reads whatever events live in the CALENDAR doc).
export const GOOGLE_CALENDAR_CONFIG = {
    // OAuth client ID from Google Cloud Console
    // (ends in .apps.googleusercontent.com). Empty = integration off.
    // NOTE: this must be a "Web application" OAuth client with
    // https://theironpika.github.io listed as an authorized JavaScript
    // origin, and the Google Calendar API enabled in the project.
    clientId: '177502926746-oqmbou7n8h86hm81gp6rnfb497lbm06r.apps.googleusercontent.com'
};

// Special section IDs for the Today-view section ordering.
// Habit categories use their literal name; these two are reserved tokens
// for the non-habit cards so they can be interleaved with categories.
export const SECTION_SEASONAL = '__seasonal__';
export const SECTION_ROOMS    = '__rooms__';

// Season metadata — months, accent colors, backgrounds, borders.
// Used by both the seasonal events feature and the time-of-day color shift.
export const SEASON_META = {
    spring: { label: 'Spring', months: [3, 4, 5],   accent: '#4a7c1f', bg: 'rgba(240,250,232,0.7)', border: '#b8d98a', badge: '#eaf5d8' },
    summer: { label: 'Summer', months: [6, 7, 8],   accent: '#8a5a00', bg: 'rgba(255,248,225,0.7)', border: '#f5cc70', badge: '#fff8e1' },
    fall:   { label: 'Fall',   months: [9, 10, 11], accent: '#8a3a10', bg: 'rgba(253,240,232,0.7)', border: '#f0a880', badge: '#fdeee5' },
    winter: { label: 'Winter', months: [12, 1, 2],  accent: '#1a5c8a', bg: 'rgba(232,245,253,0.7)', border: '#90c8f0', badge: '#e6f4fd' }
};

// Tier display constants — referenced by reports and history rendering.
export const TIER_COLORS = {
    punish: '#d9534f',
    low:    '#e67e22',
    goal:   '#27ae60',
    bonus:  '#8e44ad'
};

// Lucky draw odds (% chance per completion), keyed by the tier the completion lands in.
export const LUCKY_DRAW_ODDS = {
    punish: 2,
    low:    5,
    goal:   7,
    bonus:  10
};

export const TIER_LABELS = {
    punish: 'DEBT',
    low:    'LOW',
    goal:   'GOAL',
    bonus:  'BONUS'
};

// Single-char tier codes for the email report (keeps payload tiny —
// emoji get JSON-encoded as 12-char escape sequences which can blow up
// the EmailJS 50KB limit).
export const TIER_DOTS = {
    punish: 'D',
    low:    'L',
    goal:   'G',
    bonus:  'B'
};

// Special days — MM-DD strings trigger themed accent + particles + optional love note.
export const SPECIAL_DAYS = {
    birthday:    '04-12',   // Victoria's birthday
    anniversary: '09-23',   // Drew + Victoria anniversary
    victoriaDay: '12-15',   // app's "birthday" — first day the tracker shipped
    custom: [
        { date: '02-14', label: "Valentine's", greeting: "Happy Valentine's,", accent: '#e84a7b', particles: 'hearts' },
    ],
};

// Manage tab passcode.
export const MANAGE_PASSCODE = '1234';

// Limits.
export const HISTORY_MAX_WEEKS = 52;
export const STAR_LOG_MAX = 200;

// Default room list — seeded to Firestore on first use if rooms_data doc doesn't exist.
export const DEFAULT_ROOMS = [
    { id: 'bedroom',    name: 'Bedroom',         icon: '🛏️',  maxStreak: 7, streak: 0, checked: false },
    { id: 'office',     name: 'Office',           icon: '🖥️',  maxStreak: 3, streak: 0, checked: false },
    { id: 'dining',     name: 'Dining Room',      icon: '🍽️',  maxStreak: 4, streak: 0, checked: false },
    { id: 'closet',     name: 'Closet',           icon: '🚪',  maxStreak: 3, streak: 0, checked: false },
    { id: 'masterbath', name: 'Master Bath',      icon: '🛁',  maxStreak: 3, streak: 0, checked: false },
    { id: 'officebath', name: 'Office Bathroom',  icon: '🚿',  maxStreak: 3, streak: 0, checked: false },
    { id: 'kitchen',    name: 'Kitchen',           icon: '🍳',  maxStreak: 4, streak: 0, checked: false },
    { id: 'livingroom', name: 'Living Room',       icon: '🛋️',  maxStreak: 5, streak: 0, checked: false },
    { id: 'basement',   name: 'Basement',          icon: '📦',  maxStreak: 7, streak: 0, checked: false },
    { id: 'garage',     name: 'Garage',            icon: '🚗',  maxStreak: 5, streak: 0, checked: false },
];
