'use strict';

// Scenario sweep behind simulate_rebalance's `chaos` flag. Enumerates single-leg
// moves (sell a liquid asset class or one position, buy a different liquid
// class) at several sizes, then scores each move under bear/base/bull return
// assumptions the caller supplies, net of an estimated capital-gains tax.
//
// It ranks rows by a metric the caller picks. It never labels a row as
// recommended: the output is a table of "if X, then Y under these
// assumptions", and the default returns are placeholders, not forecasts.
// Pure and read-only — nothing is traded or saved.

const {
    ASSET_CLASSES,
    getAllocationAmounts,
    scoreDiversification,
    isSettledCash,
} = require('./aggregates.js');

const LIQUID_CLASSES = ['cash', 'cds', 'equities', 'crypto', 'metals'];
const SCENARIOS = ['bear', 'base', 'bull'];
const DEFAULT_FRACTIONS = [0.1, 0.25, 0.5, 1];

// asc = lower is better for that metric
const RANKABLE = {
    baseDelta: 'desc',
    bearDelta: 'desc',
    bullDelta: 'desc',
    scoreChange: 'desc',
    taxCost: 'asc',
    largestPositionPct: 'asc',
};

// Placeholders so the sweep runs out of the box. Override per class (or per
// symbol under `symbols`) with returns that reflect your own view.
const DEFAULT_RETURNS = {
    bear: {
        cash: 0.03,
        equities: -0.25,
        crypto: -0.5,
        metals: -0.1,
        realEstate: -0.1,
        vehicles: -0.1,
        otherAssets: 0,
    },
    base: {
        cash: 0.03,
        equities: 0.07,
        crypto: 0.1,
        metals: 0.05,
        realEstate: 0.03,
        vehicles: -0.1,
        otherAssets: 0,
    },
    bull: {
        cash: 0.03,
        equities: 0.18,
        crypto: 0.6,
        metals: 0.2,
        realEstate: 0.08,
        vehicles: -0.1,
        otherAssets: 0,
    },
};

const r2 = (n) => Math.round(n * 100) / 100;

function invalid(msg) {
    return new Error(`Invalid input: ${msg}`);
}

function weightedCdRate(cds) {
    let principal = 0;
    let interest = 0;
    for (const cd of cds || []) {
        const p = Number(cd.principal) || 0;
        principal += p;
        interest += p * ((Number(cd.rate) || 0) / 100);
    }
    return principal > 0 ? interest / principal : 0.04;
}

function resolveReturns(state, overrides) {
    const cdRate = weightedCdRate(state.cds);
    const out = { symbols: {} };
    for (const s of SCENARIOS) {
        out[s] = {
            ...DEFAULT_RETURNS[s],
            cds: cdRate,
            ...((overrides && overrides[s]) || {}),
        };
    }
    for (const [sym, per] of Object.entries(
        (overrides && overrides.symbols) || {},
    )) {
        for (const s of SCENARIOS) {
            if (!Number.isFinite(per && per[s])) {
                throw invalid(
                    `returns.symbols.${sym} needs numeric bear, base and bull.`,
                );
            }
        }
        out.symbols[String(sym).toUpperCase()] = per;
    }
    return out;
}

function validateOptions(opts) {
    const fractions = opts.fractions ?? DEFAULT_FRACTIONS;
    if (
        !Array.isArray(fractions) ||
        fractions.length === 0 ||
        fractions.some((f) => !(f > 0 && f <= 1))
    ) {
        throw invalid('fractions must be numbers in (0, 1].');
    }
    const capGainsRatePct = opts.capGainsRatePct ?? 15;
    if (!(capGainsRatePct >= 0 && capGainsRatePct <= 100)) {
        throw invalid('capGainsRatePct must be between 0 and 100.');
    }
    const rankBy = opts.rankBy ?? 'baseDelta';
    if (!RANKABLE[rankBy]) {
        throw invalid(
            `rankBy must be one of ${Object.keys(RANKABLE).join(', ')}.`,
        );
    }
    const limit = opts.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw invalid('limit must be an integer from 1 to 500.');
    }
    return {
        fractions,
        capGainsRatePct,
        rankBy,
        limit,
        minPositionValue: opts.minPositionValue ?? 1000,
        maxPositions: opts.maxPositions ?? 5,
    };
}

// Holdings keyed so a position with its own return override can be valued
// apart from the rest of its asset class.
function buildHoldings(amounts, investable, symbolReturns) {
    const holdings = {};
    let carvedOut = 0;
    for (const p of investable) {
        const sym = String(p.symbol || '').toUpperCase();
        if (symbolReturns[sym]) {
            holdings[`pos:${sym}`] = { value: p.value, symbol: sym };
            carvedOut += p.value;
        }
    }
    for (const k of ASSET_CLASSES) {
        const v = amounts[k] || 0;
        holdings[`class:${k}`] = {
            value: k === 'equities' ? Math.max(0, v - carvedOut) : v,
            cls: k,
        };
    }
    return holdings;
}

function scenarioValue(holdings, returns, scenario) {
    let total = 0;
    for (const h of Object.values(holdings)) {
        const rate = h.symbol
            ? returns.symbols[h.symbol][scenario]
            : returns[scenario][h.cls] || 0;
        total += h.value * (1 + rate);
    }
    return total;
}

function gainRatioFor(p) {
    return p.costBasis != null && p.value > 0
        ? (p.value - p.costBasis) / p.value
        : null;
}

