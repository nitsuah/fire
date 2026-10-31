import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const {
    normalizeSpanYears,
    MAX_SPAN_YEARS,
} = require('../../app/lib/aggregates.js');

const projectionSource = readFileSync(
    new URL('../../app/lib/projections.js', import.meta.url),
    'utf8',
);

function createProjectionContext(spanYears = 30, formValues = {}) {
    const elements = new Map();
    const document = {
        getElementById(id) {
            if (!elements.has(id)) {
                elements.set(id, { value: formValues[id] ?? '', innerHTML: '' });
            }
            return elements.get(id);
        },
        querySelectorAll() {
            return [];
        },
    };
    const context = {
        window: {
            FireAggregates: { normalizeSpanYears },
            FireChaos: null,
        },
        localStorage: { getItem: () => null, setItem: () => {} },
        document,
        state: {
            projectionSettings: {
                spanYears,
                currentAge: 30,
                retireAge: 60,
                expectedReturn: 7,
                inflationRate: 2,
                swr: 4,
                annualSavings: 0,
            },
            cds: [],
            taxGrossIncome: 0,
        },
        scenarioOffset: 0,
        getAggregateNetWorth: () => 100000,
        getAggregateCash: () => 10000,
        getAnnualExpensesTotal: () => 40000,
        getMonthlyExpensesBase: () => 3000,
        formatCurrency: value => String(value),
    };
    runInNewContext(projectionSource, context);
    return { context, elements };
}

describe('normalizeSpanYears', () => {
    it('defaults missing, blank, invalid, boolean and out-of-range-low values', () => {
        for (const value of [
            undefined,
            null,
            '',
            '   ',
            'not a number',
            true,
            false,
            NaN,
            Infinity,
            0,
            -5,
        ]) {
            expect(normalizeSpanYears(value)).toBe(30);
        }
    });

    it('keeps supported integer values and numeric strings', () => {
        expect(normalizeSpanYears(1)).toBe(1);
        expect(normalizeSpanYears(30)).toBe(30);
        expect(normalizeSpanYears('12')).toBe(12);
        expect(normalizeSpanYears(' 12 ')).toBe(12);
        expect(normalizeSpanYears('3e1')).toBe(30);
        expect(normalizeSpanYears(MAX_SPAN_YEARS)).toBe(120);
    });

    it('truncates fractional values to whole years', () => {
        expect(normalizeSpanYears(7.9)).toBe(7);
        expect(normalizeSpanYears(1.9)).toBe(1);
    });

    it('clamps huge horizons to the existing 120-year maximum', () => {
        expect(normalizeSpanYears(121)).toBe(120);
        expect(normalizeSpanYears(1e9)).toBe(120);
        expect(MAX_SPAN_YEARS).toBe(120);
    });

    it('normalizes the raw form value, including exponent notation', () => {
        const { context } = createProjectionContext(30, {
            'proj-savings': '0',
            'proj-return': '7',
            'proj-inflation': '2',
            'proj-swr': '4',
            'proj-years': '3e1',
            'proj-current-age': '30',
            'proj-retire-age': '60',
        });
        expect(context.readProjectionSettingsFromForm().spanYears).toBe(30);
    });

    it('shows the normalized horizon in the collapsed settings summary', () => {
        const { context, elements } = createProjectionContext(1000);
        context.renderProjSettingsSummary();
        expect(elements.get('proj-settings-summary').innerHTML).toContain('120yr span');
    });

    it('bounds the browser projection arrays to 121 points', () => {
        const { context } = createProjectionContext(1000000);
        const result = context.buildProjectionData();
        for (const key of [
            'labels',
            'nwData',
            'fireLine',
            'leanFireLine',
            'fatFireLine',
            'coastFireLine',
            'bullData',
            'bearData',
            'benchData',
        ]) {
            expect(result[key]).toHaveLength(121);
        }
    });
});
