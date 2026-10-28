import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

process.env.FIRE_DB_FILE = path.join(
    os.tmpdir(),
    `fire-mcp-parity-test-${process.pid}.json`,
);

const require = createRequire(import.meta.url);
const SEED = require('../../promo/demo-seed.js');
const { PRICES } = require('../../promo/demo-mocks.js');
const { applyLiveValues } = require('../../app/lib/live-values.js');
const { fireStatus } = require('../../app/lib/aggregates.js');

let handleTool;
beforeAll(async () => {
    ({ handleTool } = await import('../../app/mcp-server.mjs'));
}, 60000);

describe('fire_status_summary matches the dashboard on the demo seed', () => {
    it('reports the dashboard banner numbers', () => {
        // The dashboard applies the mocked live quotes (prices + metals payout)
        // before rendering; the stored seed must already agree with them.
        const live = structuredClone(SEED);
        const now = new Date().toISOString();
        applyLiveValues(live, {
            positions: live.importedPositions
                .filter((p) => PRICES[p.symbol])
                .map((p) => ({
                    id: p.id,
                    lastPrice: PRICES[p.symbol] + 0.01,
                    priceUpdatedAt: now,
                })),
            metals: [
                {
                    id: 'gold',
                    spotPricePerOz: 3800,
                    payoutPct: 0.95,
                    valueLastRefreshed: now,
                },
            ],
        });
        const dash = fireStatus(SEED);
        expect(
            live.customAccounts.find((a) => a.id === 'gold').value,
        ).toBeCloseTo(SEED.customAccounts.find((a) => a.id === 'gold').value);

        const r = handleTool('fire_status_summary', SEED);
        expect(r.currentNetWorth).toBe(Math.round(dash.networth));
        expect(r.fireNumber).toBe(Math.round(dash.fireNumber));
        expect(r.progressPercent).toBe(
            Math.round(dash.progressPercent * 10) / 10,
        );
        expect(r.yearsToFire).toBe(dash.yearsToFire);
    });
});
