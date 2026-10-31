import { describe, it, expect, vi } from 'vitest';
import {
    ebayStatusBadge,
    fetchEbayConfigured,
} from '../../app/lib/ebay-status.js';

describe('ebayStatusBadge', () => {
    it('not configured is a warning and not connectable', () => {
        const b = ebayStatusBadge({ configured: false, connected: false });
        expect(b.label).toMatch(/not configured on this deployment/);
        expect(b.connectable).toBe(false);
    });

    it('connected with a failed last sync shows the error code', () => {
        const b = ebayStatusBadge({
            configured: true,
            connected: true,
            lastSyncOutcome: { ok: false, errorCode: 'TIMEOUT' },
        });
        expect(b.label).toBe('Last sync failed (TIMEOUT)');
        expect(b.color).toBe('var(--color-danger)');
    });

    it('connected is Connected; an absent outcome is not a failure', () => {
        expect(
            ebayStatusBadge({ configured: true, connected: true }).label,
        ).toBe('Connected');
        expect(
            ebayStatusBadge({
                configured: true,
                connected: true,
                lastSyncOutcome: null,
            }).label,
        ).toBe('Connected');
    });

    it('disconnected is connectable; offline (configured null) is connectable too', () => {
        expect(ebayStatusBadge({ configured: true, connected: false })).toEqual(
            {
                label: 'Disconnected',
                color: 'var(--text-muted)',
                connectable: true,
            },
        );
        expect(
            ebayStatusBadge({ configured: null, connected: false }).connectable,
        ).toBe(true);
    });
});

describe('fetchEbayConfigured', () => {
    const stub =
        (body, ok = true) =>
        async () => ({ ok, json: async () => body });

    it('returns the configured flag from the status endpoint', async () => {
        expect(await fetchEbayConfigured(stub({ configured: true }))).toBe(
            true,
        );
        expect(await fetchEbayConfigured(stub({ configured: false }))).toBe(
            false,
        );
    });

    it('is null when the response is not ok, has no boolean, or the call throws', async () => {
        expect(
            await fetchEbayConfigured(stub({ configured: true }, false)),
        ).toBeNull();
        expect(await fetchEbayConfigured(stub({}))).toBeNull();
        expect(
            await fetchEbayConfigured(async () => {
                throw new Error('offline');
            }),
        ).toBeNull();
    });

    it('requests the status endpoint without caching and with an 8-second timeout', async () => {
        const fetchFn = vi.fn(stub({ configured: true }));

        await fetchEbayConfigured(fetchFn);

        const options = fetchFn.mock.calls[0][1];
        expect(options.cache).toBe('no-store');
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(options.signal.aborted).toBe(false);
    });

    it('returns null when the configured-status request times out', async () => {
        const fetchFn = vi.fn(async (_url, options) => {
            options.signal.throwIfAborted();
            throw new DOMException('The operation was aborted', 'TimeoutError');
        });

        await expect(fetchEbayConfigured(fetchFn)).resolves.toBeNull();
    });
});
