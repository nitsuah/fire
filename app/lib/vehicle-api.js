'use strict';

const NHTSA_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';

async function decodeVin(vin) {
    if (!vin || typeof vin !== 'string') throw new Error('VIN is required');
    const cleanVin = vin.trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(cleanVin)) {
        throw new Error('Invalid VIN format (must be 17 alphanumeric chars, no I/O/Q)');
    }
    const res = await fetch(
        `${NHTSA_BASE}/decodevinvalues/${encodeURIComponent(cleanVin)}?format=json`,
        { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) throw new Error(`NHTSA VIN decode failed (${res.status})`);
    const data = await res.json();
    const result = data.Results?.[0];
    if (!result) throw new Error('No NHTSA decode result returned');
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
        return { estimated: false, reason: 'VEHICLE_VALUE_API_KEY not set — using manual value' };
    }

    const vinInfo = await decodeVin(vin);

    if (provider === 'marketcheck') {
        const params = new URLSearchParams({
            api_key: apiKey,
            vin,
            ...(mileage ? { miles: String(mileage) } : {}),
        });
        try {
            const res = await fetch(
                `https://mc-api.marketcheck.com/v2/predict/car/condition/rating?${params}`,
                { signal: AbortSignal.timeout(10000) },
            );
            if (!res.ok) throw new Error(`MarketCheck API error (${res.status})`);
            const data = await res.json();
            return {
                estimated: true,
                provider: 'marketcheck',
                value: data.price || null,
                vinInfo,
            };
        } catch (e) {
            return { estimated: false, reason: e.message, vinInfo };
        }
    }

    return { estimated: false, reason: `Unknown provider: ${provider}`, vinInfo };
}

module.exports = { decodeVin, estimateVehicleValue };
