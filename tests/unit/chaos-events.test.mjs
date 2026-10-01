import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const FC = require('../../app/lib/chaos-events.js');

const opts = { currentAge: 30, retireAge: 60, span: 40 };

describe('chaos catalog', () => {
    it('has 20–30 distinct events', () => {
        expect(FC.CATALOG.length).toBeGreaterThanOrEqual(20);
        expect(FC.CATALOG.length).toBeLessThanOrEqual(30);
        const ids = new Set(FC.CATALOG.map((d) => d.id));
        expect(ids.size).toBe(FC.CATALOG.length);
    });

    it('every event has a known category and sane predefined outcomes', () => {
        FC.CATALOG.forEach((def) => {
            expect(FC.CATEGORIES[def.category]).toBeDefined();
            expect(def.rate).toBeGreaterThan(0);
            expect(def.rate).toBeLessThan(0.1);
            expect(def.outcomes.length).toBeGreaterThanOrEqual(2);
            def.outcomes.forEach((o) => {
                // Positive events only ever add money; negative ones only cost.
                if (def.positive) {
                    expect(o.cost || 0).toBe(0);
                    expect(o.incomeMonths || 0).toBe(0);
                    expect((o.gain || 0) + (o.annual || 0)).toBeGreaterThan(0);
                } else {
                    expect(o.gain || 0).toBe(0);
                    expect(o.annual || 0).toBeLessThanOrEqual(0);
                    expect(o.nwPct || 0).toBeLessThanOrEqual(0);
                }
            });
        });
    });
});

describe('generateEvents', () => {
    it('is deterministic for a seed and differs across seeds', () => {
        const a = FC.generateEvents({ seed: 42, ...opts });
        const b = FC.generateEvents({ seed: 42, ...opts });
        const c = FC.generateEvents({ seed: 43, ...opts });
        expect(a).toEqual(b);
        expect(a.map((e) => e.id)).not.toEqual(c.map((e) => e.id));
    });

    it('is sorted chronologically and respects per-year cap', () => {
        for (let seed = 1; seed <= 50; seed++) {
            const evs = FC.generateEvents({ seed, ...opts });
            for (let i = 1; i < evs.length; i++) {
                const p = evs[i - 1].yearIndex * 12 + evs[i - 1].month;
                expect(
                    evs[i].yearIndex * 12 + evs[i].month,
                ).toBeGreaterThanOrEqual(p);
            }
            const perYear = {};
            evs.forEach(
                (e) => (perYear[e.yearIndex] = (perYear[e.yearIndex] || 0) + 1),
            );
            Object.values(perYear).forEach((n) =>
                expect(n).toBeLessThanOrEqual(FC.MAX_EVENTS_PER_YEAR),
            );
        }
    });

    it('keeps a healthy density: ≥1 in year one, ≥3 per 5 years, not cluttered', () => {
        for (let seed = 1; seed <= 100; seed++) {
            const evs = FC.generateEvents({ seed, ...opts });
            expect(
                evs.filter((e) => e.yearIndex === 0).length,
            ).toBeGreaterThanOrEqual(1);
            for (let b = 0; b < opts.span; b += 5) {
                const n = evs.filter(
                    (e) => e.yearIndex >= b && e.yearIndex < b + 5,
                ).length;
                expect(n).toBeGreaterThanOrEqual(3);
            }
            // ~0.4–1.2 events per year on average over a 40-year life.
            expect(evs.length).toBeGreaterThanOrEqual(16);
            expect(evs.length).toBeLessThanOrEqual(50);
        }
    });

    it('respects age windows, working-only events and lifetime caps', () => {
        for (let seed = 1; seed <= 100; seed++) {
            const evs = FC.generateEvents({ seed, ...opts });
            const counts = {};
            evs.forEach((ev) => {
                const def = FC.CATALOG.find((d) => d.id === ev.defId);
                if (def.ageMin !== undefined)
                    expect(ev.age).toBeGreaterThanOrEqual(def.ageMin);
                if (def.ageMax !== undefined)
                    expect(ev.age).toBeLessThanOrEqual(def.ageMax);
                if (def.working) expect(ev.age).toBeLessThan(opts.retireAge);
                counts[def.id] = (counts[def.id] || 0) + 1;
                expect(counts[def.id]).toBeLessThanOrEqual(def.max);
                expect(def.outcomes.map((o) => o.label)).toContain(
                    ev.outcome.label,
                );
            });
        }
    });

    it('skips paycheck events when there is no earned income', () => {
        const paycheck = FC.CATALOG.filter((d) => d.needsPaycheck).map(
            (d) => d.id,
        );
        expect(paycheck.sort()).toEqual(
            ['bonus', 'job-loss', 'pay-cut', 'rsu'].sort(),
        );
        let withIncome = 0;
        for (let seed = 1; seed <= 100; seed++) {
            const none = FC.generateEvents({
                seed,
                ...opts,
                hasEarnedIncome: false,
            });
            none.forEach((ev) => expect(paycheck).not.toContain(ev.defId));
            withIncome += FC.generateEvents({ seed, ...opts }).filter((ev) =>
                paycheck.includes(ev.defId),
            ).length;
        }
        expect(withIncome).toBeGreaterThan(0);
    });

    it('returns nothing for a zero span', () => {
        expect(
            FC.generateEvents({
                seed: 1,
                currentAge: 30,
                retireAge: 60,
                span: 0,
            }),
        ).toEqual([]);
    });
});

