/**
 * VICTORIA TRACKER — Seasonal Events
 * Date-based events with completion tracking
 */

export const seasonalEvents = {
    /**
     * Season metadata for styling
     */
    SEASON_META: {
        spring: {
            label: 'Spring',
            months: [3, 4, 5],
            accent: '#4a7c1f',
            bg: 'rgba(240,250,232,0.7)',
            border: '#b8d98a',
            badge: '#eaf5d8'
        },
        summer: {
            label: 'Summer',
            months: [6, 7, 8],
            accent: '#8a5a00',
            bg: 'rgba(255,248,225,0.7)',
            border: '#f5cc70',
            badge: '#fff8e1'
        },
        fall: {
            label: 'Fall',
            months: [9, 10, 11],
            accent: '#8a3a10',
            bg: 'rgba(253,240,232,0.7)',
            border: '#f0a880',
            badge: '#fdeee5'
        },
        winter: {
            label: 'Winter',
            months: [12, 1, 2],
            accent: '#1a5c8a',
            bg: 'rgba(232,245,253,0.7)',
            border: '#90c8f0',
            badge: '#e6f4fd'
        }
    },

    /**
     * Get current season
     */
    getCurrentSeason() {
        const m = new Date().getMonth() + 1;
        for (const [key, meta] of Object.entries(this.SEASON_META)) {
            if (meta.months.includes(m)) return key;
        }
        return 'spring';
    },

    /**
     * Get season by month
     */
    getSeasonByMonth(month) {
        for (const [key, meta] of Object.entries(this.SEASON_META)) {
            if (meta.months.includes(month)) return key;
        }
        return 'spring';
    },

    /**
     * Check if an event is currently in its date range
     */
    isEventActive(event) {
        const today = new Date();
        const m = today.getMonth() + 1;
        const d = today.getDate();

        const start = event.startMonth * 100 + event.startDay;
        const end = event.endMonth * 100 + event.endDay;
        const now = m * 100 + d;

        let inRange;
        if (start <= end) {
            inRange = now >= start && now <= end;
        } else {
            // Wraps across year boundary (e.g. Dec–Feb)
            inRange = now >= start || now <= end;
        }

        if (!inRange) return false;

        // Auto-reset completions each year
        const y = today.getFullYear();
        if ((event.resetYear || 0) < y) return true;

        return true;
    },

    /**
     * Check if an event is completed
     */
    isEventCompleted(event) {
        return event.completions >= event.maxCompletions;
    },

    /**
     * Increment event completion
     */
    completeEvent(event) {
        const y = new Date().getFullYear();
        const updated = { ...event };

        // Auto-reset if new year
        if ((updated.resetYear || 0) < y) {
            updated.completions = 0;
            updated.resetYear = y;
        }

        if (updated.completions < updated.maxCompletions) {
            updated.completions++;
            updated.resetYear = y;
        }

        return updated;
    },

    /**
     * Decrement event completion
     */
    uncompleteEvent(event) {
        if (event.completions <= 0) return event;
        return { ...event, completions: event.completions - 1 };
    },

    /**
     * Calculate days remaining in event
     */
    daysRemaining(event) {
        const today = new Date();
        const endDate = new Date(today.getFullYear(), event.endMonth - 1, event.endDay);
        return Math.max(0, Math.ceil((endDate - today) / 86400000));
    },

    /**
     * Create a new event
     */
    createEvent(data) {
        return {
            id: Date.now().toString(),
            name: data.name,
            icon: data.icon || '🗓️',
            note: data.note || '',
            startMonth: data.startMonth,
            startDay: data.startDay,
            endMonth: data.endMonth,
            endDay: data.endDay,
            maxCompletions: data.maxCompletions || 1,
            completions: 0,
            payout: data.payout || 5,
            resetYear: new Date().getFullYear()
        };
    }
};

export default seasonalEvents;
