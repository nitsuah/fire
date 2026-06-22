'use strict';

/* ==========================================================================
   finance-core.js — Main entry point; re-exports all sub-modules.
   Split into:
     finance-parsing.js   — CSV parsers (Fidelity, Chase, CapOne)
     finance-calcs.js     — Projection data builders
     finance-platforms.js — eBay / Etsy / Facebook fee calculators
   ========================================================================== */

const parsing = require('./finance-parsing');
const calcs = require('./finance-calcs');
const platforms = require('./finance-platforms');

/* --------------------------------------------------------------------------
   Inline helpers that don't warrant their own sub-module
   -------------------------------------------------------------------------- */

// US median retirement savings by age (Vanguard How America Saves 2023)
const US_MEDIAN_SAVINGS = calcs.US_MEDIAN_SAVINGS;

function formatCurrency(val) {
    const num = Number(val);
    if (isNaN(num)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
    }).format(num);
}

function sanitizeState(data) {
    if (!data) return {};

    data.importedPositions = data.importedPositions || [];
    data.customAccounts = data.customAccounts || [];
    data.cds = data.cds || [];
    data.realEstate = data.realEstate || [];
    data.vehicles = data.vehicles || [];
    data.sideGigLedger = data.sideGigLedger || [];
    data.importedFiles = data.importedFiles || [];

    data.vehicles.forEach((v) => {
        if (!v.year) v.year = new Date().getFullYear();
        if (!v.make) v.make = '';
        if (!v.model) v.model = '';
        if (!v.trim) v.trim = '';
        if (!v.mileage) v.mileage = 0;
        if (!v.condition) v.condition = 'Good';
        if (!v.currentValue) v.currentValue = 0;
        if (!v.purchasePrice) v.purchasePrice = 0;
        if (!v.loanBalance) v.loanBalance = 0;
        if (!v.monthlyPayment) v.monthlyPayment = 0;
        if (!v.notes) v.notes = '';
    });

    data.realEstate.forEach((re) => {
        if (!re.marketValue) re.marketValue = 0;
        if (!re.purchasePrice) re.purchasePrice = 0;
        if (!re.mortgageBalance) re.mortgageBalance = 0;
        if (!re.monthlyPayment) re.monthlyPayment = 0;
        if (!re.type) re.type = 'Primary Home';
        if (!re.address) re.address = '';
        if (!re.notes) re.notes = '';
    });

    data.customAccounts.forEach((acc) => {
        if (acc.apy === undefined || acc.apy === null) acc.apy = 0;
        if (acc.value === undefined || acc.value === null) acc.value = 0;
    });

    data.cds.forEach((cd) => {
        if (cd.startDate === undefined || cd.startDate === null)
            cd.startDate = '';
        if (cd.principal === undefined || cd.principal === null)
            cd.principal = 0;
        if (cd.rate === undefined || cd.rate === null) cd.rate = 0;
    });

    if (data.projectionSettings) {
        if (!data.projectionSettings.currentAge)
            data.projectionSettings.currentAge = 30;
        if (!data.projectionSettings.retireAge)
            data.projectionSettings.retireAge = 60;
    }

    if (!data.insurances)
        data.insurances = {
            car: { amt: 0, freq: '6month' },
            home: { amt: 0, freq: 'monthly' },
        };
    if (!data.insurances.car) data.insurances.car = { amt: 0, freq: '6month' };
    if (!data.insurances.home)
        data.insurances.home = { amt: 0, freq: 'monthly' };

    return data;
}

