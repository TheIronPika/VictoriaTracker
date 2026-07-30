// ─────────────────────────────────────────────────────────────────────
// web/ui/achievement-catalog.js
// Static catalog of all achievements — the display definition only; the
// actual unlock records live in Firestore (Core/achievements.js). Plain-JS
// port of the native app's lib/achievementCatalog.ts, kept identical so a
// badge unlocked in one app shows the same name and art in the other.
//
// Streak achievements use composite IDs (streak_7_<habitId>) so each habit
// can unlock its own badge independently.
// ─────────────────────────────────────────────────────────────────────

export const ACHIEVEMENTS = [
    { id: 'streak_7',            type: 'streak',          threshold: 7,    label: 'Week of consistency',   emoji: '🔥', description: '7-week streak on a habit.' },
    { id: 'streak_30',           type: 'streak',          threshold: 30,   label: 'Month of consistency',  emoji: '🔥', description: '30-week streak on a habit.' },
    { id: 'streak_100',          type: 'streak',          threshold: 100,  label: 'Century streak',        emoji: '🔥', description: '100-week streak on a habit.' },
    { id: 'perfect_week',        type: 'perfect_week',                     label: 'Perfect week',          emoji: '✨', description: 'All habits hit goal or bonus in one week.' },
    { id: 'perfect_month',       type: 'perfect_month',                    label: 'Perfect month',         emoji: '✨', description: 'Four consecutive perfect weeks.' },
    { id: 'first_thousand',      type: 'earnings_total',  threshold: 1000, label: 'First $1,000 earned',   emoji: '💰', description: 'Cumulative weekly earnings reached $1,000.' },
    { id: 'first_five_thousand', type: 'earnings_total',  threshold: 5000, label: 'Five thousand earned',  emoji: '💰', description: 'Cumulative weekly earnings reached $5,000.' },
    { id: 'shop_first',          type: 'shop_first',                       label: 'First reward redeemed', emoji: '🛒', description: 'Redeemed a reward from the star shop.' },
    { id: 'shop_ten',            type: 'shop_count',      threshold: 10,   label: 'Ten rewards redeemed',  emoji: '🛒', description: 'Redeemed ten rewards from the star shop.' },
    { id: 'bounty_first',        type: 'bounty_completed',                 label: 'First bounty claimed',  emoji: '🏆', description: 'Successfully completed a habit bounty.' },
    { id: 'water_streak_7',      type: 'water_streak',    threshold: 7,    label: 'Week of hydration',     emoji: '💧', description: '7-day water goal streak.' },
    { id: 'water_streak_30',     type: 'water_streak',    threshold: 30,   label: 'Month of hydration',    emoji: '💧', description: '30-day water goal streak.' },
    { id: 'water_streak_100',    type: 'water_streak',    threshold: 100,  label: 'Century of hydration',  emoji: '💧', description: '100-day water goal streak.' },
];

// Maps milestone week counts to catalog IDs for habit streak achievements.
export const MILESTONE_TO_ACHIEVEMENT = {
    1:  'streak_7',
    4:  'streak_30',
    14: 'streak_100',
};

// Maps water streak day counts to catalog IDs (days, not weeks — water is
// a daily tracker, so this is a separate scale from MILESTONE_TO_ACHIEVEMENT).
export const WATER_MILESTONE_TO_ACHIEVEMENT = {
    7:   'water_streak_7',
    30:  'water_streak_30',
    100: 'water_streak_100',
};