function classGainRatio(cls, investable) {
    if (cls === 'cash' || cls === 'cds') return 0; // basis equals value
    if (cls !== 'equities') return null; // crypto / metals: no basis tracked
    let value = 0;
    let gain = 0;
    for (const p of investable) {
        if (p.costBasis == null) continue;
        value += p.value;
        gain += p.value - p.costBasis;
    }
    return value > 0 ? gain / value : null;
}

function sweepRebalances(state, rawOpts = {}) {
    const opts = validateOptions(rawOpts);
    const returns = resolveReturns(state, rawOpts.returns);
    const amounts = getAllocationAmounts(state);
    const positions = state.importedPositions || [];
    const investable = positions.filter(
        (p) => !isSettledCash(p) && Number(p.value) > 0,
    );

    const baseHoldings = buildHoldings(amounts, investable, returns.symbols);
    const baseDiv = scoreDiversification(amounts, positions);
    if (!baseDiv) {
        return {
            status: 'unavailable',
            reason: 'non_positive_net_worth',
        };
    }
    const hold = Object.fromEntries(
        SCENARIOS.map((s) => [s, scenarioValue(baseHoldings, returns, s)]),
    );

    const sellers = LIQUID_CLASSES.filter((k) => amounts[k] > 0).map((k) => ({
        kind: 'class',
        id: k,
        cls: k,
        value: amounts[k],
        gainRatio: classGainRatio(k, investable),
    }));
    const topPositions = [...investable]
        .filter((p) => p.value >= opts.minPositionValue)
        .sort((a, b) => b.value - a.value)
        .slice(0, opts.maxPositions);
    for (const p of topPositions) {
        sellers.push({
            kind: 'position',
            id: p.symbol,
            cls: 'equities',
            value: p.value,
            gainRatio: gainRatioFor(p),
        });
    }

    const rows = [];
    for (const seller of sellers) {
        for (const bought of LIQUID_CLASSES) {
            if (bought === seller.cls) continue;
            for (const fraction of opts.fractions) {
                const gross = r2(seller.value * fraction);
                const gain =
                    seller.gainRatio == null ? null : gross * seller.gainRatio;
                const taxCost =
                    gain == null
                        ? 0
                        : r2(Math.max(0, gain) * (opts.capGainsRatePct / 100));
                const net = gross - taxCost;

                const afterAmounts = {
                    ...amounts,
                    [seller.cls]: amounts[seller.cls] - gross,
                };
                afterAmounts[bought] += net;
                const afterPositions =
                    seller.kind === 'position'
                        ? positions.map((p) =>
                              p.symbol === seller.id
                                  ? { ...p, value: p.value - gross }
                                  : p,
                          )
                        : positions;

                const holdings = structuredClone(baseHoldings);
                const sellKey =
                    seller.kind === 'position' &&
                    holdings[`pos:${String(seller.id).toUpperCase()}`]
                        ? `pos:${String(seller.id).toUpperCase()}`
                        : `class:${seller.cls}`;
                holdings[sellKey].value -= gross;
                holdings[`class:${bought}`].value += net;

                const div = scoreDiversification(afterAmounts, afterPositions);
                const values = {};
                const deltas = {};
                for (const s of SCENARIOS) {
                    values[s] = r2(scenarioValue(holdings, returns, s));
                    deltas[s] = r2(values[s] - hold[s]);
                }
                rows.push({
                    sold: { kind: seller.kind, id: seller.id },
                    bought,
                    fractionPct: fraction * 100,
                    amount: gross,
                    realizedGain: gain == null ? null : r2(gain),
                    taxBasis: gain == null ? 'unknown' : 'estimated',
                    taxCost,
                    score: div ? div.score : null,
                    scoreChange: div ? div.score - baseDiv.score : null,
                    largestPositionPct: div?.largestPosition
                        ? div.largestPosition.pctOfNetWorth
                        : null,
                    value1y: values,
                    baseDelta: deltas.base,
                    bearDelta: deltas.bear,
                    bullDelta: deltas.bull,
                });
            }
        }
    }

    const dir = RANKABLE[opts.rankBy] === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
        const av = a[opts.rankBy] ?? Infinity * dir;
        const bv = b[opts.rankBy] ?? Infinity * dir;
        return (av - bv) * dir;
    });

    return {
        status: 'swept',
        note: 'Scenario table under the assumptions below. Not a recommendation, and nothing is traded or saved.',
        hold: {
            value1y: Object.fromEntries(SCENARIOS.map((s) => [s, r2(hold[s])])),
            score: baseDiv.score,
            largestPositionPct: baseDiv.largestPosition
                ? baseDiv.largestPosition.pctOfNetWorth
                : null,
        },
        rankedBy: { metric: opts.rankBy, order: RANKABLE[opts.rankBy] },
        totalRows: rows.length,
        rows: rows.slice(0, opts.limit),
        assumptions: {
            horizon: '1 year, deterministic (no path or volatility)',
            returns,
            capGainsRatePct: opts.capGainsRatePct,
            fractions: opts.fractions,
            defaultReturnsArePlaceholders: true,
            notRepresented: [
                'short- vs long-term holding period (one flat rate)',
                'state tax, including a residency change',
                'loss harvesting and netting between lots',
                'CD early-redemption penalties',
                'unpriced positions carry their last imported value',
                'illiquid classes (real estate, vehicles, other) are excluded',
            ],
        },
    };
}

module.exports = { sweepRebalances, RANKABLE, DEFAULT_RETURNS };
