import { describe, it, expect, vi } from 'vitest';
import {
    ebayBuildOutcome,
    ebayReadOutcome,
    ebayWriteOutcome,
    ebayStatusBadge,
    fetchEbayConfigured,
} from '../../app/lib/ebay-status.js';
import fs from 'node:fs';
import vm from 'node:vm';

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

const OUTCOME_KEY = 'fire_tracker_ebay_last_sync_outcome';
const TOKEN_KEY = 'fire_tracker_ebay_token';
const SYNC_KEY = 'fire_tracker_ebay_last_sync';
const FIXED_NOW = '2026-10-30T12:00:00.000Z';

const makeStorage = (values = new Map()) => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
});
const source = (name) =>
    fs.readFileSync(new URL('../../app/lib/' + name, import.meta.url), 'utf8');

function hostedHarness() {
    const values = new Map([
        [TOKEN_KEY, 'sealed-credential'],
        [SYNC_KEY, 'previous-sync'],
        [
            OUTCOME_KEY,
            JSON.stringify({ at: FIXED_NOW, ok: true, errorCode: null }),
        ],
    ]);
    const context = vm.createContext({
        localStorage: makeStorage(values),
        sessionStorage: makeStorage(),
        Date: class extends Date {
            constructor(...args) {
                super(...(args.length ? args : [FIXED_NOW]));
            }
        },
        state: { sideGigLedger: [] },
        fetch: vi.fn(),
        saveState: vi.fn().mockResolvedValue(undefined),
        document: { getElementById: () => null },
        window: { location: { hash: '', pathname: '/', search: '' } },
        history: { replaceState: vi.fn() },
        alert: vi.fn(),
        console,
    });
    vm.runInContext(source('ebay-status.js'), context);
    vm.runInContext(source('side-gig.js'), context);
    context.showSideGigToast = vi.fn();
    return {
        context,
        values,
        outcome: () => JSON.parse(values.get(OUTCOME_KEY) ?? 'null'),
    };
}

const syncResponse = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
});

describe('eBay outcome persistence', () => {
    it('normalizes fields and accepts only safe error codes', () => {
        expect(
            ebayBuildOutcome({ at: 7, ok: 1, errorCode: 'HTTP_503' }),
        ).toEqual({ at: null, ok: false, errorCode: 'http_503' });
        expect(
            ebayBuildOutcome({
                at: FIXED_NOW,
                ok: true,
                errorCode: 'private',
            }),
        ).toEqual({ at: FIXED_NOW, ok: true, errorCode: null });
    });

    it('strips extra fields and rejects malformed or non-object storage', () => {
        const storage = makeStorage();
        storage.setItem(
            OUTCOME_KEY,
            JSON.stringify({
                at: FIXED_NOW,
                ok: false,
                errorCode: 'TIMEOUT',
                message: 'private',
            }),
        );
        expect(ebayReadOutcome(storage)).toEqual({
            at: FIXED_NOW,
            ok: false,
            errorCode: 'timeout',
        });
        for (const raw of [
            '{',
            'null',
            '[]',
            '2',
            '"text"',
            '{}',
            '{"foo":1}',
        ]) {
            storage.setItem(OUTCOME_KEY, raw);
            expect(ebayReadOutcome(storage)).toBeNull();
        }
    });

    it('writes normalized data, clears null, and fails open on storage exceptions', () => {
        const storage = makeStorage();
        ebayWriteOutcome(storage, {
            at: FIXED_NOW,
            ok: false,
            errorCode: 'TIMEOUT',
            token: 'sealed',
        });
        expect(JSON.parse(storage.getItem(OUTCOME_KEY))).toEqual({
            at: FIXED_NOW,
            ok: false,
            errorCode: 'timeout',
        });
        ebayWriteOutcome(storage, null);
        expect(storage.getItem(OUTCOME_KEY)).toBeNull();
        const broken = {
            getItem: () => {
                throw new Error('denied');
            },
            setItem: () => {
                throw new Error('denied');
            },
            removeItem: () => {
                throw new Error('denied');
            },
        };
        expect(ebayReadOutcome(broken)).toBeNull();
        expect(() => ebayWriteOutcome(broken, { ok: false })).not.toThrow();
        expect(() => ebayWriteOutcome(broken, null)).not.toThrow();
    });
});

