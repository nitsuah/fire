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
        [
            { configured: false },
            'Not configured',
            false,
            'var(--color-warning)',
        ],
        [
            { ...connected, connected: false },
            'Not connected',
            true,
            'var(--text-muted)',
        ],
        [connected, 'Connected — never synced', false, 'var(--color-success)'],
        [
            { ...connected, lastSyncedAt: 'now' },
            'Connected',
            false,
            'var(--color-success)',
        ],
        [
            failed('rate_limited'),
            'Last sync failed (rate_limited)',
            false,
            'var(--color-danger)',
        ],
        [
            { ...connected, lastSyncOutcome: { ok: false } },
            'Last sync failed',
            false,
            'var(--color-danger)',
        ],
        [
            { ...connected, lastSyncOutcome: { partial: true } },
            'Partially synced',
            false,
            'var(--color-warning)',
        ],
        [
            {
                ...connected,
                lastSyncOutcome: {
                    ok: false,
                    partial: true,
                    errorCode: 'unauthorized',
                },
            },
            'Partially synced; last sync failed (unauthorized)',
            false,
            'var(--color-danger)',
        ],
    ])('maps status to %s', (status, label, connectable, color) => {
        expect(stripeStatusBadge(status)).toEqual({
            label,
            connectable,
            color,
        });
    });

    it('hides unknown error codes and handles missing status', () => {
        expect(
            stripeStatusBadge({
                ...connected,
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
        [{ ...connected, connected: false }, /restricted key/],
        [connected, /Start a Stripe sync/],
        [
            { ...connected, lastSyncOutcome: { partial: true } },
            /partial import/,
        ],
        [failed('unauthorized'), /revoked/],
        [failed('rate_limited'), /Wait briefly/],
        [failed('storage_error'), /DATA_DIR/],
        [
            {
                ...connected,
                lastSyncOutcome: {
                    ok: false,
                    partial: true,
                    errorCode: 'unauthorized',
                },
            },
            /revoked/,
        ],
        [failed('constructor'), /server logs/],
    ])('gives bounded guidance for %s', (status, hint) => {
        expect(stripeRecoveryHint(status)).toMatch(hint);
    });

    it('returns no hint for a healthy synced connection', () => {
        expect(
            stripeRecoveryHint({
                ...connected,
                lastSyncedAt: 'now',
            }),
        ).toBeNull();
    });
});
