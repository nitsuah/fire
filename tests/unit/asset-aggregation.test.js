'use strict';

const {
    isSettledCash,
    getAggregateCash,
    getAggregateCDs,
    getAggregateEquities,
    getAggregateOtherAssets,
    getSideGigYTDNet,
    getAggregateRealEstate,
    getAggregateVehicles,
    getAggregateNetWorth,
} = require('../../app/lib/finance-core');

// ─── isSettledCash ─────────────────────────────────────────────────────────────────

describe('isSettledCash', () => {
    it('identifies SPAXX as settled cash', () => {
        expect(isSettledCash({ symbol: 'SPAXX', description: '' })).toBe(true);
    });

    it('identifies FDRXX as settled cash', () => {
        expect(isSettledCash({ symbol: 'FDRXX', description: '' })).toBe(true);
    });

    it('identifies money market descriptions', () => {
        expect(
            isSettledCash({
                symbol: 'XX',
                description: 'Fidelity Money Market Fund',
            }),
        ).toBe(true);
    });

    it('identifies pending activity', () => {
        expect(
            isSettledCash({ symbol: 'XX', description: 'Pending Activity' }),
        ).toBe(true);
    });

    it('identifies core position', () => {
        expect(
            isSettledCash({ symbol: 'XX', description: 'Core Position' }),
        ).toBe(true);
    });

    it('does not flag regular equities', () => {
        expect(
            isSettledCash({ symbol: 'AAPL', description: 'Apple Inc' }),
        ).toBe(false);
    });

    it('identifies ** symbol as settled', () => {
        expect(isSettledCash({ symbol: '**', description: '' })).toBe(true);
    });

    it('is case-insensitive for symbol', () => {
        expect(isSettledCash({ symbol: 'spaxx', description: '' })).toBe(true);
    });
});

// ─── getAggregateCash ──────────────────────────────────────────────────────────

describe('getAggregateCash', () => {
    it('sums SPAXX positions and Cash/Savings accounts', () => {
        const positions = [
            { symbol: 'SPAXX', description: '', value: 5000 },
            { symbol: 'AAPL', description: '', value: 2000 },
        ];
        const accounts = [
            { type: 'Cash', value: 3000 },
            { type: 'Brokerage', value: 10000 },
        ];
        expect(getAggregateCash(positions, accounts)).toBe(8000); // 5000 + 3000
    });

    it('handles empty arrays', () => {
        expect(getAggregateCash([], [])).toBe(0);
    });

    it('includes FDRXX positions', () => {
        const positions = [{ symbol: 'FDRXX', description: '', value: 1500 }];
        expect(getAggregateCash(positions, [])).toBe(1500);
    });

    it('includes MONEY MARKET descriptions', () => {
        const positions = [
            {
                symbol: 'XX',
                description: 'FIDELITY MONEY MARKET CORE',
                value: 750,
            },
        ];
        expect(getAggregateCash(positions, [])).toBe(750);
    });

    it('includes Savings account type', () => {
        const accounts = [{ type: 'Savings', value: 12000 }];
        expect(getAggregateCash([], accounts)).toBe(12000);
    });
});

// ─── getAggregateCDs ───────────────────────────────────────────────────────────

describe('getAggregateCDs', () => {
    it('sums all CD principals', () => {
        const cds = [
            { principal: 10000, rate: 5 },
            { principal: 5000, rate: 4.5 },
        ];
        expect(getAggregateCDs(cds)).toBe(15000);
    });

    it('returns 0 for empty array', () => {
        expect(getAggregateCDs([])).toBe(0);
    });

    it('handles undefined principal gracefully', () => {
        const cds = [{ bank: 'Test' }];
        expect(getAggregateCDs(cds)).toBe(0);
    });
});

// ─── getAggregateEquities ──────────────────────────────────────────────────────

