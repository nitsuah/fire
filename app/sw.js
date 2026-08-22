/* FIRE Tracker — Service Worker
   Caches shell assets for offline load. API calls always go to network.
*/
const CACHE_NAME = 'fire-tracker-v2';

// Assets that make up the app shell
const SHELL_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/app.js',
    '/lib/html-utils.js',
    '/lib/state.js',
    '/lib/prices.js',
    '/lib/expenses.js',
    '/lib/projections.js',
    '/lib/side-gig.js',
    '/lib/csv-import.js',
    '/lib/finance-calcs.js',
    '/lib/finance-core.js',
    '/lib/finance-parsing.js',
    '/lib/finance-platforms.js',
    '/lib/ebay-connector.js',
    '/lib/privacy.js',
    '/lib/notifications.js',
    '/lib/charts/cd-ladder.js',
    '/lib/charts/projections.js',
    '/lib/charts/allocation.js',
    '/lib/tables/dashboard.js',
    '/lib/tables/vehicles.js',
    '/lib/tables/real-estate.js',
    '/lib/tables/positions.js',
    '/lib/tables/liquid.js',
    '/lib/tables/fixed-income.js',
    '/lib/tables/side-gig-table.js',
    '/lib/tables/projections-table.js',
    '/lib/tables/tax-harvest.js',
    '/lib/tables/rebalancing.js',
    '/lib/managers/navigation.js',
    '/lib/managers/accounts.js',
    '/lib/managers/cds.js',
    '/lib/managers/real-estate.js',
    '/lib/managers/vehicles.js',
    '/lib/managers/asset-form.js',
    '/lib/css/base.css',
    '/lib/css/components.css',
    '/lib/css/components-data.css',
    '/lib/css/charts.css',
    '/lib/css/layout.css',
    '/lib/css/widgets.css',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL_ASSETS))
            .catch(() => {})
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((k) => k !== CACHE_NAME)
                        .map((k) => caches.delete(k)),
                ),
            ),
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Always go to network for API calls and cross-origin requests
    if (url.pathname.startsWith('/api/') || url.origin !== location.origin) {
        return;
    }

    // Cache-first for shell assets; fall back to network
    event.respondWith(
        caches
            .match(event.request)
            .then((cached) => cached || fetch(event.request)),
    );
});

// Push notification handler
self.addEventListener('push', (event) => {
    if (!event.data) return;
    const data = event.data.json();
    event.waitUntil(
        self.registration.showNotification(data.title || 'FIRE Tracker', {
            body: data.body || '',
            icon: data.icon || '/favicon.ico',
            badge: '/favicon.ico',
            tag: data.tag || 'fire-alert',
            data: data.url ? { url: data.url } : {},
        }),
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const rawUrl = event.notification.data?.url || '/';
    const url = new URL(rawUrl, self.registration.scope).href;
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((wins) => {
            const existing = wins.find((w) => w.url === url && 'focus' in w);
            if (existing) return existing.focus();
            return clients.openWindow(url);
        }),
    );
});
