const CACHE = 'victoria-v9';

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
  '/VictoriaTracker/Core/streaks.js',
  '/VictoriaTracker/Core/stars.js',
  '/VictoriaTracker/Core/events.js',
  '/VictoriaTracker/Core/history.js',
  '/VictoriaTracker/Core/period.js',
  '/VictoriaTracker/Core/rooms.js',
  '/VictoriaTracker/Core/section-order.js',
  '/VictoriaTracker/Core/firebase.js',
  '/VictoriaTracker/web/ui/render.js',
  '/VictoriaTracker/web/ui/ui-state.js',
  '/VictoriaTracker/web/ui/habits-ui.js',
  '/VictoriaTracker/web/ui/events-ui.js',
  '/VictoriaTracker/web/ui/shop-ui.js',
  '/VictoriaTracker/web/ui/manage-ui.js',
  '/VictoriaTracker/web/ui/history-ui.js',
  '/VictoriaTracker/web/ui/period-ui.js',
  '/VictoriaTracker/web/ui/rooms-ui.js',
  '/VictoriaTracker/web/ui/lucky-draw.js',
  '/VictoriaTracker/web/ui/animations.js',
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
      }).catch(() => cached); // Fallback to cache if offline
    })
  );
});
