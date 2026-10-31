/* global module, AbortSignal */
'use strict';

// One eBay status vocabulary for the Financial Overview and Settings cards.
// Pure (no DOM, no fetch) so it runs in the browser and in Vitest. Same shape
// as plaidStatusBadge in side-gig.js (#293). Codes only, never tokens.
function ebayStatusBadge(data) {
    if (data.configured === false) {
        return {
            label: 'eBay is not configured on this deployment (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)',
            color: 'var(--color-warning, var(--color-danger))',
            connectable: false,
        };
    }
    const last = data.lastSyncOutcome;
    if (data.connected && last && last.ok === false) {
        return {
            label: `Last sync failed${last.errorCode ? ` (${last.errorCode})` : ''}`,
            color: 'var(--color-danger)',
            connectable: false,
        };
    }
    if (data.connected) {
        return {
            label: 'Connected',
            color: 'var(--color-success)',
            connectable: false,
        };
    }
    return {
        label: 'Disconnected',
        color: 'var(--text-muted)',
        connectable: data.configured !== false,
    };
}

// Browser-only mode cannot see the deploy's eBay credentials (they live on the
// function), so ask the status endpoint. Unknown (offline, error, no boolean) is null.
async function fetchEbayConfigured(fetchFn) {
    try {
        const res = await fetchFn('/api/sync/ebay/status', {
            cache: 'no-store',
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return null;
        const body = await res.json();
        return typeof body.configured === 'boolean' ? body.configured : null;
    } catch {
        return null;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ebayStatusBadge, fetchEbayConfigured };
}
