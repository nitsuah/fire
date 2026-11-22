import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('mcp-tools.mjs browser safety', () => {
    it('has no Node built-in imports', () => {
        const source = readFileSync(resolve('./app/mcp-tools.mjs'), 'utf8');
        const importLines =
            source.match(/^import .+ from ['"]([^'"]+)['"];/gm) || [];
        const nodeBuiltins = [
            'node:',
            'fs',
            'path',
            'crypto',
            'os',
            'child_process',
            'http',
            'https',
            'net',
            'tls',
            'stream',
            'util',
            'events',
            'buffer',
            'querystring',
            'url',
            'zlib',
            'assert',
            'vm',
            'module',
            'perf_hooks',
            'worker_threads',
            'dns',
            'readline',
            'repl',
            'tty',
            'dgram',
            'cluster',
        ];

        for (const line of importLines) {
            const match = line.match(/from ['"]([^'"]+)['"]/);
            if (match) {
                const specifier = match[1];
                for (const builtin of nodeBuiltins) {
                    if (
                        specifier === builtin ||
                        specifier.startsWith(builtin + '/') ||
                        specifier.startsWith('node:')
                    ) {
                        throw new Error(
                            `mcp-tools.mjs imports Node built-in: ${specifier}`,
                        );
                    }
                }
            }
        }
    });

    it('does not read process.env', () => {
        const source = readFileSync(resolve('./app/mcp-tools.mjs'), 'utf8');
        if (source.includes('process.env')) {
            throw new Error('mcp-tools.mjs reads process.env');
        }
    });
});

describe('get_transactions legacy output keys', () => {
    it('returns exactly legacy keys when called without offset/pagingKey', async () => {
        const { handleTool } = await import('../../app/mcp-tools.mjs');
        const sampleState = {
            spendingTransactions: [
                {
                    id: 'a',
                    date: '2026-09-02',
                    merchant: 'Whole Foods',
                    amount: 40,
                    category: 'food',
                },
                {
                    id: 'b',
                    date: '2026-09-20',
                    merchant: 'Shell',
                    amount: 60.5,
                    category: 'transport',
                },
            ],
            customAccounts: [],
            importedPositions: [],
            cds: [],
            realEstate: [],
            vehicles: [],
            wallets: [],
            expenses: { housing: 1000, food: 500, transport: 300 },
            insurances: {},
            taxRate: 20,
            projectionSettings: {
                currentAge: 35,
                retireAge: 65,
                annualSavings: 20000,
                expectedReturn: 7,
                inflationRate: 3,
                swr: 4,
                spanYears: 30,
            },
            sideGigLedger: [],
            netWorthHistory: [],
            importedFiles: [],
        };
        const result = handleTool('get_transactions', sampleState);
        const expectedKeys = [
            'byCategory',
            'count',
            'limit',
            'matched',
            'total',
            'transactions',
        ].sort();
        const actualKeys = Object.keys(result).sort();
        expect(actualKeys).toEqual(expectedKeys);
    });
});

describe('get_transactions paging without an injected hasher', () => {
    it('pages with the built-in fingerprint and rejects a stale pagingKey', async () => {
        const { handleTool } = await import('../../app/mcp-tools.mjs');
        const sampleState = {
            spendingTransactions: [
                {
                    id: 'a',
                    date: '2026-09-02',
                    merchant: 'Whole Foods',
                    amount: 40,
                    category: 'food',
                },
                {
                    id: 'b',
                    date: '2026-09-20',
                    merchant: 'Shell',
                    amount: 60.5,
                    category: 'transport',
                },
            ],
            customAccounts: [],
            importedPositions: [],
            cds: [],
            realEstate: [],
            vehicles: [],
            wallets: [],
            expenses: { housing: 1000, food: 500, transport: 300 },
            insurances: {},
            taxRate: 20,
            projectionSettings: {
                currentAge: 35,
                retireAge: 65,
                annualSavings: 20000,
                expectedReturn: 7,
                inflationRate: 3,
                swr: 4,
                spanYears: 30,
            },
            sideGigLedger: [],
            netWorthHistory: [],
            importedFiles: [],
        };
        const page1 = handleTool('get_transactions', sampleState, {
            offset: 0,
            limit: 1,
        });
        expect(page1.pagingKey).toMatch(/^[0-9a-f]{16}$/);
        const page2 = handleTool('get_transactions', sampleState, {
            offset: 1,
            pagingKey: page1.pagingKey,
            limit: 1,
        });
        expect(page2.transactions.map((t) => t.id)).toEqual(['a']);
        expect(() =>
            handleTool('get_transactions', sampleState, {
                offset: 1,
                pagingKey: 'abc',
                limit: 1,
            }),
        ).toThrow(/stale_offset/);
    });

    it('rejects an async hasher instead of storing a Promise as the key', async () => {
        const { handleTool } = await import('../../app/mcp-tools.mjs');
        const state = {
            spendingTransactions: [{ id: 'a', date: '2026-09-02', amount: 1 }],
        };
        expect(() =>
            handleTool(
                'get_transactions',
                state,
                { offset: 0 },
                {
                    hasher: async () => 'x',
                },
            ),
        ).toThrow(/synchronously/);
    });

    it('fingerprints deterministically and distinguishes lists', async () => {
        const { pagingFingerprint } = await import('../../app/mcp-tools.mjs');
        expect(pagingFingerprint('a,b')).toBe(pagingFingerprint('a,b'));
        expect(pagingFingerprint('a,b')).not.toBe(pagingFingerprint('b,a'));
        expect(pagingFingerprint('')).toBe('cbf29ce484222325');
    });
});

