import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// handleTool is imported lazily so FIRE_DB_FILE is set first, matching
// mcp-server-read-only.test.mjs (static imports hoist above the assignment).
process.env.FIRE_DB_FILE = 'mcp-get-insurances-test-unused.json';
const aggregates = require('../../app/lib/aggregates.js');

describe('get_insurances shape', () => {
    it('normalizes 6-month, annual and monthly premiums to the same monthly total', () => {
        const ins = {
            car: { amt: 600, freq: '6month' }, // 100/mo
            home: { amt: 1200, freq: 'annual' }, // 100/mo
        };
        expect(aggregates.insuranceToMonthly(ins.car)).toBe(100);
        expect(aggregates.insuranceToMonthly(ins.home)).toBe(100);
        expect(aggregates.getInsuranceMonthly(ins)).toBe(200);
    });

    it('treats a missing or zero policy as zero', () => {
        expect(aggregates.getInsuranceMonthly(undefined)).toBe(0);
        expect(aggregates.insuranceToMonthly({})).toBe(0);
        expect(
            aggregates.getInsuranceMonthly({
                car: { amt: 0, freq: 'monthly' },
            }),
        ).toBe(0);
    });
});
