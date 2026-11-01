import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';
import merge from '../../app/lib/cointracker-merge.js';

const {
    mergeCoinTrackerWallets,
    confirmCoinTrackerWallet,
    removeCoinTrackerWallets,
    coinTrackerAddresses,
} = merge;

const ADDR = '0xAbC0000000000000000000000000000000000001';
const ledger = {
    providerId: 'w1',
    name: 'Ledger ETH',
    chains: ['ethereum'],
    addresses: [ADDR],
    usdValue: 4600,
    holdings: [{ symbol: 'ETH', quantity: 1.5, usdValue: 4500 }],
};
const coinbase = {
    providerId: 'w2',
    name: 'Coinbase',
    addresses: [],
    usdValue: 250,
    holdings: [],
};
const manualLedger = {
    id: 'm1',
    type: 'Crypto',
    name: 'My cold wallet',
    value: 4000,
    apy: 3,
    identifier: ADDR.toLowerCase(),
    quantity: 1.4,
};
const savings = {
    id: 's1',
    type: 'Savings',
    name: 'HYSA',
    value: 10000,
    apy: 4,
};

const total = (accounts) => accounts.reduce((s, a) => s + a.value, 0);

describe('mergeCoinTrackerWallets', () => {
    it('adds one Crypto row per wallet and leaves other accounts alone', () => {
        const r = mergeCoinTrackerWallets([savings], [ledger, coinbase], {
            syncedAt: 'T1',
            confirm: true,
        });
        expect(r.added).toBe(2);
        expect(r.accounts[0]).toBe(savings);
        expect(r.accounts[1]).toMatchObject({
            id: 'cointracker-w1',
            type: 'Crypto',
            value: 4600,
            source: 'cointracker',
            cointracker: {
                providerId: 'w1',
                chains: ['ethereum'],
                syncedAt: 'T1',
            },
        });
    });

    it('adopts a manual row with the same address instead of double counting', () => {
        const r = mergeCoinTrackerWallets([savings, manualLedger], [ledger], {
            confirm: true,
        });
        expect(r.adopted).toBe(1);
        expect(r.accounts).toHaveLength(2);
        const row = r.accounts[1];
        expect(row).toMatchObject({
            id: 'm1',
            name: 'My cold wallet',
            apy: 3,
            value: 4600,
        });
        expect(row.identifier).toBeUndefined(); // hides the on-chain refresh button
        expect(row.manualSnapshot).toEqual({
            value: 4000,
            identifier: manualLedger.identifier,
            quantity: 1.4,
        });
        expect(total(r.accounts)).toBe(14600);
    });

    it("updates existing rows in place on the next sync, keeping an adopted row's name", () => {
        const first = mergeCoinTrackerWallets(
            [manualLedger],
            [ledger, coinbase],
            { confirm: true },
        ).accounts;
        const second = mergeCoinTrackerWallets(
            first,
            [
                { ...ledger, name: 'Renamed', usdValue: 5000 },
                { ...coinbase, name: 'CB', usdValue: 300 },
            ],
            {},
        );
        expect(second.updated).toBe(2);
        expect(second.accounts).toHaveLength(2);
        expect(second.accounts[0]).toMatchObject({
            id: 'm1',
            name: 'My cold wallet',
            value: 5000,
        });
        expect(second.accounts[1]).toMatchObject({
            id: 'cointracker-w2',
            name: 'CB',
            value: 300,
        });
    });

    it('does not add or adopt wallets when confirm is omitted or false', () => {
        const existing = mergeCoinTrackerWallets([], [ledger], {
            confirm: true,
        }).accounts;
        const accounts = [...existing, manualLedger];
        const unconfirmed = {
            providerId: 'w3',
            name: 'Unconfirmed wallet',
            addresses: [manualLedger.identifier],
            usdValue: 700,
            holdings: [],
        };
        const incoming = [
            { ...ledger, usdValue: 5000 },
            { ...coinbase, usdValue: 300 },
            unconfirmed,
        ];

        const omitted = mergeCoinTrackerWallets(accounts, incoming, {});
        const explicitFalse = mergeCoinTrackerWallets(accounts, incoming, {
            confirm: false,
        });

        for (const result of [omitted, explicitFalse]) {
            expect(result.added).toBe(0);
            expect(result.adopted).toBe(0);
            expect(result.updated).toBe(1);
            expect(result.accounts).toHaveLength(2);
            expect(result.accounts[0]).toMatchObject({
                id: 'cointracker-w1',
                value: 5000,
            });
            expect(result.accounts[1]).toBe(manualLedger);
        }
    });

    it('drops a vanished wallet only after a complete sync, restoring its manual row', () => {
        const first = mergeCoinTrackerWallets(
            [manualLedger],
            [ledger, coinbase],
            { confirm: true },
        ).accounts;
        const partial = mergeCoinTrackerWallets(first, [coinbase], {
            partial: true,
        });
        expect(partial.removed).toBe(0);
        expect(partial.accounts).toHaveLength(2);

        const empty = mergeCoinTrackerWallets(first, [], {});
        expect(empty.accounts).toEqual(first);

        const complete = mergeCoinTrackerWallets(first, [coinbase], {});
        expect(complete.removed).toBe(1);
        expect(complete.accounts.find((a) => a.id === 'm1')).toEqual(
            manualLedger,
        );
    });

    it('honors excluded wallets even on a partial sync', () => {
        const first = mergeCoinTrackerWallets([], [ledger, coinbase], {
            confirm: true,
        }).accounts;
        const r = mergeCoinTrackerWallets(first, [ledger, coinbase], {
            partial: true,
            excluded: ['w2'],
        });
        expect(r.accounts.map((a) => a.id)).toEqual(['cointracker-w1']);
    });

    it('restores an excluded wallet from cached data without changing unrelated manual rows', () => {
        const unrelatedManual = {
            ...manualLedger,
            id: 'm2',
            name: 'Unrelated cold wallet',
            identifier: '0x0000000000000000000000000000000000000002',
        };
        const first = mergeCoinTrackerWallets(
            [unrelatedManual],
            [ledger, coinbase],
            { confirm: true, syncedAt: 'T1' },
        ).accounts;
        const hidden = mergeCoinTrackerWallets(first, [ledger, coinbase], {
            partial: true,
            excluded: ['w1'],
            syncedAt: 'T2',
        });

        expect(hidden.accounts.some((account) => account.id === 'cointracker-w1')).toBe(
            false,
        );
        expect(hidden.accounts.find((account) => account.id === 'm2')).toBe(
            unrelatedManual,
        );

        const restored = confirmCoinTrackerWallet(hidden.accounts, ledger, {
            syncedAt: 'T3',
            excluded: [],
        });

        expect(restored.filter((account) => account.id === 'cointracker-w1')).toHaveLength(
            1,
        );
        expect(restored).toHaveLength(3);
        expect(restored.find((account) => account.id === 'm2')).toBe(unrelatedManual);
        expect(hidden.accounts.some((account) => account.id === 'cointracker-w1')).toBe(
            false,
        );
    });

    it('flags ticker-only and address-less manual crypto rows as possible duplicates', () => {
        const tickerRow = {
            id: 't1',
            type: 'Crypto',
            name: 'ETH on exchange',
            value: 100,
            identifier: 'eth',
        };
        const bare = { id: 'b1', type: 'Crypto', name: 'Misc', value: 5 };
        const other = {
            id: 'o1',
            type: 'Crypto',
            name: 'DOGE',
            value: 1,
            identifier: 'DOGE',
        };
        const r = mergeCoinTrackerWallets(
            [tickerRow, bare, other],
            [ledger],
            {},
        );
        expect(r.possibleDuplicates.map((d) => d.id)).toEqual(['t1', 'b1']);
        expect(r.accounts.find((a) => a.id === 't1')).toBe(tickerRow);
    });
});