describe('get_side_gig_income limit and truncation', () => {
    it('limits entries to default 200 and adds truncated flag', async () => {
        const { handleTool } = await import('../../app/mcp-tools.mjs');
        const sampleState = {
            spendingTransactions: [],
            customAccounts: [],
            importedPositions: [],
            cds: [],
            realEstate: [],
            vehicles: [],
            wallets: [],
            expenses: { housing: 1000, food: 500, transport: 300 },
            insurances: {},
            taxRate: 20,
            projectionSettings: {
                currentAge: 35,
                retireAge: 65,
                annualSavings: 20000,
                expectedReturn: 7,
                inflationRate: 3,
                swr: 4,
                spanYears: 30,
            },
            sideGigLedger: Array.from({ length: 250 }, (_, i) => ({
                id: String(i),
                date: '2026-01-15',
                category: 'Etsy',
                revenue: 10,
                net: 5,
            })),
            netWorthHistory: [],
            importedFiles: [],
        };
        const result = handleTool('get_side_gig_income', sampleState);
        expect(result.truncated).toBe(true);
        expect(result.entries.length).toBe(200);
    });

    it('respects custom limit up to max 1000', async () => {
        const { handleTool } = await import('../../app/mcp-tools.mjs');
        const sampleState = {
            spendingTransactions: [],
            customAccounts: [],
            importedPositions: [],
            cds: [],
            realEstate: [],
            vehicles: [],
            wallets: [],
            expenses: { housing: 1000, food: 500, transport: 300 },
            insurances: {},
            taxRate: 20,
            projectionSettings: {
                currentAge: 35,
                retireAge: 65,
                annualSavings: 20000,
                expectedReturn: 7,
                inflationRate: 3,
                swr: 4,
                spanYears: 30,
            },
            sideGigLedger: Array.from({ length: 50 }, (_, i) => ({
                id: String(i),
                date: '2026-01-15',
                category: 'Etsy',
                revenue: 10,
                net: 5,
            })),
            netWorthHistory: [],
            importedFiles: [],
        };
        const result = handleTool('get_side_gig_income', sampleState, {
            limit: 10,
        });
        expect(result.entries.length).toBe(10);
        expect(result.truncated).toBe(true); // 50 entries, limit 10
    });

    it('caps limit at 1000', async () => {
        const { handleTool } = await import('../../app/mcp-tools.mjs');
        const sampleState = {
            spendingTransactions: [],
            customAccounts: [],
            importedPositions: [],
            cds: [],
            realEstate: [],
            vehicles: [],
            wallets: [],
            expenses: { housing: 1000, food: 500, transport: 300 },
            insurances: {},
            taxRate: 20,
            projectionSettings: {
                currentAge: 35,
                retireAge: 65,
                annualSavings: 20000,
                expectedReturn: 7,
                inflationRate: 3,
                swr: 4,
                spanYears: 30,
            },
            sideGigLedger: Array.from({ length: 2000 }, (_, i) => ({
                id: String(i),
                date: '2026-01-15',
                category: 'Etsy',
                revenue: 10,
                net: 5,
            })),
            netWorthHistory: [],
            importedFiles: [],
        };
        const result = handleTool('get_side_gig_income', sampleState, {
            limit: 2000,
        });
        expect(result.entries.length).toBe(1000);
        expect(result.truncated).toBe(true);
    });
});
