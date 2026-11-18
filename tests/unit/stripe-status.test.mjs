import { describe, expect, it } from 'vitest';
import {
    stripeRecoveryHint,
    stripeStatusBadge,
} from '../../app/lib/stripe-status.js';

describe('stripeStatusBadge', () => {
    it.each([
        [{ configured: false }, 'Not configured', false],
        [{ configured: true, connected: false }, 'Not connected', true],
        [
            { configured: true, connected: true },
            'Connected — never synced',
            false,
        ],
        [
            { configured: true, connected: true, lastSyncedAt: 'now' },
            'Connected',
            false,
        ],
        [
            {
                configured: true,
                connected: true,
                lastSyncOutcome: { ok: false, errorCode: 'rate_limited' },
            },
            'Last sync failed (rate_limited)',
            false,
        ],
        [
            { configured: true, connected: true, lastSyncOutcome: { ok: false } },
            'Last sync failed',
            false,
        ],
        [
            {
                configured: true,
                connected: true,
                lastSyncOutcome: { partial: true, ok: false },
            },
            'Partially synced',
            false,
        ],
    ])('maps status to %s', (status, label, connectable) => {
        expect(stripeStatusBadge(status)).toMatchObject({ label, connectable });
    });

    it('does not expose unknown error codes or trust missing status', () => {
        expect(
            stripeStatusBadge({
                configured: true,
                connected: true,
                lastSyncOutcome: { ok: false, errorCode: '<secret>' },
            }).label,
        ).toBe('Last sync failed');
        expect(stripeStatusBadge()).toMatchObject({
            label: 'Configuration unavailable',
            connectable: false,
        });
    });
});

describe('stripeRecoveryHint', () => {
    it.each([
        [{ configured: false }, /SYNC_MASTER_KEY/],
        [{ configured: true, connected: false }, /restricted key/],
        [{ configured: true, connected: true }, /Start Stripe sync/],
        [
            { configured: true, connected: true, lastSyncOutcome: { partial: true } },
            /continue the partial import/,
        ],
        [
            {
                configured: true,
                connected: true,
                lastSyncOutcome: { ok: false, errorCode: 'unauthorized' },
            },
            /revoked/,
        ],
        [
            {
                configured: true,
                connected: true,
                lastSyncOutcome: { ok: false, errorCode: 'rate_limited' },
            },
            /Wait briefly/,
        ],
        [
            {
                configured: true,
                connected: true,
                lastSyncOutcome: { ok: false, errorCode: 'storage_error' },
            },
            /DATA_DIR/,
        ],
    ])('provides bounded guidance for %s', (status, hint) => {
        expect(stripeRecoveryHint(status)).toMatch(hint);
    });

    it('returns no recovery hint for a healthy synced connection', () => {
        expect(
            stripeRecoveryHint({
                configured: true,
                connected: true,
                lastSyncedAt: 'now',
            }),
        ).toBeNull();
    });
});
