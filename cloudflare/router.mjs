// Route table for the Cloudflare Pages deploy. Mirrors the [[redirects]] in
// netlify.toml one for one, so every public URL (OAuth callbacks, the eBay
// marketplace-account-deletion endpoint, webhooks) stays the same. The
// handlers are the Netlify Functions themselves: they already use the
// Web-standard Request -> Response signature, so they run unchanged here.

import ebayMarketplaceAccountDeletion from '../netlify/functions/ebay-marketplace-account-deletion.mjs';
import ebayAuthorize from '../netlify/functions/ebay-authorize.mjs';
import ebayCallback from '../netlify/functions/ebay-callback.mjs';
import ebaySync from '../netlify/functions/ebay-sync.mjs';
import ebayStatus from '../netlify/functions/ebay-status.mjs';
import plaid from '../netlify/functions/plaid.mjs';
import etsy from '../netlify/functions/etsy.mjs';
import cointracker from '../netlify/functions/cointracker.mjs';
import gdriveBackup from '../netlify/functions/gdrive-backup.mjs';
import fireApi from '../netlify/functions/fire-api.mjs';

// [matcher, handler name]. First match wins, same order as netlify.toml.
const exact = (path) => (p) => p === path || p === `${path}/`;
const prefix = (path) => (p) => p.startsWith(`${path}/`);

export const ROUTES = [
    [
        exact('/api/sync/ebay/marketplace-account-deletion'),
        'ebay-marketplace-account-deletion',
    ],
    [exact('/api/sync/ebay/authorize'), 'ebay-authorize'],
    [exact('/api/sync/ebay/callback'), 'ebay-callback'],
    [exact('/api/sync/ebay/sync'), 'ebay-sync'],
    [exact('/api/sync/ebay/status'), 'ebay-status'],
    [prefix('/api/sync/plaid'), 'plaid'],
    [prefix('/api/sync/etsy'), 'etsy'],
    [prefix('/api/sync/cointracker'), 'cointracker'],
    [exact('/api/backup/drive'), 'gdrive-backup'],
    [prefix('/api/backup/drive'), 'gdrive-backup'],
    [prefix('/api'), 'fire-api'],
];

export const HANDLERS = {
    'ebay-marketplace-account-deletion': ebayMarketplaceAccountDeletion,
    'ebay-authorize': ebayAuthorize,
    'ebay-callback': ebayCallback,
    'ebay-sync': ebaySync,
    'ebay-status': ebayStatus,
    plaid,
    etsy,
    cointracker,
    'gdrive-backup': gdriveBackup,
    'fire-api': fireApi,
};

export function resolveRoute(pathname) {
    for (const [matches, name] of ROUTES) {
        if (matches(pathname)) return name;
    }
    return null;
}

// The handlers read configuration from process.env, as on Netlify. Pages
// hands vars and secrets to the function as `env`, so copy the string
// values across before dispatching.
export function applyEnv(env) {
    if (!env || typeof process === 'undefined') return;
    for (const [key, value] of Object.entries(env)) {
        if (typeof value === 'string') process.env[key] = value;
    }
}

export async function dispatch(request, env) {
    applyEnv(env);
    const name = resolveRoute(new URL(request.url).pathname);
    if (!name) return null;
    return HANDLERS[name](request);
}
