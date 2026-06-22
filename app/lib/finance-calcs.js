'use strict';

/* ==========================================================================
   finance-calcs.js — Projection data builders and window-slice helpers
   CommonJS module — require()'d by finance-core.js
   ========================================================================== */

// US median retirement savings by age (Vanguard How America Saves 2023)
// Duplicated here so this module is self-contained; finance-core re-exports it.
const US_MEDIAN_SAVINGS = {
    20: 8000,
    25: 19000,
    30: 45000,
    35: 97000,
    40: 130000,
    45: 160000,
    50: 200000,
    55: 250000,
    60: 330000,
    65: 400000,
    70: 420000,
};

function windowToPoints(windowKey) {
    switch (windowKey) {
        case '1m':
            return 2;
        case '1y':
            return 2;
        case '5y':
            return 6;
        case '10y':
            return 11;
        case '15y':
            return 16;
        default:
            return null;
    }
}

function sliceProjectionData(data, windowKey) {
    const n = windowToPoints(windowKey);
    if (!n) return data;
    return {
        ...data,
        labels: data.labels.slice(0, n),
        nwData: data.nwData.slice(0, n),
        fireLine: data.fireLine.slice(0, n),
        leanFireLine: data.leanFireLine.slice(0, n),
        fatFireLine: data.fatFireLine.slice(0, n),
        coastFireLine: data.coastFireLine.slice(0, n),
        bullData: data.bullData ? data.bullData.slice(0, n) : [],
        bearData: data.bearData ? data.bearData.slice(0, n) : [],
        benchData: data.benchData ? data.benchData.slice(0, n) : [],
        retirementLineIndex:
            data.retirementLineIndex < n ? data.retirementLineIndex : -1,
        cdEvents: (data.cdEvents || []).filter((e) => e.yearIndex < n),
    };
}

// These aggregate helpers are needed by buildProjectionData.
// They are also exported from finance-core.js directly; we inline them here
// to keep this module dependency-free (no cross-require between sub-modules).

function _getAnnualExpensesTotal(expenses, insurances, taxRate) {
    const ins = insurances || {};
    const insuranceToMonthly = (i) => {
        const amt = i.amt || 0;
        if (i.freq === '6month') return amt / 6;
        if (i.freq === 'annual') return amt / 12;
        return amt;
    };
    let base = 0;
    Object.keys(expenses).forEach((k) => { base += expenses[k] || 0; });
    base += insuranceToMonthly(ins.car || {}) + insuranceToMonthly(ins.home || {});
    const baseAnnual = base * 12;
    return baseAnnual + baseAnnual * ((taxRate || 0) / 100);
}

function _getAggregateNetWorth(state) {
    let cash = 0, equities = 0;
    (state.importedPositions || []).forEach((pos) => {
        const sym = (pos.symbol || '');
        const desc = (pos.description || '');
        if (sym.includes('SPAXX') || sym.includes('FDRXX') || desc.includes('MONEY MARKET')) {
            cash += pos.value || 0;
        } else {
            equities += pos.value || 0;
        }
    });
    (state.customAccounts || []).forEach((acc) => {
        if (acc.type === 'Cash' || acc.type === 'Savings') cash += acc.value || 0;
        else if (acc.type === 'Brokerage' || acc.type === 'Crypto') equities += acc.value || 0;
        else cash += acc.value || 0; // other assets
    });
    const cds = (state.cds || []).reduce((s, cd) => s + (cd.principal || 0), 0);
    const re = (state.realEstate || []).reduce((s, r) =>
        s + Math.max(0, (r.marketValue || 0) - (r.mortgageBalance || 0)), 0);
    const veh = (state.vehicles || []).reduce((s, v) =>
        s + Math.max(0, (v.currentValue || 0) - (v.loanBalance || 0)), 0);
    const gig = (state.sideGigLedger || []).reduce((s, sg) => s + (sg.net || 0), 0);
    return cash + equities + cds + re + veh + gig;
}

