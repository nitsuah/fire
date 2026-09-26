/* FIRE Tracker — Service Worker
   Caches shell assets for offline load. API calls always go to network.
   Shell assets are network-first: the cache is only an offline fallback.
   (Cache-first under a fixed CACHE_NAME kept serving old JS after every
   deploy, so fixes never reached browsers that had the worker installed.)
*/
const CACHE_NAME = 'fire-tracker-v3';

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
    '/lib/charts/net-worth-history.js',
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
    '/lib/css/charts.css',
    '/lib/css/layout.css',
    '/lib/css/widgets.css',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())
            .catch((err) => {
                console.error('[SW] Precache failed, install aborted:', err);
                throw err;
            }),
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

    // Network-first for shell assets, refreshing the offline copy; fall
    // back to the cache only when the network is unavailable.
    if (event.request.method !== 'GET') return;
    event.respondWith(
        fetch(event.request)
            .then((res) => {
                if (res.ok) {
                    const copy = res.clone();
                    caches
                        .open(CACHE_NAME)
                        .then((cache) => cache.put(event.request, copy))
                        .catch(() => {});
                }
                return res;
            })
            .catch(() =>
                caches
                    .match(event.request)
                    .then((cached) => cached || Response.error()),
            ),
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
