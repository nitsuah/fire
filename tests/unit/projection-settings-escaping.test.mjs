import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { normalizeSpanYears } = require('../../app/lib/aggregates.js');

// projections.js is a classic browser script that depends on globals, so load
// it into a stubbed browser context and call renderProjSettingsSummary directly.
const APP_LIB = path.join(__dirname, '../../app/lib');

function loadModule() {
    const storage = {};
    const el = { innerHTML: '' };
    const ctx = {
        state: { projectionSettings: {} },
        document: {
            getElementById: () => el,
            querySelector: () => el,
            querySelectorAll: () => [],
        },
        localStorage: {
            getItem: (k) => storage[k] ?? null,
            setItem: (k, v) => {
                storage[k] = v;
            },
        },
        window: { FireAggregates: { normalizeSpanYears } },
        JSON,
        Number,
        Array,
        Set,
        Intl,
        formatCurrency: (v) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 2,
            }).format(Number(v || 0)),
    };
    vm.createContext(ctx);
    vm.runInContext(
        fs.readFileSync(path.join(APP_LIB, 'projections.js'), 'utf8'),
        ctx,
    );
    return { ctx, el };
}

describe('renderProjSettingsSummary', () => {
    it('renders hostile projection settings as inert text, not markup', () => {
        const { ctx, el } = loadModule();
        ctx.state.projectionSettings = {
            currentAge: '<script>alert(1)</script>',
            retireAge: '"><img src=x onerror=alert(2)>',
            annualSavings: 0,
            expectedReturn: 0,
            inflationRate: 0,
            swr: 4,
            spanYears: 30,
        };
        vm.runInContext('renderProjSettingsSummary()', ctx);
        expect(el.innerHTML).not.toContain('<script');
    });

    it('renders ordinary numeric settings unchanged', () => {
        const { ctx, el } = loadModule();
        ctx.state.projectionSettings = {
            currentAge: 35,
            retireAge: 60,
            annualSavings: 20000,
            expectedReturn: 8.0,
            inflationRate: 2.5,
            swr: 4.0,
            spanYears: 10,
        };
        vm.runInContext('renderProjSettingsSummary()', ctx);
        expect(el.innerHTML).toContain('Age <strong>35</strong>');
        expect(el.innerHTML).toContain('retire <strong>60</strong>');
        expect(el.innerHTML).toContain('$20,000.00</strong>/yr');
        expect(el.innerHTML).toContain('8.0%');
        expect(el.innerHTML).toContain('2.5%');
        expect(el.innerHTML).toContain('4.0%');
        expect(el.innerHTML).toContain('10yr span');
    });
});
