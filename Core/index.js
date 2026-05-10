/**
 * VICTORIA TRACKER — Core Modules
 * Central export point for all core business logic
 */

export { utils } from './utils.js';
export { habits } from './habits.js';
export { streaks } from './streaks.js';
export { stars } from './stars.js';
export { seasonalEvents } from './events.js';
export { history } from './history.js';
export * from './firebase.js';

// Convenience: export all as a single object
export const core = {
    utils: (await import('./utils.js')).utils,
    habits: (await import('./habits.js')).habits,
    streaks: (await import('./streaks.js')).streaks,
    stars: (await import('./stars.js')).stars,
    events: (await import('./events.js')).seasonalEvents,
    history: (await import('./history.js')).history
};
