import { describe, it, expect } from 'vitest';
import {
    stripeStatusBadge,
    stripeRecoveryHint,
} from '../../app/lib/stripe-status.js';

describe('stripeStatusBadge', () => {
    it('not configured is a warning and not connectable', () => {
        const b = stripeStatusBadge({ configured: false, connected: false });
        expect(b.label).toBe(
            'Stripe sync available on self-hosted deployments only',
        );
        expect(b.connectable).toBe(false);
    });

    it('connected with a failed last sync shows the error code', () => {
        const b = stripeStatusBadge({
            configured: true,
            connected: true,
            lastSyncOutcome: { ok: false, errorCode: 'INVALID_GRANT' },
        });
        expect(b.label).toBe('Last sync failed (INVALID_GRANT)');
        expect(b.color).toBe('var(--color-danger)');
    });

    it('keeps failed sync visibly failed when errorCode is absent, null, or empty', () => {
        for (const lastSyncOutcome of [
            { ok: false },
            { ok: false, errorCode: null },
            { ok: false, errorCode: '' },
        ]) {
            const b = stripeStatusBadge({
                configured: true,
                connected: true,
                lastSyncOutcome,
            });
            expect(b.label).toBe('Last sync failed');
            expect(b.color).toBe('var(--color-danger)');
            expect(b.connectable).toBe(false);
        }
    });

    it('connected with partial sync shows warning', () => {
        const b = stripeStatusBadge({
            configured: true,
            connected: true,
            lastSyncOutcome: { ok: true, partial: true },
        });
        expect(b.label).toBe('Connected (partial sync)');
        expect(b.color).toBe('var(--color-warning)');
    });

    it('connected is Connected; an absent outcome is not a failure', () => {
        expect(
            stripeStatusBadge({ configured: true, connected: true }).label,
        ).toBe('Connected');
        expect(
            stripeStatusBadge({
                configured: true,
                connected: true,
                lastSyncOutcome: null,
            }).label,
        ).toBe('Connected');
    });

    it('configured but disconnected is connectable', () => {
        expect(
            stripeStatusBadge({
                configured: true,
                connected: false,
            }),
        ).toEqual({
            label: 'Not connected',
            color: 'var(--text-muted)',
            connectable: true,
        });
    });

    it('unknown configured state (null) is connectable', () => {
        expect(
            stripeStatusBadge({
                configured: null,
                connected: false,
            }).connectable,
        ).toBe(true);
    });
});

describe('stripeRecoveryHint', () => {
    it('not configured tells to set env var', () => {
        const hint = stripeRecoveryHint({
            configured: false,
            connected: false,
        });
        expect(hint).toMatch(/SYNC_MASTER_KEY/);
        expect(hint).toMatch(/64 hex characters/);
        expect(hint).toMatch(/self-hosted server/);
    });

    it('connected with failed sync and invalid_grant tells to reconnect', () => {
        const hint = stripeRecoveryHint({
            configured: true,
            connected: true,
            lastSyncOutcome: { ok: false, errorCode: 'invalid_grant' },
        });
        expect(hint).toMatch(/revoked/);
        expect(hint).toMatch(/Reconnect/);
    });

    it('connected with failed sync and token_revoked tells to reconnect', () => {
        const hint = stripeRecoveryHint({
            configured: true,
            connected: true,
            lastSyncOutcome: { ok: false, errorCode: 'token_revoked' },
        });
        expect(hint).toMatch(/revoked/);
        expect(hint).toMatch(/Reconnect/);
    });

    it('connected with failed sync and rate_limited tells to wait', () => {
        const hint = stripeRecoveryHint({
            configured: true,
            connected: true,
            lastSyncOutcome: { ok: false, errorCode: 'rate_limited' },
        });
        expect(hint).toMatch(/Too many requests/);
        expect(hint).toMatch(/Wait/);
    });

    it('connected with failed sync and unknown code gives generic hint', () => {
        const hint = stripeRecoveryHint({
            configured: true,
            connected: true,
            lastSyncOutcome: { ok: false, errorCode: 'UNKNOWN_CODE' },
        });
        expect(hint).toMatch(/Last sync failed/);
        expect(hint).toMatch(/try syncing again/);
    });

    it('connected with failed sync and absent error code gives generic hint', () => {
        for (const lastSyncOutcome of [
            { ok: false },
            { ok: false, errorCode: null },
            { ok: false, errorCode: '' },
        ]) {
            const hint = stripeRecoveryHint({
                configured: true,
                connected: true,
                lastSyncOutcome,
            });
            expect(hint).toMatch(/Last sync failed/);
            expect(hint).toMatch(/try syncing again/);
        }
    });

    it('connected with partial sync suggests manual sync', () => {
        const hint = stripeRecoveryHint({
            configured: true,
            connected: true,
            lastSyncOutcome: { ok: true, partial: true },
        });
        expect(hint).toMatch(/Some data could not be fetched/);
        expect(hint).toMatch(/manual sync/);
    });

    it('healthy connected states have no misleading recovery instruction', () => {
        expect(
            stripeRecoveryHint({
                configured: true,
                connected: true,
            }),
        ).toBe('');
        expect(
            stripeRecoveryHint({
                configured: true,
                connected: true,
                lastSyncOutcome: { ok: true },
            }),
        ).toBe('');
        expect(
            stripeRecoveryHint({
                configured: true,
                connected: true,
                lastSyncOutcome: null,
            }),
        ).toBe('');
    });

    it('configured but not connected says to store restricted key', () => {
        const hint = stripeRecoveryHint({ configured: true, connected: false });
        expect(hint).toMatch(/Store a Stripe restricted key/);
        expect(hint).toMatch(/POST \/api\/sync\/stripe\/credentials/);
        expect(hint).toMatch(/docs\/integrations\.md/);
    });

    it('unknown configured state tells to configure then connect', () => {
        const hint = stripeRecoveryHint({ configured: null, connected: false });
        expect(hint).toMatch(/Configure Stripe/);
        expect(hint).toMatch(/Netlify environment variables/);
        expect(hint).toMatch(/then connect/);
    });
});
