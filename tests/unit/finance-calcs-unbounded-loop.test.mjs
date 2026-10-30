import { describe, it, expect, beforeEach } from 'vitest';
import { buildProjectionData } from '../../app/lib/finance-calcs.js';

describe('buildProjectionData - unbounded loop protection', () => {
    let state;

    beforeEach(() => {
        state = {
            projectionSettings: {
                spanYears: 30, // default
                currentAge: 30,
                retireAge: 60,
                expectedReturn: 7,
                inflationRate: 2,
                swr: 4.0,
                annualSavings: 0,
            },
            // Other required properties
            taxRate: 0,
            customAccounts: [],
            importedPositions: [],
            realEstate: [],
            vehicles: [],
            cds: [],
        };
    });

    it('clamps an over-limit span and returns quickly instead of looping for millions of years', () => {
        state.projectionSettings.spanYears = 1000000;
        const start = Date.now();
        const result = buildProjectionData(state, 0);
        expect(Date.now() - start).toBeLessThan(1000);
        expect(result.labels.length).toBe(121); // clamped to 120 years, 0..120 inclusive
    });

    it('works correctly with normal span input (30 years)', () => {
        // Arrange: Normal span value
        state.projectionSettings.spanYears = 30;

        // Act
        const result = buildProjectionData(state, 0);

        // Assert: Should return valid data structure
        expect(result).toHaveProperty('labels');
        expect(result).toHaveProperty('nwData');
        expect(result).toHaveProperty('fireLine');
        expect(result).toHaveProperty('leanFireLine');
        expect(result).toHaveProperty('fatFireLine');
        expect(result).toHaveProperty('coastFireLine');
        expect(result).toHaveProperty('bullData');
        expect(result).toHaveProperty('bearData');
        expect(result).toHaveProperty('benchData');
        expect(result).toHaveProperty('retirementLineIndex');
        expect(result).toHaveProperty('cdEvents');
        expect(result).toHaveProperty('networth');
        expect(result).toHaveProperty('passiveIncome');
        expect(result).toHaveProperty('blendedReturn');
        expect(result).toHaveProperty('netWithdrawal');
        expect(result).toHaveProperty('depletionAge');

        // Additional validation: spanYears should equal 30
        expect(result.labels.length).toBe(31); // 0 to 30 inclusive
    });
});
