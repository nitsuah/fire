import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(
    new URL('../../app/lib/state.js', import.meta.url),
    'utf8',
);

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const KEY = 'fire.deployMode';

// Loads state.js into a vm context with a fake clock, storage and fetch.
function load({ fetchImpl, entry, storageThrows = false } = {}) {
    const store = new Map();
    if (entry !== undefined) store.set(KEY, entry);
    const localStorage = {
        getItem: vi.fn((k) => {
            if (storageThrows && k === KEY) throw new Error('blocked');
            return store.has(k) ? store.get(k) : null;
        }),
        setItem: vi.fn((k, v) => {
            if (storageThrows && k === KEY) throw new Error('blocked');
            store.set(k, String(v));
        }),
        removeItem: vi.fn((k) => {
            if (storageThrows && k === KEY) throw new Error('blocked');
            store.delete(k);
        }),
    };
    const resolveMode = vi.fn();
    const fetch = vi.fn(
        fetchImpl || (async () => ({ status: 404, ok: false })),
    );
    const context = vm.createContext({
        state: { expenses: {} },
        localStorage,
        fetch,
        console: { log() {}, warn() {}, error() {} },
        Date: class FakeDate extends Date {
            static now() {
                return NOW;
            }
            constructor(...args) {
                super(...(args.length ? args : [NOW]));
            }
        },
        FireDeployMode: { resolve: resolveMode },
        window: {},
        // state.js wires backup buttons at load time.
        document: {
            getElementById: () => ({ addEventListener() {} }),
            addEventListener() {},
        },
    });
    vm.runInContext(src, context);
    return { context, store, fetch, resolveMode, localStorage };
}

const fresh = (ageMs) => JSON.stringify({ hosted: true, at: NOW - ageMs });

describe('loadStateFromServer deploy-mode cache', () => {
    it('a real 404 is remembered as hosted', async () => {
        const { context, store, resolveMode } = load();
        await context.loadStateFromServer();
        expect(resolveMode).toHaveBeenCalledWith(false);
        expect(JSON.parse(store.get(KEY))).toEqual({ hosted: true, at: NOW });
    });

    it('second hosted load makes no /api/state request and uses local state', async () => {
        const { context, fetch, resolveMode } = load({
            entry: fresh(DAY),
        });
        context.localStorage.setItem(
            'fire_tracker_state',
            JSON.stringify({ expenses: { rent: 5 }, cds: [{ rate: 1 }] }),
        );
        await context.loadStateFromServer();
        expect(fetch).not.toHaveBeenCalled();
        expect(resolveMode).toHaveBeenCalledWith(false);
        expect(context.state.expenses.rent).toBe(5);
        expect(context.state.cds).toHaveLength(1);
    });

    it('an entry older than 7 days is re-probed', async () => {
        const { context, fetch } = load({ entry: fresh(8 * DAY) });
        await context.loadStateFromServer();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith('/api/state');
    });

    it('a stale entry is refreshed after a new 404', async () => {
        const { context, store } = load({ entry: fresh(8 * DAY) });
        await context.loadStateFromServer();
        expect(JSON.parse(store.get(KEY)).at).toBe(NOW);
    });

    it('an entry from the future is not trusted', async () => {
        const { context, fetch } = load({
            entry: JSON.stringify({ hosted: true, at: NOW + DAY }),
        });
        await context.loadStateFromServer();
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('a malformed entry is ignored and re-probed', async () => {
        for (const entry of ['not json', '{"hosted":false,"at":1}', '{}']) {
            const { context, fetch } = load({ entry });
            await context.loadStateFromServer();
            expect(fetch).toHaveBeenCalledTimes(1);
        }
    });

    it('self-hosted is never cached and clears a stale hosted entry', async () => {
        const { context, store, resolveMode } = load({
            entry: fresh(8 * DAY),
            fetchImpl: async () => ({
                status: 200,
                ok: true,
                json: async () => ({ cds: [], stateRevision: 3 }),
            }),
        });
        await context.loadStateFromServer();
        expect(resolveMode).toHaveBeenCalledWith(true);
        expect(store.has(KEY)).toBe(false);
    });

    it('a non-404 error answer is treated as a server and not cached', async () => {
        const { context, store, resolveMode } = load({
            fetchImpl: async () => ({ status: 500, ok: false }),
        });
        await context.loadStateFromServer();
        expect(resolveMode).toHaveBeenCalledWith(true);
        expect(store.has(KEY)).toBe(false);
    });

    it('a network failure is not cached as hosted', async () => {
        const { context, store } = load({
            fetchImpl: async () => {
                throw new Error('offline');
            },
        });
        await context.loadStateFromServer();
        expect(store.has(KEY)).toBe(false);
    });

    it('the cache key throwing on read/write falls back to probing without crashing', async () => {
        const { context, fetch } = load({ storageThrows: true });
        await context.loadStateFromServer();
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
