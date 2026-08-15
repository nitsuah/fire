'use strict';

const NHTSA_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';

async function decodeVin(vin) {
    if (!vin || typeof vin !== 'string') {
        throw Object.assign(new Error('VIN is required'), { status: 400 });
    }
    const cleanVin = vin.trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(cleanVin)) {
        throw Object.assign(
            new Error(
                'Invalid VIN format (must be 17 alphanumeric chars, no I/O/Q)',
            ),
            { status: 400 },
        );
    }
    let res;
    try {
        res = await fetch(
            `${NHTSA_BASE}/decodevinvalues/${encodeURIComponent(cleanVin)}?format=json`,
            { signal: AbortSignal.timeout(10000) },
        );
    } catch (e) {
        if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
            throw Object.assign(new Error('NHTSA VIN decode timed out'), {
                status: 504,
            });
        }
        throw Object.assign(
            new Error(`NHTSA VIN decode failed: ${e.message}`),
            { status: 502 },
        );
    }
    if (!res.ok) {
        throw Object.assign(
            new Error(`NHTSA VIN decode failed (${res.status})`),
            { status: 502 },
        );
    }
    const data = await res.json();
    const result = data.Results?.[0];
    if (!result) {
        throw Object.assign(new Error('No NHTSA decode result returned'), {
            status: 502,
        });
    }
    return {
        make: result.Make || null,
        model: result.Model || null,
        year: result.ModelYear ? parseInt(result.ModelYear) : null,
        trim: result.Trim || null,
        bodyStyle: result.BodyClass || null,
        fuelType: result.FuelTypePrimary || null,
        engineSize: result.DisplacementL ? `${result.DisplacementL}L` : null,
        errorCode: result.ErrorCode || '0',
        errorText: result.ErrorText || null,
    };
}

async function estimateVehicleValue(vin, mileage) {
    const apiKey = process.env.VEHICLE_VALUE_API_KEY;
    const provider = (process.env.VEHICLE_VALUE_PROVIDER || '').toLowerCase();

    if (!apiKey) {
        return {
            estimated: false,
            reason: 'VEHICLE_VALUE_API_KEY not set — using manual value',
        };
    }

    const vinInfo = await decodeVin(vin);

    if (provider === 'marketcheck') {
        const params = new URLSearchParams({
            api_key: apiKey,
            vin,
            ...(mileage ? { miles: String(mileage) } : {}),
        });
        let res;
        try {
            res = await fetch(
                `https://mc-api.marketcheck.com/v2/predict/car/condition/rating?${params}`,
                { signal: AbortSignal.timeout(10000) },
            );
        } catch (e) {
            if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
                throw Object.assign(new Error('MarketCheck API timed out'), {
                    status: 504,
                });
            }
            throw Object.assign(
                new Error(`MarketCheck API unreachable: ${e.message}`),
                { status: 502 },
            );
        }
        if (!res.ok) {
            throw Object.assign(
                new Error(`MarketCheck API error (${res.status})`),
                { status: 502 },
            );
        }
        const data = await res.json();
        return {
            estimated: true,
            provider: 'marketcheck',
            value: data.price || null,
            vinInfo,
        };
    }

    throw Object.assign(
        new Error(
            `Unknown vehicle value provider: ${provider || '(none configured)'}`,
        ),
        { status: 502 },
    );
}

module.exports = { decodeVin, estimateVehicleValue };