describe('hosted eBay call-site transitions', () => {
    it.each([
        [
            'network',
            (ctx) => ctx.fetch.mockRejectedValue(new Error('private')),
            'network_error',
        ],
        [
            'HTTP 503',
            (ctx) =>
                ctx.fetch.mockResolvedValue(
                    syncResponse({ code: 'TIMEOUT', error: 'private' }, 503),
                ),
            'timeout',
        ],
        [
            'HTTP fallback',
            (ctx) =>
                ctx.fetch.mockResolvedValue(
                    syncResponse({ error: 'private' }, 503),
                ),
            'http_503',
        ],
    ])(
        'records a sanitized %s failure before rejecting',
        async (_name, setup, code) => {
            const { context, values, outcome } = hostedHarness();
            setup(context);
            await expect(context.syncEbayViaFunction()).rejects.toThrow();
            expect(outcome()).toEqual({
                at: FIXED_NOW,
                ok: false,
                errorCode: code,
            });
            expect(values.get(OUTCOME_KEY)).not.toContain('private');
            expect(values.get(OUTCOME_KEY)).not.toContain('sealed-credential');
        },
    );

    it('replaces failure with success after saveState and exposes local status', async () => {
        const { context, values, outcome } = hostedHarness();
        context.fetch.mockResolvedValue(
            syncResponse({
                entries: [{ id: 'sale' }],
                syncedAt: FIXED_NOW,
            }),
        );
        await expect(context.syncEbayViaFunction()).resolves.toMatchObject({
            added: 1,
        });
        expect(context.saveState).toHaveBeenCalledOnce();
        expect(values.get(SYNC_KEY)).toBe(FIXED_NOW);
        expect(outcome()).toEqual({
            at: FIXED_NOW,
            ok: true,
            errorCode: null,
        });
        expect(context.localEbayStatus().lastSyncOutcome).toEqual(outcome());
    });

    it('records saveState failure without advancing last-sync time', async () => {
        const { context, values, outcome } = hostedHarness();
        const error = new Error('private storage failure');
        context.saveState.mockRejectedValue(error);
        context.fetch.mockResolvedValue(
            syncResponse({ entries: [], syncedAt: FIXED_NOW }),
        );
        await expect(context.syncEbayViaFunction()).rejects.toBe(error);
        expect(values.get(SYNC_KEY)).toBe('previous-sync');
        expect(outcome()).toEqual({
            at: FIXED_NOW,
            ok: false,
            errorCode: 'storage_error',
        });
    });

    it.each(['invalid JSON', 'missing fields'])(
        'rejects invalid 2xx: %s',
        async (kind) => {
            const { context, values, outcome } = hostedHarness();
            const res = syncResponse({});
            if (kind === 'invalid JSON') {
                res.json = async () => {
                    throw new SyntaxError('private');
                };
            }
            context.fetch.mockResolvedValue(res);
            await expect(context.syncEbayViaFunction()).rejects.toThrow(
                'Invalid sync response',
            );
            expect(context.saveState).not.toHaveBeenCalled();
            expect(values.get(SYNC_KEY)).toBe('previous-sync');
            expect(outcome()).toEqual({
                at: FIXED_NOW,
                ok: false,
                errorCode: 'invalid_response',
            });
        },
    );

    it('clears stale outcome on OAuth reconnect', async () => {
        const { context, values } = hostedHarness();
        context.sessionStorage.setItem(
            'fire_tracker_ebay_connect_pending',
            '1',
        );
        context.window.location.hash = '#ebay-connected=new-sealed-token';
        context.checkEbayConnection = vi.fn().mockResolvedValue(undefined);
        context.runEbaySyncNow = vi.fn().mockResolvedValue({ added: 0 });
        await context.consumeEbayOauthFragment();
        expect(values.get(TOKEN_KEY)).toBe('new-sealed-token');
        expect(values.has(OUTCOME_KEY)).toBe(false);
        expect(context.history.replaceState).toHaveBeenCalledWith(
            null,
            '',
            '/',
        );
    });

    it('clears token, timestamp, outcome, and only API rows on lost grant', async () => {
        const { context, values } = hostedHarness();
        context.state.sideGigLedger = [
            { id: 'ebay-1', orderId: '1' },
            { id: 'manual' },
        ];
        context.checkEbayConnection = vi.fn();
        await context.handleEbayConnectionLost('ebay_revoked', 'Reconnect');
        expect(values.has(TOKEN_KEY)).toBe(false);
        expect(values.has(SYNC_KEY)).toBe(false);
        expect(values.has(OUTCOME_KEY)).toBe(false);
        expect(context.state.sideGigLedger).toEqual([{ id: 'manual' }]);
        expect(context.saveState).toHaveBeenCalledOnce();
    });
    it('preserves the prior outcome when token changes during a failed fetch', async () => {
        const { context, values, outcome } = hostedHarness();
        context.fetch.mockImplementation(async () => {
            values.set(TOKEN_KEY, 'replacement-token');
            return syncResponse({ code: 'TIMEOUT', error: 'private' }, 503);
        });
        await expect(context.syncEbayViaFunction()).rejects.toThrow();
        expect(values.get(SYNC_KEY)).toBe('previous-sync');
        expect(outcome()).toEqual({
            at: FIXED_NOW,
            ok: true,
            errorCode: null,
        });
    });

    it('discards a success response when token changes during fetch', async () => {
        const { context, values, outcome } = hostedHarness();
        const previous = {
            at: 'previous-outcome',
            ok: false,
            errorCode: 'timeout',
        };
        values.set(OUTCOME_KEY, JSON.stringify(previous));
        context.fetch.mockImplementation(async () => {
            values.set(TOKEN_KEY, 'replacement-token');
            return syncResponse({
                entries: [{ id: 'stale-sale' }],
                syncedAt: FIXED_NOW,
            });
        });
        await expect(context.syncEbayViaFunction()).rejects.toThrow(
            'eBay connection changed during sync; retry',
        );
        expect(context.state.sideGigLedger).toEqual([]);
        expect(context.saveState).not.toHaveBeenCalled();
        expect(values.get(SYNC_KEY)).toBe('previous-sync');
        expect(outcome()).toEqual(previous);
    });

    it('preserves the prior outcome and timestamp when token changes during saveState', async () => {
        const { context, values, outcome } = hostedHarness();
        const previous = {
            at: 'previous-outcome',
            ok: false,
            errorCode: 'timeout',
        };
        values.set(OUTCOME_KEY, JSON.stringify(previous));
        context.fetch.mockResolvedValue(
            syncResponse({ entries: [], syncedAt: FIXED_NOW }),
        );
        context.saveState.mockImplementation(async () => {
            values.set(TOKEN_KEY, 'replacement-token');
        });
        await expect(context.syncEbayViaFunction()).rejects.toThrow(
            'eBay connection changed during sync; retry',
        );
        expect(values.get(SYNC_KEY)).toBe('previous-sync');
        expect(outcome()).toEqual(previous);
    });
});