function buildProjectionData(state, scenarioOffset) {
    const offset = scenarioOffset || 0;
    const expenses = state.expenses || {};
    const insurances = state.insurances || {};
    const taxRate = state.taxRate || 0;
    const networth = _getAggregateNetWorth(state);
    const annualExpenses = _getAnnualExpensesTotal(expenses, insurances, taxRate);
    const swr = (state.projectionSettings.swr || 4.0) / 100;
    const fireNumber = swr > 0 ? annualExpenses / swr : 0;

    const savings = state.projectionSettings.annualSavings || 0;
    const nominalReturn =
        ((state.projectionSettings.expectedReturn || 0) + offset) / 100;
    const inflation = (state.projectionSettings.inflationRate || 0) / 100;
    const realReturn = nominalReturn - inflation;
    const span = state.projectionSettings.spanYears || 30;
    const currentAge = state.projectionSettings.currentAge || 30;
    const retireAge = state.projectionSettings.retireAge || 60;

    const labels = [],
        nwData = [],
        fireLine = [],
        leanFireLine = [],
        fatFireLine = [],
        coastFireLine = [];
    let currentNW = networth;
    let bullNW = networth,
        bearNW = networth;
    const bullReturn = realReturn + 0.02;
    const bearReturn = Math.max(realReturn - 0.02, -0.01);
    const bullData = [],
        bearData = [],
        benchData = [];

    const coastYears = retireAge - currentAge;
    const coastFireTarget =
        coastYears > 0
            ? fireNumber / Math.pow(1 + Math.max(realReturn, 0.001), coastYears)
            : fireNumber;

    const ageKeys = Object.keys(US_MEDIAN_SAVINGS)
        .map(Number)
        .sort((a, b) => a - b);
    let retirementLineIndex = -1;

    for (let yr = 0; yr <= span; yr++) {
        const age = currentAge + yr;
        labels.push(`Age ${age}`);
        nwData.push(Math.round(currentNW));
        fireLine.push(Math.round(fireNumber));
        leanFireLine.push(Math.round(fireNumber * 0.75));
        fatFireLine.push(Math.round(fireNumber * 1.25));
        coastFireLine.push(Math.round(coastFireTarget));
        bullData.push(Math.round(bullNW));
        bearData.push(Math.round(Math.max(bearNW, 0)));

        const lower =
            [...ageKeys].reverse().find((a) => a <= age) || ageKeys[0];
        const upper =
            ageKeys.find((a) => a > age) || ageKeys[ageKeys.length - 1];
        const t = lower === upper ? 0 : (age - lower) / (upper - lower);
        benchData.push(
            Math.round(
                US_MEDIAN_SAVINGS[lower] * (1 - t) +
                    US_MEDIAN_SAVINGS[upper] * t,
            ),
        );

        if (age === retireAge) retirementLineIndex = yr;

        if (yr < span) {
            currentNW = currentNW * (1 + realReturn) + savings;
            bullNW = bullNW * (1 + bullReturn) + savings;
            bearNW = bearNW * (1 + bearReturn) + savings;
        }
    }

    const cdEvents = (state.cds || [])
        .map((cd) => {
            const matDate = new Date(cd.maturity);
            const today = new Date();
            const yearsUntilMaturity =
                (matDate - today) / (365.25 * 24 * 60 * 60 * 1000);
            const yearIndex = Math.round(yearsUntilMaturity);
            if (yearIndex >= 0 && yearIndex <= span) {
                return {
                    yearIndex,
                    label: `${cd.bank} CD Matures`,
                    amount: cd.principal,
                };
            }
            return null;
        })
        .filter(Boolean);

    return {
        labels,
        nwData,
        fireLine,
        leanFireLine,
        fatFireLine,
        coastFireLine,
        bullData,
        bearData,
        benchData,
        fireNumber,
        retirementLineIndex,
        cdEvents,
        realReturn,
        savings,
        networth,
    };
}

module.exports = {
    US_MEDIAN_SAVINGS,
    windowToPoints,
    sliceProjectionData,
    buildProjectionData,
};
