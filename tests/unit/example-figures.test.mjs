import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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

    it('matches the state the app starts with', () => {
        // app.js is a browser script, so evaluate just its initial state.
        const appJs = read('../../app/app.js').replaceAll(
            String.fromCharCode(13),
            '',
        );
        const start = appJs.indexOf('var state = {');
        const end = appJs.indexOf(`${String.fromCharCode(10)}};`, start) + 3;
        const sandbox = vm.createContext({
            FireQuickStartFacts: { DEFAULT_PROJECTION },
        });
        vm.runInContext(appJs.slice(start, end), sandbox);
        const initial = JSON.parse(JSON.stringify(sandbox.state));
        expect(initial.expenses).toEqual(DEFAULT_EXPENSES);
        expect(initial.taxGrossIncome).toBe(DEFAULT_GROSS_INCOME);
        expect(exampleFigures(initial)).toEqual([
            'income',
            'spending',
            'growth assumptions',
        ]);
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
        // The layout manager turns every .card into a movable widget.
        expect(dashboard).toContain('class="dash-summary"');
    });

    it('precaches the script', () => {
        expect(read('../../app/sw.js')).toContain("'/lib/example-figures.js'");
    });
});

describe('browser load', () => {
    // No `module` in the sandbox: both scripts take their globalThis branch,
    // as they do when index.html loads them in this order.
    it('reads the projection defaults from the earlier script', () => {
        const sandbox = vm.createContext({});
        for (const file of ['quick-start-facts.js', 'example-figures.js']) {
            vm.runInContext(read(`../../app/lib/${file}`), sandbox);
        }
        expect(
            sandbox.FireExampleFigures.exampleFigures({
                projectionSettings: { ...DEFAULT_PROJECTION },
            }),
        ).toContain('growth assumptions');
    });

    it('is loaded after quick-start-facts.js', () => {
        const html = read('../../app/index.html');
        expect(html.indexOf('src="lib/quick-start-facts.js"')).toBeLessThan(
            html.indexOf('src="lib/example-figures.js"'),
        );
    });
});