describe('simulate', () => {
    const base = {
        startNW: 100000,
        cashFraction: 0.1,
        realReturn: 0.05,
        savings: 20000,
        annualExpenses: 40000,
        currentAge: 30,
        retireAge: 40,
        span: 20,
    };

    it('with no events reproduces the plain accumulate/withdraw path', () => {
        const { nwData } = FC.simulate({ ...base, events: [] });
        let nw = base.startNW;
        for (let yr = 0; yr < 10; yr++) {
            expect(nwData[yr]).toBe(Math.round(nw));
            nw = nw * 1.05 + 20000;
        }
        expect(nwData[10]).toBe(Math.round(nw));
        expect(nwData).toHaveLength(21);
    });

    const ev = (outcome, yearIndex = 2, positive = false) => ({
        id: `t@${yearIndex}`,
        yearIndex,
        month: 0,
        age: 30 + yearIndex,
        positive,
        outcome,
    });

    it('applies a one-time cost at that year and nothing before it', () => {
        const plain = FC.simulate({ ...base, events: [] }).nwData;
        const { nwData, impacts } = FC.simulate({
            ...base,
            events: [ev({ cost: 10000 })],
        });
        expect(nwData.slice(0, 3)).toEqual(plain.slice(0, 3));
        expect(plain[3] - nwData[3]).toBe(10000);
        expect(impacts['t@2']).toMatchObject({ lump: -10000, total: -10000 });
    });

    it('applies recurring flows for their duration only', () => {
        const plain = FC.simulate({ ...base, events: [] }).nwData;
        const { nwData, impacts } = FC.simulate({
            ...base,
            events: [ev({ annual: -5000, years: 2 })],
        });
        expect(plain[3] - nwData[3]).toBe(5000);
        expect(impacts['t@2']).toMatchObject({
            annual: -5000,
            years: 2,
            total: -10000,
        });
    });

    it('"until retirement" flows stop at the retirement age', () => {
        const { impacts } = FC.simulate({
            ...base,
            events: [ev({ annual: 10000, years: null }, 2, true)],
        });
        expect(impacts['t@2'].years).toBe(8);
        expect(impacts['t@2'].total).toBe(80000);
    });

    it('scales income loss and net-worth percentages', () => {
        const { impacts } = FC.simulate({
            ...base,
            events: [ev({ incomeMonths: 6 }, 0), ev({ nwPct: -0.2 }, 1)],
        });
        expect(impacts['t@0'].lump).toBe(-30000); // half of 20k + 40k
        // NW at start of year 1 is 100k*1.05+20k-30k = 95k → −19k
        expect(impacts['t@1'].lump).toBe(-19000);
    });

    it('income loss uses real spending, not the tax-padded expense total', () => {
        const { impacts } = FC.simulate({
            ...base,
            annualExpenses: 48000, // 40k spending + 8k FIRE tax drag
            spending: 40000,
            events: [ev({ incomeMonths: 6 }, 0)],
        });
        expect(impacts['t@0'].lump).toBe(-30000); // half of 20k + 40k
    });

    it('lump sums compound with the portfolio afterwards', () => {
        const plain = FC.simulate({ ...base, events: [] }).nwData;
        const { nwData } = FC.simulate({
            ...base,
            events: [ev({ cost: 10000 }, 0)],
        });
        // Paid at the end of year 0, then grows (well, fails to) at 5%/yr
        expect(plain[1] - nwData[1]).toBe(10000);
        expect(plain[3] - nwData[3]).toBe(Math.round(10000 * 1.05 ** 2));
    });

    it('a windfall in retirement lands in the portfolio', () => {
        const plain = FC.simulate({ ...base, events: [] }).nwData;
        const { nwData } = FC.simulate({
            ...base,
            events: [ev({ gain: 50000 }, 12, true)],
        });
        expect(nwData[13]).toBeGreaterThan(plain[13]);
    });

    it('reports depletion when costs drain the portfolio', () => {
        const { depletionAge } = FC.simulate({
            ...base,
            startNW: 0,
            savings: 0,
            events: [],
        });
        expect(depletionAge).toBe(41);
    });
});

describe('window + tooltip helpers', () => {
    const evs = [
        { id: 'a', yearIndex: 0, month: 2 },
        { id: 'b', yearIndex: 0, month: 9 },
        { id: 'c', yearIndex: 4, month: 0 },
        { id: 'd', yearIndex: 9, month: 11 },
    ];
    it('eventsInWindow keeps events up to the last displayed point', () => {
        expect(FC.eventsInWindow(evs, 2).map((e) => e.id)).toEqual(['a', 'b']);
        expect(FC.eventsInWindow(evs, 6).map((e) => e.id)).toEqual([
            'a',
            'b',
            'c',
        ]);
        expect(FC.eventsInWindow(evs, null)).toHaveLength(4);
    });
    it('eventsNearIndex groups events by nearest year mark', () => {
        expect(FC.eventsNearIndex(evs, 0).map((e) => e.id)).toEqual(['a']);
        expect(FC.eventsNearIndex(evs, 1).map((e) => e.id)).toEqual(['b']);
        expect(FC.eventsNearIndex(evs, 10).map((e) => e.id)).toEqual(['d']);
    });
    it('describeImpact formats one-time and recurring parts', () => {
        expect(
            FC.describeImpact({}, { lump: -3000, annual: 0, years: 0 }),
        ).toBe('−$3.0K one-time');
        expect(
            FC.describeImpact({}, { lump: -2500, annual: -12000, years: 18 }),
        ).toBe('−$2.5K one-time, −$12K/yr for 18 yrs');
        expect(FC.describeImpact({}, { lump: 0, annual: 5000, years: 1 })).toBe(
            '+$5.0K/yr for 1 yr',
        );
    });
});
