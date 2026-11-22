/* global module */
'use strict';

// One Stripe status vocabulary for the Financial Overview and Settings cards.
// Pure (no DOM, no fetch) so it runs in the browser and in Vitest.
// Same shape as ebayStatusBadge in ebay-status.js.
function stripeStatusBadge(data) {
    if (data.configured === false) {
        return {
            label: 'Stripe sync available on self-hosted deployments only',
            color: 'var(--color-warning, var(--color-danger))',
            connectable: false,
        };
    }

    const last = data.lastSyncOutcome;

    // Connected but last sync failed
    if (data.connected && last && last.ok === false) {
        return {
            label: `Last sync failed${last.errorCode ? ` (${last.errorCode})` : ''}`,
            color: 'var(--color-danger)',
            connectable: false,
        };
    }

    // Connected, successful sync but partial
    if (data.connected && last && last.ok === true && last.partial === true) {
        return {
            label: 'Connected (partial sync)',
            color: 'var(--color-warning)',
            connectable: false,
        };
    }

    // Connected, successful sync
    if (data.connected) {
        return {
            label: 'Connected',
            color: 'var(--color-success)',
            connectable: false,
        };
    }

    // Configured but not connected
    if (data.configured === true) {
        return {
            label: 'Not connected',
            color: 'var(--text-muted)',
            connectable: true,
        };
    }

    // Unknown configured state (null/undefined)
    return {
        label: 'Not connected',
        color: 'var(--text-muted)',
        connectable: true,
    };
}

function stripeRecoveryHint(data) {
    if (data.configured === false) {
        return 'Set SYNC_MASTER_KEY (64 hex characters) on your self-hosted server to enable Stripe sync.';
    }

    const last = data.lastSyncOutcome;

    if (data.connected && last && last.ok === false) {
        const code = last.errorCode;
        if (code === 'invalid_grant' || code === 'token_revoked') {
            return 'Stripe access was revoked. Reconnect your Stripe account from Settings.';
        }
        if (code === 'rate_limited') {
            return 'Too many requests. Wait a moment and try syncing again.';
        }
        return 'Last sync failed. Check your connection and try syncing again.';
    }

    if (data.connected && last && last.ok === true && last.partial === true) {
        return 'Some data could not be fetched. Try a manual sync to complete it.';
    }

    if (data.connected) {
        return '';
    }

    if (data.configured === true) {
        return 'Store a Stripe restricted key via POST /api/sync/stripe/credentials (see docs/integrations.md).';
    }

    return 'Configure Stripe in Netlify environment variables, then connect.';
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        stripeStatusBadge,
        stripeRecoveryHint,
    };
}