describe('skipped wallets', () => {
    it('keeps a wallet CoinTracker still lists but could not value, and drops removed ones', () => {
        const first = mergeCoinTrackerWallets([], [ledger, coinbase], {
            confirm: true,
        }).accounts;
        const r = mergeCoinTrackerWallets(first, [], { keep: ['w1'] });
        // An empty result is partial anyway; use a non-empty complete sync.
        const other = { ...coinbase, providerId: 'w9', name: 'New' };
        const r2 = mergeCoinTrackerWallets(first, [other], {
            keep: ['w1'],
            confirm: true,
        });
        expect(r.accounts).toHaveLength(2);
        expect(r2.accounts.map((a) => a.id)).toEqual([
            'cointracker-w1',
            'cointracker-w9',
        ]);
    });
});

describe('removeCoinTrackerWallets', () => {
    it('drops CoinTracker-only rows and restores adopted ones', () => {
        const merged = mergeCoinTrackerWallets(
            [savings, manualLedger],
            [ledger, coinbase],
            { confirm: true },
        ).accounts;
        expect(removeCoinTrackerWallets(merged)).toEqual([
            savings,
            manualLedger,
        ]);
    });
});

describe('coinTrackerAddresses', () => {
    it('collects lower-cased addresses from CoinTracker rows only', () => {
        const merged = mergeCoinTrackerWallets([savings], [ledger], {
            confirm: true,
        }).accounts;
        expect([...coinTrackerAddresses(merged)]).toEqual([ADDR.toLowerCase()]);
    });
});

