import { describe, expect, it } from 'vitest';
import {
    stripeRecoveryHint,
    stripeStatusBadge,
} from '../../app/lib/stripe-status.js';

const connected = { configured: true, connected: true };
const failed = (errorCode) => ({
    ...connected,
    lastSyncOutcome: { ok: false, errorCode },
});

describe('stripeStatusBadge', () => {
    it.each([
        [{ configured: false }, 'Not configured', false],
        [{ ...connected, connected: false }, 'Not connected', true],
        [connected, 'Connected — never synced', false],
        [{ ...connected, lastSyncedAt: 'now' }, 'Connected', false],
        [failed('rate_limited'), 'Last sync failed (rate_limited)', false],
        [
            { ...connected, lastSyncOutcome: { ok: false } },
            'Last sync failed',
            false,
        ],
        [
            { ...connected, lastSyncOutcome: { partial: true } },
            'Partially synced',
            false,
        ],
    ])('maps status to %s', (status, label, connectable) => {
        expect(stripeStatusBadge(status)).toMatchObject({ label, connectable });
    });

    it('hides unknown error codes and handles missing status', () => {
        expect(stripeStatusBadge({
            ...connected,
            lastSyncOutcome: { ok: false, errorCode: '<secret>' },
        }).label).toBe('Last sync failed');
        expect(stripeStatusBadge()).toMatchObject({
            label: 'Configuration unavailable',
            connectable: false,
        });
    });
});

describe('stripeRecoveryHint', () => {
    it.each([
        [{ configured: false }, /SYNC_MASTER_KEY/],
        [{ ...connected, connected: false }, /restricted key/],
        [connected, /Start a Stripe sync/],
        [
            { ...connected, lastSyncOutcome: { partial: true } },
            /partial import/,
        ],
        [failed('unauthorized'), /revoked/],
        [failed('rate_limited'), /Wait briefly/],
        [failed('storage_error'), /DATA_DIR/],
    ])('gives bounded guidance for %s', (status, hint) => {
        expect(stripeRecoveryHint(status)).toMatch(hint);
    });

    it('returns no hint for a healthy synced connection', () => {
        expect(stripeRecoveryHint({
            ...connected,
            lastSyncedAt: 'now',
        })).toBeNull();
    });
});
