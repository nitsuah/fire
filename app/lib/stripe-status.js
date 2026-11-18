/* global module */
'use strict';

const STRIPE_ERROR_CODES = new Set([
    'unauthorized',
    'rate_limited',
    'provider_error',
    'storage_error',
    'connection_changed',
]);

function stripeStatusBadge(status = {}) {
    if (status.configured === false) {
        return {
            label: 'Not configured',
            color: 'var(--color-warning)',
            connectable: false,
        };
    }
    if (status.configured !== true) {
        return {
            label: 'Configuration unavailable',
            color: 'var(--text-muted)',
            connectable: false,
        };
    }
    if (status.connected !== true) {
        return {
            label: 'Not connected',
            color: 'var(--text-muted)',
            connectable: true,
        };
    }
    const outcome = status.lastSyncOutcome;
    if (outcome?.partial === true) {
        return {
            label: 'Partially synced',
            color: 'var(--color-warning)',
            connectable: false,
        };
    }
    if (outcome?.ok === false) {
        const code = STRIPE_ERROR_CODES.has(outcome.errorCode)
            ? ` (${outcome.errorCode})`
            : '';
        return {
            label: `Last sync failed${code}`,
            color: 'var(--color-danger)',
            connectable: false,
        };
    }
    if (!status.lastSyncedAt) {
        return {
            label: 'Connected — never synced',
            color: 'var(--color-success)',
            connectable: false,
        };
    }
    return {
        label: 'Connected',
        color: 'var(--color-success)',
        connectable: false,
    };
}

function stripeRecoveryHint(status = {}) {
    if (status.configured === false) {
        return 'Configure a valid 64-character SYNC_MASTER_KEY on this deployment.';
    }
    if (status.configured !== true) {
        return 'Stripe configuration could not be verified; check the server configuration.';
    }
    if (status.connected !== true) {
        return 'Add a valid Stripe restricted key in Settings to connect.';
    }
    const outcome = status.lastSyncOutcome;
    if (outcome?.partial === true) {
        return 'Run Stripe sync again to continue the partial import.';
    }
    if (outcome?.ok === false) {
        if (outcome.errorCode === 'unauthorized') {
            return 'Check the restricted key and replace it if it has been revoked.';
        }
        if (outcome.errorCode === 'rate_limited') {
            return 'Wait briefly, then retry the Stripe sync.';
        }
        if (outcome.errorCode === 'storage_error') {
            return 'Check DATA_DIR write access and available disk space, then retry.';
        }
        return 'Check the Stripe connection and server logs, then retry the sync.';
    }
    if (!status.lastSyncedAt) {
        return 'Start a Stripe sync to import transactions.';
    }
    return null;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { stripeStatusBadge, stripeRecoveryHint };
}