function computeEffectiveTaxRate(grossIncome, filingState) {
    // 2024 Federal brackets (single filer, simplified)
    const federalBrackets = [
        { limit: 11600, rate: 0.1 },
        { limit: 47150, rate: 0.12 },
        { limit: 100525, rate: 0.22 },
        { limit: 191950, rate: 0.24 },
        { limit: 243725, rate: 0.32 },
        { limit: 609350, rate: 0.35 },
        { limit: Infinity, rate: 0.37 },
    ];

    let federalTax = 0;
    let prev = 0;
    for (const bracket of federalBrackets) {
        if (grossIncome <= prev) break;
        const taxable = Math.min(grossIncome, bracket.limit) - prev;
        federalTax += taxable * bracket.rate;
        prev = bracket.limit;
    }

    const stateTaxRates = {
        TX: 0.0,
        FL: 0.0,
        WA: 0.0,
        NV: 0.0,
        IL: 0.0495,
        CA: grossIncome > 300000 ? 0.113 : grossIncome > 100000 ? 0.093 : 0.073,
        NY: grossIncome > 215400 ? 0.109 : grossIncome > 80650 ? 0.0685 : 0.045,
        Other: 0.04,
    };

    const stateRate =
        stateTaxRates[filingState] !== undefined
            ? stateTaxRates[filingState]
            : 0.04;
    const stateTax = grossIncome * stateRate;
    const ficaTax =
        Math.min(grossIncome, 168600) * 0.062 + grossIncome * 0.0145;

    const totalTax = federalTax + stateTax + ficaTax;
    const effectiveRate = Math.round((totalTax / grossIncome) * 100);
    return Math.min(Math.max(effectiveRate, 0), 50);
}

function insuranceToMonthly(ins) {
    const amt = ins.amt || 0;
    if (ins.freq === '6month') return amt / 6;
    if (ins.freq === 'annual') return amt / 12;
    return amt; // monthly
}

function getInsuranceMonthly(insurances) {
    const ins = insurances || {};
    return (
        insuranceToMonthly(ins.car || {}) + insuranceToMonthly(ins.home || {})
    );
}

function getMonthlyExpensesBase(expenses, insurances) {
    let base = 0;
    Object.keys(expenses).forEach((k) => {
        base += expenses[k] || 0;
    });
    return base + getInsuranceMonthly(insurances);
}

function getAnnualExpensesTotal(expenses, insurances, taxRate) {
    const baseAnnual = getMonthlyExpensesBase(expenses, insurances) * 12;
    const taxDrag = baseAnnual * (taxRate / 100);
    return baseAnnual + taxDrag;
}

function isSettledCash(pos) {
    const sym = (pos.symbol || '').toUpperCase();
    const desc = (pos.description || '').toUpperCase();
    return (
        sym.includes('SPAXX') ||
        sym.includes('FDRXX') ||
        sym.includes('FZSSX') ||
        sym.includes('FZFXX') ||
        sym === '**' ||
        desc.includes('PENDING ACTIVITY') ||
        desc.includes('MONEY MARKET') ||
        desc.includes('CORE POSITION')
    );
}

function getAggregateCash(importedPositions, customAccounts) {
    let sum = 0;
    (importedPositions || []).forEach((pos) => {
        if (
            (pos.symbol || '').includes('SPAXX') ||
            (pos.symbol || '').includes('FDRXX') ||
            (pos.description || '').includes('MONEY MARKET')
        ) {
            sum += pos.value || 0;
        }
    });
    (customAccounts || []).forEach((acc) => {
        if (acc.type === 'Cash' || acc.type === 'Savings')
            sum += acc.value || 0;
    });
    return sum;
}

function getAggregateCDs(cds) {
    return (cds || []).reduce((sum, cd) => sum + (cd.principal || 0), 0);
}

function getAggregateEquities(importedPositions, customAccounts) {
    let sum = 0;
    (importedPositions || []).forEach((pos) => {
        if (
            !(pos.symbol || '').includes('SPAXX') &&
            !(pos.symbol || '').includes('FDRXX') &&
            !(pos.description || '').includes('MONEY MARKET')
        ) {
            sum += pos.value || 0;
        }
    });
    (customAccounts || []).forEach((acc) => {
        if (acc.type === 'Brokerage' || acc.type === 'Crypto')
            sum += acc.value || 0;
    });
    return sum;
}

function getAggregateOtherAssets(customAccounts) {
    return (customAccounts || []).reduce((sum, acc) => {
        if (
            acc.type !== 'Cash' &&
            acc.type !== 'Savings' &&
            acc.type !== 'Brokerage' &&
            acc.type !== 'Crypto'
        ) {
            sum += acc.value || 0;
        }
        return sum;
    }, 0);
}

function getSideGigYTDNet(sideGigLedger) {
    return (sideGigLedger || []).reduce((sum, sg) => sum + (sg.net || 0), 0);
}

function getAggregateRealEstate(realEstate) {
    return (realEstate || []).reduce(
        (sum, re) =>
            sum +
            Math.max(0, (re.marketValue || 0) - (re.mortgageBalance || 0)),
        0,
    );
}

