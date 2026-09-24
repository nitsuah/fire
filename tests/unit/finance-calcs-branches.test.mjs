import { describe, it, expect } from 'vitest';
import {
    windowToPoints,
    sliceProjectionData,
    buildProjectionData,
} from '../../app/lib/finance-calcs.js';

// Branch coverage for window mapping, optional projection series, and the
// `|| 0` fallbacks used when accounts arrive with missing fields.

const makeSeries = (n) => Array.from({ length: n }, (_, i) => i);
const makeData = (overrides = {}) => ({
    labels: makeSeries(20).map((i) => `Y${i}`),
    nwData: makeSeries(20),
    fireLine: makeSeries(20),
    leanFireLine: makeSeries(20),
    fatFireLine: makeSeries(20),
    coastFireLine: makeSeries(20),
    bullData: makeSeries(20),
    bearData: makeSeries(20),
    benchData: makeSeries(20),
    retirementLineIndex: 3,
    cdEvents: [{ yearIndex: 0 }, { yearIndex: 12 }],
    ...overrides,
});

describe('windowToPoints', () => {
    it.each([
        ['1m', 2],
        ['1y', 2],
        ['5y', 6],
        ['10y', 11],
        ['15y', 16],
    ])('maps %s to %i points', (key, points) => {
        expect(windowToPoints(key)).toBe(points);
    });

    it('returns null for an unknown window (i.e. "all")', () => {
        expect(windowToPoints('all')).toBeNull();
    });
});

describe('sliceProjectionData — windows and optional series', () => {
    it('slices bull/bear/bench series when present', () => {
        const out = sliceProjectionData(makeData(), '10y');
        expect(out.labels).toHaveLength(11);
        expect(out.bullData).toHaveLength(11);
        expect(out.bearData).toHaveLength(11);
        expect(out.benchData).toHaveLength(11);
    });

    it('keeps retirementLineIndex inside the window and drops it outside', () => {
        expect(sliceProjectionData(makeData(), '15y').retirementLineIndex).toBe(
            3,
        );
        expect(sliceProjectionData(makeData(), '1y').retirementLineIndex).toBe(
            -1,
        );
    });

    it('filters CD events to the window and tolerates missing cdEvents', () => {
        expect(sliceProjectionData(makeData(), '10y').cdEvents).toEqual([
            { yearIndex: 0 },
        ]);
        expect(
            sliceProjectionData(makeData({ cdEvents: undefined }), '1m')
                .cdEvents,
        ).toEqual([]);
    });

    it('returns data unchanged for an unknown window', () => {
        const data = makeData();
        expect(sliceProjectionData(data, 'all')).toBe(data);
    });
});

describe('buildProjectionData — sparse account fields fall back to 0', () => {
    const sparseState = {
        projectionSettings: {},
        cds: [{}],
        customAccounts: [{ type: 'Savings' }, { type: 'Cash', apy: 0 }, {}],
        importedPositions: [{}],
        realEstate: [{}],
        vehicles: [{}],
        sideGigLedger: [{}],
    };

    it('does not throw and produces finite numbers', () => {
        const data = buildProjectionData(sparseState, 0);
        expect(Number.isFinite(data.networth)).toBe(true);
        expect(data.networth).toBe(0);
        expect(data.nwData.every(Number.isFinite)).toBe(true);
    });

    it('treats a missing scenario offset as 0', () => {
        expect(buildProjectionData(sparseState).networth).toBe(
            buildProjectionData(sparseState, 0).networth,
        );
    });
});
