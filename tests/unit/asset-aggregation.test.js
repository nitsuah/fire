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
    it('returns true for settled cash', () => {
        expect(isSettledCash('Cash', 'Settled')).toBe(true);
    });

    it('returns true for cash account settled today', () => {
        expect(isSettledCash('Cash', '2024-01-01')).toBe(true);
    });

    it('returns false for unsettled cash', () => {
        expect(isSettledCash('Cash', 'Unreviewed')).toBe(false);
    });

    it('returns false for non-cash account', () => {
        expect(isSettledCash('Stock', 'Settled')).toBe(false);
    });
});

// ─── getAggregateCash ─────────────────────────────────────────────────────────────────

describe('getAggregateCash', () => {
    it('returns 0 when no cash accounts', () => {
        expect(getAggregateCash([])).toBe(0);
    });

    it('sums cash values', () => {
        const cashAccounts = [
            { value: 1000, type: 'Cash' },
            { value: 2000, type: 'Savings' },
        ];
        expect(getAggregateCash(cashAccounts)).toBe(3000);
    });

    it('includes cash accounts with zero value', () => {
        const cashAccounts = [{ value: 0, type: 'Cash' }];
        expect(getAggregateCash(cashAccounts)).toBe(0);
    });
});

// ─── getAggregateCDs ─────────────────────────────────────────────────────────────────

describe('getAggregateCDs', () => {
    it('returns 0 when no CDs', () => {
        expect(getAggregateCDs([])).toBe(0);
    });

    it('sums CD principal values', () => {
        const cds = [
            { principal: 5000, type: 'CD' },
            { principal: 10000, type: 'CD' },
        ];
        expect(getAggregateCDs(cds)).toBe(15000);
    });
});

// ─── getAggregateEquities ─────────────────────────────────────────────────────────────────

describe('getAggregateEquities', () => {
    it('returns 0 when no equities', () => {
        expect(getAggregateEquities([])).toBe(0);
    });

    it('sums equity values', () => {
        const equities = [
            { value: 5000, type: 'Stock' },
            { value: 10000, type: 'ETF' },
        ];
        expect(getAggregateEquities(equities)).toBe(15000);
    });
});

// ─── getAggregateOtherAssets ─────────────────────────────────────────────────────────────────

describe('getAggregateOtherAssets', () => {
    it('returns 0 when no other assets', () => {
        expect(getAggregateOtherAssets([])).toBe(0);
    });

    it('sums other asset values', () => {
        const otherAssets = [
            { value: 2000, type: 'Crypto' },
            { value: 3000, type: 'NFT' },
        ];
        expect(getAggregateOtherAssets(otherAssets)).toBe(5000);
    });
});

// ─── getSideGigYTDNet ─────────────────────────────────────────────────────────────────

describe('getSideGigYTDNet', () => {
    it('returns 0 when no side gig activity', () => {
        expect(getSideGigYTDNet([])).toBe(0);
    });

    it('sums side gig income and expenses', () => {
        const sideGig = [
            { income: 5000, expenses: 1000 },
            { income: 3000, expenses: 500 },
        ];
        expect(getSideGigYTDNet(sideGig)).toBe(6500);
    });
});

// ─── getAggregateRealEstate ─────────────────────────────────────────────────────────────────

describe('getAggregateRealEstate', () => {
    it('returns 0 when no real estate', () => {
        expect(getAggregateRealEstate([])).toBe(0);
    });

    it('sums real estate values', () => {
        const realEstate = [
            { value: 300000, type: 'Primary Home' },
            { value: 200000, type: 'Investment Property' },
        ];
        expect(getAggregateRealEstate(realEstate)).toBe(500000);
    });
});

// ─── getAggregateVehicles ─────────────────────────────────────────────────────────────────

describe('getAggregateVehicles', () => {
    it('returns 0 when no vehicles', () => {
        expect(getAggregateVehicles([])).toBe(0);
    });

    it('sums vehicle values', () => {
        const vehicles = [
            { currentValue: 25000, make: 'Toyota' },
            { currentValue: 40000, make: 'Honda' },
        ];
        expect(getAggregateVehicles(vehicles)).toBe(65000);
    });
});

// ─── getAggregateNetWorth ─────────────────────────────────────────────────────────────────

describe('getAggregateNetWorth', () => {
    it('calculates net worth from all asset types', () => {
        const state = {
            customAccounts: [
                { value: 10000, type: 'Cash' },
                { value: 5000, type: 'Investment' },
            ],
            cds: [
                { principal: 20000, type: 'CD' },
            ],
            equities: [
                { value: 50000, type: 'Stock' },
            ],
            realEstate: [
                { value: 300000, type: 'Primary Home' },
            ],
            vehicles: [
                { currentValue: 25000, make: 'Toyota' },
            ],
            insurances: {
                car: { amt: 1200, freq: '6month' },
                home: { amt: 1800, freq: 'monthly' },
            },
        };
        const result = getAggregateNetWorth(state);
        expect(result.totalValue).toBe(510200);
        expect(result.totalMonthlyExpenses).toBe(2400);
    });
});