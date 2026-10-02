// Minimal service worker: caches the static app shell for offline/installed
// use, and deliberately never touches /api/* — those must always hit the
// network since they're dynamic, per-user, authenticated data.
//
// Bumped to v3 so every visitor's older cache (which could hold sign-up and
// password-reset link URLs, and error pages) is dropped on activation.
const CACHE_NAME = 'amicohaus-v3';
const SHELL_FILES = [
  '/', '/styles.css', '/client.js', '/favicon.svg',
  '/login', '/page-login.js', '/signup', '/page-signup.js',
];
// Pages whose URL carries a one-time token: never keep a copy.
const NEVER_CACHE = ['/verify-email', '/reset-password'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first, falling back to the cached shell only when the network is
// unavailable (offline/installed-app use). A cache-first strategy here
// previously meant anyone who'd visited before kept seeing whatever shell
// was cached on their first visit forever — nothing ever invalidated it, so
// every deploy after that was invisible to returning visitors.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || NEVER_CACHE.includes(url.pathname)) return;

  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        // Only keep good answers — an error page cached as the offline fallback would outlive the error.
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Pushes are sent with an empty body (see functions/_lib/webpush.js — no
// payload encryption implemented), so there's no per-event detail to show
// here; this is always the same generic nudge to open the app.
self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('Amico Haus', {
      body: 'You have new activity — open the app to see what\'s new.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'amico-haus-update',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/app'));
});
