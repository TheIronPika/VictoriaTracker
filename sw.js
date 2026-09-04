// ⚠️ BUMP THIS ON EVERY DEPLOY THAT TOUCHES A SHELL FILE.
// The fetch handler below is cache-first for the whole shell (index.html
// included) and `activate` only deletes caches whose key !== CACHE — so
// leaving this unchanged purges nothing and installed devices keep serving the
// old modules forever. Because sw.js itself is then byte-identical, the browser
// never installs a new worker either, so skipWaiting() never runs.
// This sat at v40 from 2026-08-07 to 2026-09-03 while six commits shipped
// (task locks, rest-week streaks, History collapse, name/cat trim) — none of
// which reached an installed device.
const CACHE = 'victoria-v42';

// App shell files to cache on install.
// NOTE: Folder is `Core/` (capital C) on disk — GitHub Pages is case-sensitive,
// so the paths here must match exactly or cache.addAll() rejects the whole batch
// and offline install silently fails. Keep these aligned with the real layout.
const SHELL = [
  '/VictoriaTracker/',
  '/VictoriaTracker/index.html',
  '/VictoriaTracker/manifest.json',
  '/VictoriaTracker/icons/icon-192.png',
  '/VictoriaTracker/icons/icon-512.png',
  '/VictoriaTracker/Core/config.js',
  '/VictoriaTracker/Core/state.js',
  '/VictoriaTracker/Core/utils.js',
  '/VictoriaTracker/Core/habits.js',
  '/VictoriaTracker/Core/habits-data.js',
  '/VictoriaTracker/Core/cycles.js',
  // Added 2026-09-03. Shipped with the task-lock feature on 2026-09-02 but was
  // never listed here, and it's a top-level import in render.js and
  // habits-ui.js — so a cold OFFLINE start couldn't resolve the module graph
  // and the app rendered blank.
  '/VictoriaTracker/Core/locks.js',
  '/VictoriaTracker/Core/streaks.js',
  '/VictoriaTracker/Core/stars.js',
  '/VictoriaTracker/Core/events.js',
  '/VictoriaTracker/Core/history.js',
  '/VictoriaTracker/Core/period.js',
  '/VictoriaTracker/Core/rooms.js',
  '/VictoriaTracker/Core/section-order.js',
  '/VictoriaTracker/Core/planning.js',
  '/VictoriaTracker/Core/calendar.js',
  '/VictoriaTracker/Core/firebase.js',
  '/VictoriaTracker/Core/water.js',
  '/VictoriaTracker/Core/achievements.js',
  '/VictoriaTracker/Core/resetState.js',
  '/VictoriaTracker/Core/weeklyReset.js',
  '/VictoriaTracker/Core/category-payouts.js',
  '/VictoriaTracker/Core/category-config.js',
  '/VictoriaTracker/web/ui/render.js',
  '/VictoriaTracker/web/ui/ui-state.js',
  '/VictoriaTracker/web/ui/habits-ui.js',
  '/VictoriaTracker/web/ui/events-ui.js',
  '/VictoriaTracker/web/ui/shop-ui.js',
  '/VictoriaTracker/web/ui/manage-ui.js',
  '/VictoriaTracker/web/ui/history-ui.js',
  '/VictoriaTracker/web/ui/period-ui.js',
  '/VictoriaTracker/web/ui/rooms-ui.js',
  '/VictoriaTracker/web/ui/planning-ui.js',
  '/VictoriaTracker/web/ui/google-calendar.js',
  '/VictoriaTracker/web/ui/lucky-draw.js',
  '/VictoriaTracker/web/ui/animations.js',
  '/VictoriaTracker/web/ui/water-ui.js',
  '/VictoriaTracker/web/ui/vessel-geometry.js',
  '/VictoriaTracker/web/ui/achievements-ui.js',
  '/VictoriaTracker/web/ui/achievement-catalog.js',
];

// Install: cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for Firebase/CDN, cache-first for app shell
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always go network-first for Firebase, EmailJS, CDN resources
  const networkOnly = [
    'firestore.googleapis.com',
    'firebase.googleapis.com',
    'api.emailjs.com',
    'api.openweathermap.org',
    'api.openuv.io',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    // Google Calendar sign-in (GIS) + Calendar API — never cache.
    'accounts.google.com',
    'www.googleapis.com',
  ];

  if (networkOnly.some(d => url.hostname.includes(d))) {
    return; // Let browser handle it normally
  }

  // Cache-first for app shell files
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Cache valid responses for app files
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
      // No offline fallback — the cached branch above already covers shell
      // files, and a `.catch(() => cached)` here would always resolve to
      // null since `cached` was falsy to reach this point.
    })
  );
});
