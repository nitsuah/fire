import {
    vi,
    describe,
    it,
    expect,
    beforeAll,
    afterEach,
    afterAll,
} from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import express from 'express';
import request from 'supertest';

// Route-level coverage for app/routes/vehicles.js, backing the vehicle
// card's existing "Estimate" / "Refresh Value" flow (fetchVehicleEstimate /
// acceptVehicleEstimate in app/lib/tables/vehicles.js).
const TEST_DB = path.join(
    os.tmpdir(),
    `fire-vehicles-route-test-${process.pid}.json`,
);
process.env.FIRE_DB_FILE = TEST_DB;

const CURRENT_YEAR = new Date().getFullYear();
const BASE_VEHICLE = {
    id: 'veh-1',
    year: CURRENT_YEAR - 1,
    make: 'Honda',
    model: 'Accord',
    mileage: 12000,
    condition: 'Good',
    currentValue: 20000,
    purchasePrice: 25000,
    loanBalance: 0,
    monthlyPayment: 0,
};

function writeDb(vehicles) {
    fs.writeFileSync(
        TEST_DB,
        JSON.stringify({
            importedPositions: [],
            customAccounts: [],
            cds: [],
            vehicles: vehicles || [],
            expenses: {},
            taxRate: 0,
            sideGigLedger: [],
            projectionSettings: {},
            importedFiles: [],
        }),
    );
}

writeDb([BASE_VEHICLE]);

let app;

beforeAll(async () => {
    const vehiclesRouter = (await import('../../app/routes/vehicles.js'))
        .default;
    app = express();
    app.use(express.json());
    app.use('/api/vehicles', vehiclesRouter);
});

afterEach(() => {
    writeDb([BASE_VEHICLE]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

afterAll(() => {
    try {
        fs.unlinkSync(TEST_DB);
    } catch {
        /* ignore */
    }
});

describe('GET /api/vehicles/vin/:vin', () => {
    it('rejects a malformed VIN with 400 before any lookup', async () => {
        const res = await request(app).get('/api/vehicles/vin/short');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/17 alphanumeric/i);
    });

    it('decodes a well-formed VIN', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    Results: [
                        {
                            Make: 'Honda',
                            Model: 'Accord',
                            ModelYear: '2020',
                            ErrorCode: '0',
                        },
                    ],
                }),
            }),
        );
        const res = await request(app).get(
            '/api/vehicles/vin/1HGCM82633A004352',
        );
        expect(res.status).toBe(200);
        expect(res.body.make).toBe('Honda');
    });
});

describe('GET /api/vehicles/:id/estimate', () => {
    it('returns 404 for an unknown vehicle id', async () => {
        const res = await request(app).get(
            '/api/vehicles/does-not-exist/estimate',
        );
        expect(res.status).toBe(404);
    });

    it('returns 400 when the vehicle has neither a purchase price nor a VIN', async () => {
        writeDb([{ ...BASE_VEHICLE, purchasePrice: 0, vin: undefined }]);
        const res = await request(app).get(
            `/api/vehicles/${BASE_VEHICLE.id}/estimate`,
        );
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/purchase price|VIN/i);
    });

    it('returns a depreciation estimate for a vehicle with only a purchase price', async () => {
        const res = await request(app).get(
            `/api/vehicles/${BASE_VEHICLE.id}/estimate`,
        );
        expect(res.status).toBe(200);
        expect(res.body.depreciation).toBeTruthy();
        expect(res.body.market).toBeNull();
        expect(res.body.suggestedValue).toBe(res.body.depreciation.value);
    });
});

describe('POST /api/vehicles/:id/accept-estimate', () => {
    it('rejects a missing request body value', async () => {
        const res = await request(app)
            .post(`/api/vehicles/${BASE_VEHICLE.id}/accept-estimate`)
            .send({});
        expect(res.status).toBe(400);
    });

    it('rejects a negative value', async () => {
        const res = await request(app)
            .post(`/api/vehicles/${BASE_VEHICLE.id}/accept-estimate`)
            .send({ value: -100 });
        expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown vehicle id', async () => {
        const res = await request(app)
            .post('/api/vehicles/does-not-exist/accept-estimate')
            .send({ value: 18000, source: 'depreciation-model' });
        expect(res.status).toBe(404);
    });

    it('accepts a value and records valueLastRefreshed + valueSource', async () => {
        const res = await request(app)
            .post(`/api/vehicles/${BASE_VEHICLE.id}/accept-estimate`)
            .send({ value: 18500, source: 'depreciation-model' });
        expect(res.status).toBe(200);
        expect(res.body.currentValue).toBe(18500);
        expect(res.body.valueSource).toBe('depreciation-model');
        expect(res.body.valueLastRefreshed).toBeTruthy();
        expect(new Date(res.body.valueLastRefreshed).toString()).not.toBe(
            'Invalid Date',
        );
    });

    it('defaults the source to "estimate" when none is given', async () => {
        const res = await request(app)
            .post(`/api/vehicles/${BASE_VEHICLE.id}/accept-estimate`)
            .send({ value: 17000 });
        expect(res.status).toBe(200);
        expect(res.body.valueSource).toBe('estimate');
    });
});
