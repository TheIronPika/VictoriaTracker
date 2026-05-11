const CACHE = 'victoria-v1';

// App shell files to cache on install
const SHELL = [
  '/VictoriaTracker/',
  '/VictoriaTracker/index.html',
  '/VictoriaTracker/manifest.json',
  '/VictoriaTracker/icons/icon-192.png',
  '/VictoriaTracker/icons/icon-512.png',
  '/VictoriaTracker/core/config.js',
  '/VictoriaTracker/core/state.js',
  '/VictoriaTracker/core/utils.js',
  '/VictoriaTracker/core/habits.js',
  '/VictoriaTracker/core/habits-data.js',
  '/VictoriaTracker/core/cycles.js',
  '/VictoriaTracker/core/streaks.js',
  '/VictoriaTracker/core/stars.js',
  '/VictoriaTracker/core/events.js',
  '/VictoriaTracker/core/history.js',
  '/VictoriaTracker/core/reports.js',
  '/VictoriaTracker/core/firebase.js',
  '/VictoriaTracker/web/ui/render.js',
  '/VictoriaTracker/web/ui/ui-state.js',
  '/VictoriaTracker/web/ui/habits-ui.js',
  '/VictoriaTracker/web/ui/events-ui.js',
  '/VictoriaTracker/web/ui/shop-ui.js',
  '/VictoriaTracker/web/ui/manage-ui.js',
  '/VictoriaTracker/web/ui/history-ui.js',
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
