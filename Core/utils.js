// ─────────────────────────────────────────────────────────────────────
// core/utils.js
// Pure utility functions. No state, no Firebase, no DOM dependencies.
// Safe to import anywhere.
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert a Date's day-of-week to a Monday-first index (0..6).
 * Sunday is mapped to 6 (end of week).
 */
export function getDayIdx(d) {
    let day = d.getDay();
    return (day === 0) ? 6 : day - 1;
}

/**
 * Returns the season key ('spring' | 'summer' | 'fall' | 'winter')
 * for the current month, given a SEASON_META lookup table.
 */
export function getCurrentSeason(seasonMeta) {
    const m = new Date().getMonth() + 1;
    for (const [key, meta] of Object.entries(seasonMeta)) {
        if (meta.months.includes(m)) return key;
    }
    return 'spring';
}

/**
 * Format a timestamp into "M/D" (e.g. "11/24").
 */
export function shortDate(ts) {
    const d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate();
}

/**
 * Format a Date into "Month D, YYYY" (e.g. "November 24, 2025").
 */
export function longDate(d = new Date()) {
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

/**
 * Format a number as a US-dollar string with sign prefix.
 *   formatMoney(-1.5)  -> "-$1.50"
 *   formatMoney(2)     -> "$2.00"
 *   formatMoney(2, true) -> "+$2.00"
 */
export function formatMoney(n, alwaysShowSign = false) {
    const abs = Math.abs(n).toFixed(2);
    if (n < 0) return '-$' + abs;
    return (alwaysShowSign ? '+$' : '$') + abs;
}

/**
 * Escape a value for safe use in HTML text content / attribute values.
 * Used wherever user-entered strings (habit names, notes, event names,
 * shop item names, star log reasons) flow into innerHTML template literals.
 * Single-user app so XSS isn't the threat — the real bug is that a stray
 * `<` in a name corrupts layout. null/undefined render as empty string.
 */
export function escapeHtml(v) {
    if (v === null || v === undefined) return '';
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
