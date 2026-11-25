import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('integrateWebhookData', () => {
    let webhook;

    beforeEach(async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const mod = await import('../../app/lib/webhook-integration.js');
        webhook = mod.integrateWebhookData;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function makeDb() {
        return {
            customAccounts: [],
            cds: [],
            importedPositions: [],
            expenses: {},
            taxRate: 0,
            projectionSettings: {},
        };
    }

    describe('accounts', () => {
        it('adds new account without id with generated 16-hex id', () => {
            const db = makeDb();
            const result = webhook(db, 'accounts', {
                name: 'Checking',
                balance: 100,
            });
            expect(result).toBe(true);
            expect(db.customAccounts).toHaveLength(1);
            expect(db.customAccounts[0].id).toMatch(/^[0-9a-f]{16}$/);
            expect(db.customAccounts[0].name).toBe('Checking');
            expect(db.customAccounts[0].balance).toBe(100);
        });

        it('adds new account with provided id', () => {
            const db = makeDb();
            const result = webhook(db, 'accounts', {
                id: 'my-id',
                name: 'Savings',
                balance: 200,
            });
            expect(result).toBe(true);
            expect(db.customAccounts[0].id).toBe('my-id');
        });

        it('merges existing account by id, keeping other fields', () => {
            const db = makeDb();
            db.customAccounts.push({
                id: 'acc-1',
                name: 'Original',
                balance: 50,
                type: 'checking',
            });
            const result = webhook(db, 'accounts', {
                id: 'acc-1',
                name: 'Updated',
                balance: 75,
            });
            expect(result).toBe(true);
            expect(db.customAccounts).toHaveLength(1);
            expect(db.customAccounts[0].name).toBe('Updated');
            expect(db.customAccounts[0].balance).toBe(75);
            expect(db.customAccounts[0].type).toBe('checking');
        });

        it('adds each entry when data is an array', () => {
            const db = makeDb();
            const result = webhook(db, 'accounts', [
                { name: 'A', balance: 1 },
                { name: 'B', balance: 2 },
            ]);
            expect(result).toBe(true);
            expect(db.customAccounts).toHaveLength(2);
            expect(db.customAccounts[0].name).toBe('A');
            expect(db.customAccounts[1].name).toBe('B');
        });

        it('returns false when db.customAccounts is missing', () => {
            const db = {
                cds: [],
                importedPositions: [],
                expenses: {},
                taxRate: 0,
                projectionSettings: {},
            };
            const result = webhook(db, 'accounts', { name: 'Test' });
            expect(result).toBe(false);
        });
    });

    describe('cds', () => {
        it('adds new CD without id with generated id', () => {
            const db = makeDb();
            const result = webhook(db, 'cds', { name: 'CD1', amount: 1000 });
            expect(result).toBe(true);
            expect(db.cds).toHaveLength(1);
            expect(db.cds[0].id).toMatch(/^[0-9a-f]{16}$/);
            expect(db.cds[0].name).toBe('CD1');
        });

        it('merges existing CD by id', () => {
            const db = makeDb();
            db.cds.push({ id: 'cd-1', name: 'Old', amount: 500, rate: 0.05 });
            const result = webhook(db, 'cds', {
                id: 'cd-1',
                name: 'New',
                amount: 600,
            });
            expect(result).toBe(true);
            expect(db.cds).toHaveLength(1);
            expect(db.cds[0].name).toBe('New');
            expect(db.cds[0].amount).toBe(600);
            expect(db.cds[0].rate).toBe(0.05);
        });

        it('adds each entry when data is an array', () => {
            const db = makeDb();
            webhook(db, 'cds', [{ name: 'X' }, { name: 'Y' }]);
            expect(db.cds).toHaveLength(2);
        });
    });

    describe('positions', () => {
        it('adds new position with generated id', () => {
            const db = makeDb();
            const result = webhook(db, 'positions', {
                symbol: 'AAPL',
                shares: 10,
            });
            expect(result).toBe(true);
            expect(db.importedPositions).toHaveLength(1);
            expect(db.importedPositions[0].id).toMatch(/^[0-9a-f]{16}$/);
            expect(db.importedPositions[0].symbol).toBe('AAPL');
            expect(db.importedPositions[0].shares).toBe(10);
        });

        it('merges existing position by symbol', () => {
            const db = makeDb();
            db.importedPositions.push({
                id: 'pos-1',
                symbol: 'TSLA',
                shares: 5,
                cost: 200,
            });
            const result = webhook(db, 'positions', {
                symbol: 'TSLA',
                shares: 8,
            });
            expect(result).toBe(true);
            expect(db.importedPositions).toHaveLength(1);
            expect(db.importedPositions[0].symbol).toBe('TSLA');
            expect(db.importedPositions[0].shares).toBe(8);
            expect(db.importedPositions[0].cost).toBe(200);
        });

        it('adds new symbol when not found', () => {
            const db = makeDb();
            db.importedPositions.push({
                id: 'pos-1',
                symbol: 'AAPL',
                shares: 10,
            });
            webhook(db, 'positions', { symbol: 'GOOGL', shares: 5 });
            expect(db.importedPositions).toHaveLength(2);
            expect(db.importedPositions[1].symbol).toBe('GOOGL');
        });

        it('adds each entry when data is an array', () => {
            const db = makeDb();
            webhook(db, 'positions', [{ symbol: 'A' }, { symbol: 'B' }]);
            expect(db.importedPositions).toHaveLength(2);
        });
    });

    describe('expenses', () => {
        it('spreads object over existing expenses, keeping existing keys', () => {
            const db = makeDb();
            db.expenses = { rent: 1000, food: 500 };
            const result = webhook(db, 'expenses', {
                food: 600,
                transport: 200,
            });
            expect(result).toBe(true);
            expect(db.expenses).toEqual({
                rent: 1000,
                food: 600,
                transport: 200,
            });
        });

        it('returns false for array and leaves expenses unchanged', () => {
            const db = makeDb();
            db.expenses = { rent: 1000 };
            const result = webhook(db, 'expenses', [{ foo: 1 }]);
            expect(result).toBe(false);
            expect(db.expenses).toEqual({ rent: 1000 });
        });

        it('returns false for null and leaves expenses unchanged', () => {
            const db = makeDb();
            db.expenses = { rent: 1000 };
            const result = webhook(db, 'expenses', null);
            expect(result).toBe(false);
            expect(db.expenses).toEqual({ rent: 1000 });
        });

        it('returns false for string and leaves expenses unchanged', () => {
            const db = makeDb();
            db.expenses = { rent: 1000 };
            const result = webhook(db, 'expenses', 'not an object');
            expect(result).toBe(false);
            expect(db.expenses).toEqual({ rent: 1000 });
        });
    });

    describe('taxRate', () => {
        it('sets taxRate and returns true for number', () => {
            const db = makeDb();
            const result = webhook(db, 'taxRate', 0.25);
            expect(result).toBe(true);
            expect(db.taxRate).toBe(0.25);
        });

        it('returns false for string and leaves taxRate unchanged', () => {
            const db = makeDb();
            db.taxRate = 0.2;
            const result = webhook(db, 'taxRate', 'high');
            expect(result).toBe(false);
            expect(db.taxRate).toBe(0.2);
        });
    });

    describe('projectionSettings', () => {
        it('merges object over existing settings', () => {
            const db = makeDb();
            db.projectionSettings = { growth: 0.07, inflation: 0.03 };
            const result = webhook(db, 'projectionSettings', {
                inflation: 0.04,
                tax: 0.15,
            });
            expect(result).toBe(true);
            expect(db.projectionSettings).toEqual({
                growth: 0.07,
                inflation: 0.04,
                tax: 0.15,
            });
        });

        it('returns false for null and leaves settings unchanged', () => {
            const db = makeDb();
            db.projectionSettings = { growth: 0.07 };
            const result = webhook(db, 'projectionSettings', null);
            expect(result).toBe(false);
            expect(db.projectionSettings).toEqual({ growth: 0.07 });
        });

        it('returns false for string and leaves settings unchanged', () => {
            const db = makeDb();
            db.projectionSettings = { growth: 0.07 };
            const result = webhook(db, 'projectionSettings', 'config');
            expect(result).toBe(false);
            expect(db.projectionSettings).toEqual({ growth: 0.07 });
        });
    });

    describe('unknown type', () => {
        it('returns false for unhandled type', () => {
            const db = makeDb();
            const result = webhook(db, 'nope', { whatever: 1 });
            expect(result).toBe(false);
        });
    });

    describe('missing customAccounts triggers try/catch', () => {
        it('returns false when db.customAccounts is missing for accounts type', () => {
            const db = {
                cds: [],
                importedPositions: [],
                expenses: {},
                taxRate: 0,
                projectionSettings: {},
            };
            const result = webhook(db, 'accounts', { name: 'Test' });
            expect(result).toBe(false);
        });
    });
});
