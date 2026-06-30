'use strict';

const {
    sanitizeState,
} = require('../../app/lib/finance-core');

// ─── sanitizeState ─────────────────────────────────────────────────────────────

describe('sanitizeState', () => {
    it('returns empty object for null/undefined', () => {
        expect(sanitizeState(null)).toEqual({});
        expect(sanitizeState(undefined)).toEqual({});
    });

    it('initialises missing array fields', () => {
        const result = sanitizeState({});
        expect(result.importedPositions).toEqual([]);
        expect(result.customAccounts).toEqual([]);
        expect(result.cds).toEqual([]);
        expect(result.realEstate).toEqual([]);
        expect(result.vehicles).toEqual([]);
        expect(result.sideGigLedger).toEqual([]);
        expect(result.importedFiles).toEqual([]);
    });

    it('fills missing vehicle fields with defaults', () => {
        const state = { vehicles: [{ make: 'Toyota', model: 'Camry' }] };
        const result = sanitizeState(state);
        const v = result.vehicles[0];
        expect(v.year).toBe(new Date().getFullYear());
        expect(v.mileage).toBe(0);
        expect(v.condition).toBe('Good');
        expect(v.currentValue).toBe(0);
        expect(v.loanBalance).toBe(0);
    });

    it('does not overwrite existing vehicle fields', () => {
        const state = {
            vehicles: [
                {
                    year: 2020,
                    make: 'Honda',
                    model: 'Civic',
                    mileage: 30000,
                    condition: 'Excellent',
                    currentValue: 18000,
                },
            ],
        };
        const result = sanitizeState(state);
        expect(result.vehicles[0].year).toBe(2020);
        expect(result.vehicles[0].condition).toBe('Excellent');
        expect(result.vehicles[0].currentValue).toBe(18000);
    });

    it('fills missing realEstate fields', () => {
        const state = { realEstate: [{ name: 'Home' }] };
        const result = sanitizeState(state);
        const re = result.realEstate[0];
        expect(re.marketValue).toBe(0);
        expect(re.mortgageBalance).toBe(0);
        expect(re.type).toBe('Primary Home');
    });

    it('fills null apy and value in customAccounts', () => {
        const state = {
            customAccounts: [
                {
                    id: '1',
                    name: 'Checking',
                    type: 'Cash',
                    apy: null,
                    value: null,
                },
            ],
        };
        const result = sanitizeState(state);
        expect(result.customAccounts[0].apy).toBe(0);
        expect(result.customAccounts[0].value).toBe(0);
    });

    it('fills missing CD fields', () => {
        const state = {
            cds: [{ id: '1', bank: 'Marcus', maturity: '2025-12-01' }],
        };
        const result = sanitizeState(state);
        const cd = result.cds[0];
        expect(cd.startDate).toBe('');
        expect(cd.principal).toBe(0);
        expect(cd.rate).toBe(0);
    });

    it('defaults projectionSettings age fields', () => {
        const state = { projectionSettings: { annualSavings: 10000 } };
        const result = sanitizeState(state);
        expect(result.projectionSettings.currentAge).toBe(30);
        expect(result.projectionSettings.retireAge).toBe(60);
    });

    it('creates default insurances when missing', () => {
        const result = sanitizeState({});
        expect(result.insurances.car).toEqual({ amt: 0, freq: '6month' });
        expect(result.insurances.home).toEqual({ amt: 0, freq: 'monthly' });
    });

    it('fills missing car insurance when home is present', () => {
        const state = { insurances: { home: { amt: 100, freq: 'monthly' } } };
        const result = sanitizeState(state);
        expect(result.insurances.car).toEqual({ amt: 0, freq: '6month' });
    });
});