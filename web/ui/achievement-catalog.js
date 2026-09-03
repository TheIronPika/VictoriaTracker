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
    // `threshold` here is the DAY count the id is named for; the trigger runs on
    // WEEKS (see MILESTONE_TO_ACHIEVEMENT below), so the descriptions state the
    // real weekly requirement. Don't "fix" the ids to match the weeks — they're
    // the keys already stored in the shared achievements doc, and renaming them
    // would orphan every badge Victoria has unlocked.
    { id: 'streak_7',            type: 'streak',          threshold: 7,    label: 'Week of consistency',   emoji: '🔥', description: 'One week at goal or bonus on a habit.' },
    { id: 'streak_30',           type: 'streak',          threshold: 30,   label: 'Month of consistency',  emoji: '🔥', description: 'Four weeks in a row at goal or bonus.' },
    { id: 'streak_100',          type: 'streak',          threshold: 100,  label: 'Century streak',        emoji: '🔥', description: '14 weeks in a row at goal or bonus (~100 days).' },
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

// Maps milestone WEEK counts to catalog IDs. The ids are named for the rough
// day-equivalents (7d ≈ 1w, 30d ≈ 4w, 100d ≈ 14w) — that mismatch is why the
// badge copy used to claim a seven-week streak after one good week. Keys here
// are the source of truth for when a milestone fires; see web/ui/animations.js.
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
