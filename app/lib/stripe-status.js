/* global module */
'use strict';

const ERROR_CODES = new Set([
    'unauthorized',
    'rate_limited',
    'provider_error',
    'storage_error',
    'connection_changed',
]);
const badge = (label, color, connectable = false) => ({
    label,
    color,
    connectable,
});

function stripeStatusBadge(status = {}) {
    if (status.configured === false) {
        return badge('Not configured', 'var(--color-warning)');
    }
    if (status.configured !== true) {
        return badge('Configuration unavailable', 'var(--text-muted)');
    }
    if (status.connected !== true) {
        return badge('Not connected', 'var(--text-muted)', true);
    }
    const outcome = status.lastSyncOutcome;
    if (outcome?.partial === true) {
        return badge('Partially synced', 'var(--color-warning)');
    }
    if (outcome?.ok === false) {
        const code = ERROR_CODES.has(outcome.errorCode)
            ? ` (${outcome.errorCode})`
            : '';
        return badge(`Last sync failed${code}`, 'var(--color-danger)');
    }
    return badge(
        status.lastSyncedAt ? 'Connected' : 'Connected — never synced',
        'var(--color-success)',
    );
}

function stripeRecoveryHint(status = {}) {
    if (status.configured === false) {
        return 'Configure a valid 64-character SYNC_MASTER_KEY.';
    }
    if (status.configured !== true) {
        return 'Stripe configuration could not be verified; check the server.';
    }
    if (status.connected !== true) {
        return 'Add a valid Stripe restricted key in Settings to connect.';
    }
    const outcome = status.lastSyncOutcome;
    if (outcome?.partial === true) {
        return 'Run Stripe sync again to continue the partial import.';
    }
    if (outcome?.ok === false) {
        return (
            {
                unauthorized: 'Check the restricted key and replace it if revoked.',
                rate_limited: 'Wait briefly, then retry the Stripe sync.',
                storage_error: 'Check DATA_DIR write access and disk space, then retry.',
            }[outcome.errorCode] ||
            'Check the Stripe connection and server logs, then retry.'
        );
    }
    return status.lastSyncedAt
        ? null
        : 'Start a Stripe sync to import transactions.';
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { stripeStatusBadge, stripeRecoveryHint };
}
