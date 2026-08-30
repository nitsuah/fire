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

// Standard automotive depreciation curve (industry consensus):
// Year 1: -20%, Year 2: -15%, Years 3–5: -12%/yr, Years 6–10: -8%/yr, 10+: -5%/yr
// Mileage: deduct 1% per 10k miles above average (12k/yr), cap ±15%.
function estimateDepreciation(vehicleYear, purchasePrice, mileage, condition) {
    if (!purchasePrice || purchasePrice <= 0) return null;
    const parsedYear = parseInt(vehicleYear);
    if (!parsedYear || !Number.isFinite(parsedYear)) return null;
    const currentYear = new Date().getFullYear();
    const age = Math.max(0, currentYear - parsedYear);

    let retention = 1.0;
    for (let y = 0; y < age; y++) {
        if (y === 0) retention *= 0.8;
        else if (y === 1) retention *= 0.85;
        else if (y < 5) retention *= 0.88;
        else if (y < 10) retention *= 0.92;
        else retention *= 0.95;
    }

    // Mileage adjustment vs expected 12k/yr average
    const expectedMiles = age * 12000;
    const excessMiles = (mileage || 0) - expectedMiles;
    const mileageAdj = Math.max(
        -0.15,
        Math.min(0.15, (-excessMiles / 10000) * 0.01),
    );

    // Condition multiplier
    const conditionAdj =
        condition === 'Excellent'
            ? 0.05
            : condition === 'Fair'
              ? -0.05
              : condition === 'Poor'
                ? -0.15
                : 0;

    const base = purchasePrice * retention * (1 + mileageAdj + conditionAdj);
    const low = Math.round(base * 0.88);
    const high = Math.round(base * 1.12);

    return {
        estimated: true,
        value: Math.round(base),
        low,
        high,
        retentionPct: Math.round(retention * 100),
        age,
        source: 'depreciation-model',
        citation: 'Edmunds / iSeeCars average depreciation schedule',
        note: `Standard depreciation for a ${age}-year-old vehicle from $${purchasePrice.toLocaleString()} purchase price. Adjusted for mileage (${(mileage || 0).toLocaleString()} mi vs ${expectedMiles.toLocaleString()} mi expected) and condition (${condition || 'Good'}).`,
    };
}

async function fetchVinAudit(vin, mileage, apiKey) {
    const params = new URLSearchParams({
        key: apiKey,
        vin,
        ...(mileage ? { mileage: String(mileage) } : {}),
        period: '90',
    });
    let res;
    try {
        res = await fetch(
            `https://marketvalue.vinaudit.com/getMarketValue.php?${params}`,
            { signal: AbortSignal.timeout(10000) },
        );
    } catch (e) {
        if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
            throw Object.assign(new Error('VinAudit API timed out'), {
                status: 504,
            });
        }
        throw Object.assign(
            new Error(`VinAudit API unreachable: ${e.message}`),
            { status: 502 },
        );
    }
    if (!res.ok) {
        throw Object.assign(new Error(`VinAudit API error (${res.status})`), {
            status: 502,
        });
    }
    const data = await res.json();
    if (!data.success) {
        throw Object.assign(
            new Error(`VinAudit: ${data.error || 'no market data found'}`),
            { status: 404 },
        );
    }
    // VinAudit free tier nests values under `prices`; fall back to top-level
    const prices = data.prices || data;
    const avg = prices.average ?? prices.avg ?? 0;
    const low = prices.below ?? prices.lower ?? null;
    const high = prices.above ?? prices.upper ?? null;
    const count = data.count ?? prices.count ?? null;
    return {
        estimated: true,
        value: Math.round(avg * 100) / 100,
        low,
        high,
        count,
        source: 'vinaudit',
        citation: 'VinAudit — free tier (100 req/month)',
        note: `Based on ${count ?? '?'} comparable ${vin.slice(0, 3)} listings in the past 90 days. Range: $${(low ?? 0).toLocaleString()} – $${(high ?? 0).toLocaleString()}.`,
    };
}

async function estimateVehicleValue(vehicle) {
    const { vin, mileage, currentValue, purchasePrice, year, condition } =
        vehicle;

    // VINAUDIT_API_KEY is the canonical name; VEHICLE_VALUE_API_KEY kept for compatibility
    const apiKey =
        process.env.VINAUDIT_API_KEY || process.env.VEHICLE_VALUE_API_KEY;
    // Auto-detect vinaudit when key is set; VEHICLE_VALUE_PROVIDER can override
    const provider = (
        process.env.VEHICLE_VALUE_PROVIDER || (apiKey ? 'vinaudit' : '')
    ).toLowerCase();

    // Always compute depreciation estimate when purchasePrice is available
    const depreciation = estimateDepreciation(
        year,
        purchasePrice,
        mileage,
        condition,
    );

    // Attempt market lookup if a supported provider is configured
    let market = null;
    if (apiKey && vin) {
        if (provider === 'vinaudit') {
            try {
                market = await fetchVinAudit(vin, mileage, apiKey);
            } catch (e) {
                market = {
                    estimated: false,
                    source: 'vinaudit',
                    error: e.message,
                };
            }
        } else if (provider) {
            console.warn(
                `[Vehicle] Unknown VEHICLE_VALUE_PROVIDER "${provider}" — only "vinaudit" is supported. Market lookup skipped.`,
            );
        }
    }

    // Suggested value: average of available estimates, bias toward market data
    let suggestedValue = currentValue || 0;
    const estimates = [
        depreciation?.value,
        market?.estimated ? market.value : null,
    ].filter(Number.isFinite);
    if (estimates.length > 0) {
        suggestedValue = Math.round(
            estimates.reduce((a, b) => a + b, 0) / estimates.length,
        );
    }

    // Composite range spanning both estimates
    const lows = [
        depreciation?.low,
        market?.estimated ? market.low : null,
    ].filter(Number.isFinite);
    const highs = [
        depreciation?.high,
        market?.estimated ? market.high : null,
    ].filter(Number.isFinite);

    const [vinInfo] = await Promise.all([
        vin ? decodeVin(vin).catch(() => null) : Promise.resolve(null),
    ]);

    return {
        depreciation,
        market,
        suggestedValue,
        range:
            lows.length && highs.length
                ? { low: Math.min(...lows), high: Math.max(...highs) }
                : null,
        vinInfo,
    };
}

module.exports = { decodeVin, estimateVehicleValue, estimateDepreciation };
