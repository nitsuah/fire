import { describe, it, expect, vi } from 'vitest';
import {
    ebayStatusBadge,
    fetchEbayConfigured,
    EBAY_LAST_OUTCOME_KEY,
    ebayBuildOutcome,
    ebayReadOutcome,
    ebayWriteOutcome,
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


describe('eBay last-sync outcome storage', () => {
    function fakeStorage() {
        const values = new Map();
        return {
            getItem: (key) => (values.has(key) ? values.get(key) : null),
            setItem: (key, value) => values.set(key, String(value)),
            removeItem: (key) => values.delete(key),
        };
    }

    it('builds exactly the normalized outcome fields and accepts safe codes case-insensitively', () => {
        expect(
            ebayBuildOutcome({
                at: '2026-10-31T12:00:00.000Z',
                ok: true,
                errorCode: 'HTTP_503',
                message: 'must not be retained',
            }),
        ).toEqual({
            at: '2026-10-31T12:00:00.000Z',
            ok: true,
            errorCode: 'http_503',
        });
        expect(
            ebayBuildOutcome({
                at: 123,
                ok: 1,
                errorCode: 'provider error: private',
            }),
        ).toEqual({ at: null, ok: false, errorCode: null });
        expect(
            ebayBuildOutcome({ at: null, ok: false, errorCode: 'x'.repeat(65) })
                .errorCode,
        ).toBeNull();
    });

    it('reads only normalized fields and strips extra properties', () => {
        const storage = fakeStorage();
        storage.setItem(
            EBAY_LAST_OUTCOME_KEY,
            JSON.stringify({
                at: '2026-10-31T12:00:00.000Z',
                ok: false,
                errorCode: 'HTTP_503',
                message: 'private provider text',
                token: 'secret',
            }),
        );
        expect(ebayReadOutcome(storage)).toEqual({
            at: '2026-10-31T12:00:00.000Z',
            ok: false,
            errorCode: 'http_503',
        });
    });

    it('returns null for missing, malformed, primitive, array, or invalid-shape data', () => {
        const storage = fakeStorage();
        expect(ebayReadOutcome(storage)).toBeNull();
        for (const raw of [
            '{',
            'null',
            '42',
            '"text"',
            '[]',
            JSON.stringify({ at: 123, ok: true }),
            JSON.stringify({ at: '2026-10-31T12:00:00.000Z', ok: 'true' }),
        ]) {
            storage.setItem(EBAY_LAST_OUTCOME_KEY, raw);
            expect(ebayReadOutcome(storage)).toBeNull();
        }
    });

    it('records a failure, replaces it on recovery, and clears the key', () => {
        const storage = fakeStorage();
        ebayWriteOutcome(storage, {
            at: '2026-10-31T12:00:00.000Z',
            ok: false,
            errorCode: 'HTTP_503',
            message: 'not persisted',
        });
        expect(ebayReadOutcome(storage)).toEqual({
            at: '2026-10-31T12:00:00.000Z',
            ok: false,
            errorCode: 'http_503',
        });
        ebayWriteOutcome(storage, {
            at: '2026-10-31T12:05:00.000Z',
            ok: true,
            errorCode: null,
        });
        expect(ebayReadOutcome(storage)).toEqual({
            at: '2026-10-31T12:05:00.000Z',
            ok: true,
            errorCode: null,
        });
        expect(ebayWriteOutcome(storage, null)).toBeNull();
        expect(storage.getItem(EBAY_LAST_OUTCOME_KEY)).toBeNull();
    });

    it('fails open when storage methods throw', () => {
        const brokenStorage = {
            getItem() {
                throw new Error('storage unavailable');
            },
            setItem() {
                throw new Error('storage unavailable');
            },
            removeItem() {
                throw new Error('storage unavailable');
            },
        };
        expect(ebayReadOutcome(brokenStorage)).toBeNull();
        expect(
            ebayWriteOutcome(brokenStorage, {
                at: '2026-10-31T12:00:00.000Z',
                ok: false,
                errorCode: 'network_error',
            }),
        ).toBeNull();
        expect(() => ebayWriteOutcome(brokenStorage, null)).not.toThrow();
    });
});