function getAggregateVehicles(vehicles) {
    return (vehicles || []).reduce(
        (sum, v) =>
            sum + Math.max(0, (v.currentValue || 0) - (v.loanBalance || 0)),
        0,
    );
}

function getAggregateNetWorth(state) {
    return (
        getAggregateCash(state.importedPositions, state.customAccounts) +
        getAggregateCDs(state.cds) +
        getAggregateEquities(state.importedPositions, state.customAccounts) +
        getAggregateOtherAssets(state.customAccounts) +
        getAggregateRealEstate(state.realEstate) +
        getAggregateVehicles(state.vehicles) +
        getSideGigYTDNet(state.sideGigLedger)
    );
}

function pnlColorStyle(pnlPct, maxAbsPct) {
    if (maxAbsPct < 0.01 || pnlPct === 0) return 'color: var(--text-muted);';
    const norm = Math.max(-1, Math.min(1, pnlPct / maxAbsPct));
    if (norm > 0) {
        const l = Math.round(65 - norm * 18);
        const s = Math.round(50 + norm * 21);
        return `color: hsl(142,${s}%,${l}%);`;
    }
    const absN = -norm;
    const l = Math.round(65 - absN * 18);
    const s = Math.round(50 + absN * 21);
    return `color: hsl(0,${s}%,${l}%);`;
}

function sortPositions(positions, col, dir) {
    const sortDir = dir === 'asc' ? 1 : -1;
    return [...positions].sort((a, b) => {
        let av, bv;
        switch (col) {
            case 'symbol':
                av = (a.symbol || '').toLowerCase();
                bv = (b.symbol || '').toLowerCase();
                break;
            case 'desc':
                av = (a.description || '').toLowerCase();
                bv = (b.description || '').toLowerCase();
                break;
            case 'qty':
                av = a.quantity || 0;
                bv = b.quantity || 0;
                break;
            case 'price':
                av = a.lastPrice || 0;
                bv = b.lastPrice || 0;
                break;
            case 'cost':
                av = a.costBasis || 0;
                bv = b.costBasis || 0;
                break;
            case 'value':
                av = a.value || 0;
                bv = b.value || 0;
                break;
            default:
                av = a.pnlDollar || 0;
                bv = b.pnlDollar || 0;
        }
        if (av < bv) return -sortDir;
        if (av > bv) return sortDir;
        return 0;
    });
}

/* --------------------------------------------------------------------------
   Re-export everything (sub-modules + inline helpers)
   -------------------------------------------------------------------------- */

module.exports = {
    // from finance-calcs.js
    US_MEDIAN_SAVINGS,
    windowToPoints: calcs.windowToPoints,
    sliceProjectionData: calcs.sliceProjectionData,
    buildProjectionData: calcs.buildProjectionData,

    // from finance-parsing.js
    parseCSVText: parsing.parseCSVText,
    parseFidelityPositions: parsing.parseFidelityPositions,
    parseChaseStatement: parsing.parseChaseStatement,
    parseCapitalOneStatement: parsing.parseCapitalOneStatement,
    CHASE_CATEGORY_MAP: parsing.CHASE_CATEGORY_MAP,
    CAPITALONE_CATEGORY_MAP: parsing.CAPITALONE_CATEGORY_MAP,

    // from finance-platforms.js
    calculateEbayFees: platforms.calculateEbayFees,
    calculateEbayNetProfit: platforms.calculateEbayNetProfit,
    calculateEtsyFees: platforms.calculateEtsyFees,
    calculateEtsyNetProfit: platforms.calculateEtsyNetProfit,
    calculateFBFees: platforms.calculateFBFees,
    calculateFBNetProfit: platforms.calculateFBNetProfit,

    // inline helpers
    formatCurrency,
    sanitizeState,
    computeEffectiveTaxRate,
    insuranceToMonthly,
    getInsuranceMonthly,
    getMonthlyExpensesBase,
    getAnnualExpensesTotal,
    isSettledCash,
    getAggregateCash,
    getAggregateCDs,
    getAggregateEquities,
    getAggregateOtherAssets,
    getSideGigYTDNet,
    getAggregateRealEstate,
    getAggregateVehicles,
    getAggregateNetWorth,
    pnlColorStyle,
    sortPositions,
};