describe('MCP net worth with CoinTracker', () => {
    let handleTool;
    beforeAll(async () => {
        process.env.FIRE_DB_FILE = path.join(
            os.tmpdir(),
            `fire-ct-mcp-test-${process.pid}.json`,
        );
        ({ handleTool } = await import('../../app/mcp-server.mjs'));
    }, 60000);

    it('does not count a tracked wallet CoinTracker already reports', () => {
        const customAccounts = mergeCoinTrackerWallets([], [ledger], {
            confirm: true,
        }).accounts;
        const r = handleTool('get_net_worth', {
            customAccounts,
            wallets: [
                {
                    id: 'a',
                    chain: 'ethereum',
                    label: 'dup',
                    address: ADDR,
                    lastUsdValue: 4600,
                },
                {
                    id: 'b',
                    chain: 'bitcoin',
                    label: 'btc',
                    address: 'bc1qother',
                    lastUsdValue: 1000,
                },
            ],
        });
        expect(r.breakdown.cryptoWallets).toBe(1000);
        expect(r.total).toBe(5600);
        const w = handleTool('get_wallets', {
            customAccounts,
            wallets: [{ id: 'a', address: ADDR, lastUsdValue: 1 }],
        });
        expect(w.wallets[0].coveredByCoinTracker).toBe(true);
    });
});

describe('suggestCoinTrackerWallets', () => {
    const { suggestCoinTrackerWallets } = merge;

    it('suggests unconfirmed wallets with their source and sync time', () => {
        const s = suggestCoinTrackerWallets([], [ledger, coinbase], {
            syncedAt: '2026-10-28T00:00:00.000Z',
        });
        expect(s.map((w) => w.providerId)).toEqual(['w1', 'w2']);
        expect(s[0].source).toBe('cointracker');
        expect(s[0].syncedAt).toBe('2026-10-28T00:00:00.000Z');
    });

    it('skips confirmed, dismissed and already-tracked wallets', () => {
        const confirmed = mergeCoinTrackerWallets([], [coinbase], {
            confirm: true,
        }).accounts;
        expect(
            suggestCoinTrackerWallets(confirmed, [coinbase]).map(
                (w) => w.providerId,
            ),
        ).toEqual([]);
        expect(
            suggestCoinTrackerWallets([], [ledger, coinbase], {
                dismissed: ['w2'],
            }).map((w) => w.providerId),
        ).toEqual(['w1']);
        const manual = [{ ...manualLedger, identifier: ADDR.toUpperCase() }];
        expect(suggestCoinTrackerWallets(manual, [ledger])).toEqual([]);
    });

    it('never changes the accounts it is given', () => {
        const accounts = [manualLedger];
        const before = JSON.stringify(accounts);
        suggestCoinTrackerWallets(accounts, [ledger, coinbase]);
        expect(JSON.stringify(accounts)).toBe(before);
    });
});

describe('confirmCoinTrackerWallet', () => {
    it('adds only the selected wallet on confirmation', () => {
        const accounts = [savings];
        const result = confirmCoinTrackerWallet(accounts, ledger, {
            syncedAt: 'T1',
        });

        expect(result).toHaveLength(2);
        expect(result[0]).toBe(savings);
        expect(result[1]).toMatchObject({
            id: 'cointracker-w1',
            type: 'Crypto',
            name: 'Ledger ETH',
            value: 4600,
            source: 'cointracker',
            cointracker: { providerId: 'w1', syncedAt: 'T1' },
        });
    });

    it('adopts a matching manual row and preserves its manual snapshot', () => {
        const result = confirmCoinTrackerWallet(
            [savings, manualLedger],
            ledger,
        );

        expect(result).toHaveLength(2);
        expect(result[0]).toBe(savings);
        expect(result[1]).toMatchObject({
            id: 'm1',
            name: 'My cold wallet',
            value: 4600,
            manualSnapshot: {
                value: 4000,
                identifier: manualLedger.identifier,
                quantity: 1.4,
            },
        });
    });

    it('leaves unrelated account rows untouched by reference', () => {
        const unrelatedCrypto = {
            id: 'u1',
            type: 'Crypto',
            name: 'Unrelated wallet',
            value: 12,
            identifier: '0x000000000000000000000000000000000000dead',
        };
        const accounts = [savings, unrelatedCrypto];
        const result = confirmCoinTrackerWallet(accounts, ledger);

        expect(result[0]).toBe(savings);
        expect(result[1]).toBe(unrelatedCrypto);
        expect(result).toHaveLength(3);
    });
});