describe('getAggregateEquities', () => {
    it('sums non-cash imported positions and Brokerage/Crypto accounts', () => {
        const positions = [
            { symbol: 'AAPL', description: '', value: 5000 },
            { symbol: 'SPAXX', description: '', value: 2000 },
        ];
        const accounts = [
            { type: 'Brokerage', value: 3000 },
            { type: 'Crypto', value: 1000 },
            { type: 'Savings', value: 500 },
        ];
        expect(getAggregateEquities(positions, accounts)).toBe(9000); // 5000 + 3000 + 1000
    });

    it('returns 0 for empty inputs', () => {
        expect(getAggregateEquities([], [])).toBe(0);
    });
});

// ─── getAggregateOtherAssets ───────────────────────────────────────────────────

describe('getAggregateOtherAssets', () => {
    it('sums accounts that are not Cash/Savings/Brokerage/Crypto', () => {
        const accounts = [
            { type: 'Other', value: 2000 },
            { type: 'RealEstate', value: 5000 },
            { type: 'Cash', value: 1000 },
            { type: 'Savings', value: 500 },
        ];
        expect(getAggregateOtherAssets(accounts)).toBe(7000);
    });

    it('returns 0 for empty or all-excluded types', () => {
        expect(getAggregateOtherAssets([])).toBe(0);
        expect(getAggregateOtherAssets([{ type: 'Cash', value: 100 }])).toBe(0);
    });
});

// ─── getSideGigYTDNet ─────────────────────────────────────────────────────────

describe('getSideGigYTDNet', () => {
    it('sums net values from ledger', () => {
        const ledger = [{ net: 150 }, { net: -30 }, { net: 200 }];
        expect(getSideGigYTDNet(ledger)).toBe(320);
    });

    it('returns 0 for empty ledger', () => {
        expect(getSideGigYTDNet([])).toBe(0);
    });
});

// ─── getAggregateRealEstate ────────────────────────────────────────────────────

describe('getAggregateRealEstate', () => {
    it('computes equity (market value - mortgage)', () => {
        const re = [
            { marketValue: 400000, mortgageBalance: 250000 },
            { marketValue: 200000, mortgageBalance: 180000 },
        ];
        expect(getAggregateRealEstate(re)).toBe(170000); // 150000 + 20000
    });

    it('floors negative equity at 0', () => {
        const re = [{ marketValue: 100000, mortgageBalance: 120000 }];
        expect(getAggregateRealEstate(re)).toBe(0);
    });

    it('returns 0 for empty list', () => {
        expect(getAggregateRealEstate([])).toBe(0);
    });
});

// ─── getAggregateVehicles ──────────────────────────────────────────────────────

describe('getAggregateVehicles', () => {
    it('computes equity (current value - loan balance)', () => {
        const vehicles = [
            { currentValue: 25000, loanBalance: 15000 },
            { currentValue: 12000, loanBalance: 0 },
        ];
        expect(getAggregateVehicles(vehicles)).toBe(22000); // 10000 + 12000
    });

    it('floors negative equity at 0 (underwater loan)', () => {
        const vehicles = [{ currentValue: 8000, loanBalance: 12000 }];
        expect(getAggregateVehicles(vehicles)).toBe(0);
    });
});

// ─── getAggregateNetWorth ──────────────────────────────────────────────────────

describe('getAggregateNetWorth', () => {
    it('sums all asset categories', () => {
        const state = {
            importedPositions: [
                { symbol: 'AAPL', description: '', value: 10000 },
            ],
            customAccounts: [{ type: 'Cash', value: 5000 }],
            cds: [{ principal: 8000 }],
            realEstate: [{ marketValue: 300000, mortgageBalance: 200000 }],
            vehicles: [{ currentValue: 20000, loanBalance: 10000 }],
            sideGigLedger: [{ net: 500 }],
        };
        const nw = getAggregateNetWorth(state);
        // equities: 10000, cash: 5000, CDs: 8000, RE equity: 100000, vehicles: 10000, side: 500
        expect(nw).toBe(133500);
    });

    it('returns 0 when state has no assets', () => {
        const state = {
            importedPositions: [],
            customAccounts: [],
            cds: [],
            realEstate: [],
            vehicles: [],
            sideGigLedger: [],
        };
        expect(getAggregateNetWorth(state)).toBe(0);
    });
});
