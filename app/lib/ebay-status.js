/* global module, AbortSignal, localStorage */
'use strict';

const EBAY_LAST_OUTCOME_KEY = 'fire_tracker_ebay_last_sync_outcome';

function defaultEbayStorage() {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

function ebayBuildOutcome(input = {}) {
    const value =
        input && typeof input === 'object' && !Array.isArray(input)
            ? input
            : {};
    const at = typeof value.at === 'string' ? value.at : null;
    const ok = value.ok === true;
    const errorCode =
        typeof value.errorCode === 'string' &&
        /^[a-z0-9_-]{1,64}$/i.test(value.errorCode)
            ? value.errorCode.toLowerCase()
            : null;
    return { at, ok, errorCode };
}

function ebayReadOutcome(storage = defaultEbayStorage()) {
    try {
        if (!storage || typeof storage.getItem !== 'function') return null;
        const raw = storage.getItem(EBAY_LAST_OUTCOME_KEY);
        if (typeof raw !== 'string' || raw.trim() === '') return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        if (
            (parsed.at !== null && typeof parsed.at !== 'string') ||
            typeof parsed.ok !== 'boolean'
        ) {
            return null;
        }
        return ebayBuildOutcome(parsed);
    } catch {
        return null;
    }
}

function ebayWriteOutcome(storage, outcome) {
    try {
        const target = storage || defaultEbayStorage();
        if (!target) return null;
        if (
            outcome == null ||
            typeof outcome !== 'object' ||
            Array.isArray(outcome)
        ) {
            if (typeof target.removeItem === 'function') {
                target.removeItem(EBAY_LAST_OUTCOME_KEY);
            }
            return null;
        }
        if (typeof target.setItem !== 'function') return null;
        const normalized = ebayBuildOutcome(outcome);
        target.setItem(EBAY_LAST_OUTCOME_KEY, JSON.stringify(normalized));
        return normalized;
    } catch {
        return null;
    }
}

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
    module.exports = {
        EBAY_LAST_OUTCOME_KEY,
        ebayBuildOutcome,
        ebayReadOutcome,
        ebayWriteOutcome,
        ebayStatusBadge,
        fetchEbayConfigured,
    };
}
