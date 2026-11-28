import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
    DEFAULT_GROSS_INCOME,
    DEFAULT_EXPENSES,
    exampleFigures,
} = require('../../app/lib/example-figures.js');
const { DEFAULT_PROJECTION } = require('../../app/lib/quick-start-facts.js');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const fresh = () => ({
    taxGrossIncome: DEFAULT_GROSS_INCOME,
    expenses: { ...DEFAULT_EXPENSES },
    insurances: { car: { amt: 0 }, home: { amt: 0 } },
    projectionSettings: { ...DEFAULT_PROJECTION },
});

describe('exampleFigures', () => {
    it('marks every group on a fresh profile', () => {
        expect(exampleFigures(fresh())).toEqual([
            'income',
            'spending',
            'growth assumptions',
        ]);
    });

    it('clears only the group the user edited', () => {
        const state = fresh();
        state.taxGrossIncome = 82000;
        expect(exampleFigures(state)).toEqual([
            'spending',
            'growth assumptions',
        ]);
        state.insurances.car.amt = 600;
        expect(exampleFigures(state)).toEqual(['growth assumptions']);
        state.projectionSettings.annualSavings = 12000;
        expect(exampleFigures(state)).toEqual([]);
    });

    it('is empty once the user confirms the figures', () => {
        expect(
            exampleFigures({ ...fresh(), assumptionsConfirmed: true }),
        ).toEqual([]);
    });

    it('matches the defaults the app starts and resets with', () => {
        const appJs = read('../../app/app.js');
        for (const [key, value] of Object.entries(DEFAULT_EXPENSES)) {
            expect(appJs).toContain(`${key}: ${value}`);
        }
        expect(appJs).toContain(`taxGrossIncome: ${DEFAULT_GROSS_INCOME}`);
    });
});

describe('dashboard summary markup', () => {
    const html = read('../../app/index.html');

    it('has a net worth figure and a product sentence on the dashboard', () => {
        const dashboard = html.slice(
            html.indexOf('id="tab-dashboard"'),
            html.indexOf('id="tab-financial"'),
        );
        expect(dashboard).toContain('id="dash-net-worth"');
        expect(dashboard).toContain('class="dash-tagline"');
        expect(dashboard).toContain('id="example-note"');
    });

    it('precaches the script', () => {
        expect(read('../../app/sw.js')).toContain("'/lib/example-figures.js'");
    });
});
