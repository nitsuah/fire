'use strict';

// US median retirement savings by age (Vanguard How America Saves 2023)
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

function parseCSVText(text) {
    const lines = [];
    let row = [''];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i + 1];
        if (c === '"') {
            if (inQuotes && next === '"') {
                row[row.length - 1] += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === ',' && !inQuotes) {
            row.push('');
        } else if ((c === '\r' || c === '\n') && !inQuotes) {
            if (c === '\r' && next === '\n') {
                i++;
            }
            lines.push(row);
            row = [''];
        } else {
            row[row.length - 1] += c;
        }
    }
    if (row.length > 1 || row[0] !== '') {
        lines.push(row);
    }
    return lines;
}

function parseFidelityPositions(rows) {
    const headers = rows[0].map((h) => h.trim());

    const idxAccountName = headers.findIndex(
        (h) => h.toLowerCase() === 'account name',
    );
    const idxSymbol = headers.findIndex((h) => h.toLowerCase() === 'symbol');
    const idxDescription = headers.findIndex(
        (h) => h.toLowerCase() === 'description',
    );
    const idxQuantity = headers.findIndex(
        (h) => h.toLowerCase() === 'quantity',
    );
    const idxLastPrice = headers.findIndex(
        (h) => h.toLowerCase() === 'last price',
    );
    const idxCurrentValue = headers.findIndex(
        (h) => h.toLowerCase() === 'current value',
    );
    const idxCostBasis = headers.findIndex(
        (h) => h.toLowerCase() === 'cost basis total',
    );
    const idxGainLossDollar = headers.findIndex(
        (h) =>
            h.toLowerCase().includes('gain/loss dollar') &&
            !h.toLowerCase().includes('today'),
    );
    const idxGainLossPercent = headers.findIndex(
        (h) =>
            h.toLowerCase().includes('gain/loss percent') &&
            !h.toLowerCase().includes('today'),
    );

    if (idxSymbol === -1 || idxCurrentValue === -1)
        return { positions: [], count: 0 };

    let importedCount = 0;
    const positions = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 2) continue;

        const sym = (row[idxSymbol] || '').trim();
        const rawVal = (row[idxCurrentValue] || '').trim();

        if (!sym || (sym.includes('*') && rawVal === '')) continue;
        if (
            row[0] &&
            (row[0].toLowerCase().includes('the data') ||
                row[0].toLowerCase().includes('brokerage services'))
        ) {
            break;
        }

        const cleanedValue = parseFloat(rawVal.replace(/[^0-9.-]/g, ''));
        const qty = parseFloat(
            (row[idxQuantity] || '0').replace(/[^0-9.-]/g, ''),
        );
        const price = parseFloat(
            (row[idxLastPrice] || '0').replace(/[^0-9.-]/g, ''),
        );
        const basis = parseFloat(
            (row[idxCostBasis] || '0').replace(/[^0-9.-]/g, ''),
        );

        const rawGainDollar = row[idxGainLossDollar] || '';
        const rawGainPercent = row[idxGainLossPercent] || '';
        const gainDollar =
            parseFloat(rawGainDollar.replace(/[^0-9.-]/g, '')) || 0;
        const gainPercent =
            parseFloat(rawGainPercent.replace(/[^0-9.-]/g, '')) || 0;

        if (isNaN(cleanedValue)) continue;

        const cleanBasis = isNaN(basis) ? 0 : basis;
        const finalGainDollar =
            gainDollar || (cleanBasis > 0 ? cleanedValue - cleanBasis : 0);
        const finalGainPercent =
            gainPercent ||
            (cleanBasis > 0
                ? ((cleanedValue - cleanBasis) / cleanBasis) * 100
                : 0);

        positions.push({
            account: row[idxAccountName] || 'Brokerage',
            symbol: sym,
            description: row[idxDescription] || '',
            quantity: isNaN(qty) ? 0 : qty,
            lastPrice: isNaN(price) ? 0 : price,
            value: cleanedValue,
            costBasis: cleanBasis,
            pnlDollar: finalGainDollar,
            pnlPercent: finalGainPercent,
        });
        importedCount++;
    }

    return { positions, count: importedCount };
}

function parseChaseStatement(rows) {
    let imported = 0;
    let totalOutflow = 0;

    rows.forEach((row, i) => {
        if (i === 0) return;
        if (row.length < 6) return;
        const amount = parseFloat(row[5]);
        if (!isNaN(amount) && amount < 0) {
            totalOutflow += Math.abs(amount);
            imported++;
        }
    });

    return { imported, totalOutflow };
}

function parseCapitalOneStatement(rows) {
    let imported = 0;
    let totalOutflow = 0;

    const headers = rows[0].map((h) => h.trim().toLowerCase());
    const idxDebit = headers.indexOf('debit');

    if (idxDebit === -1) return { imported: 0, totalOutflow: 0 };

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length <= idxDebit) continue;
        const debit = parseFloat(row[idxDebit]);
        if (!isNaN(debit) && debit > 0) {
            totalOutflow += debit;
            imported++;
        }
    }

    return { imported, totalOutflow };
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

function buildProjectionData(state, scenarioOffset) {
    const offset = scenarioOffset || 0;
    const expenses = state.expenses || {};
    const insurances = state.insurances || {};
    const taxRate = state.taxRate || 0;
    const networth = getAggregateNetWorth(state);
    const annualExpenses = getAnnualExpensesTotal(
        expenses,
        insurances,
        taxRate,
    );
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

function calculateEbayFees(price, shippingCharged, categoryRate, adRate) {
    const totalTransactionVal = (price || 0) + (shippingCharged || 0);
    const standardFee = totalTransactionVal * ((categoryRate || 0) / 100) + 0.3;
    const adFee = totalTransactionVal * ((adRate || 0) / 100);
    return standardFee + adFee;
}

function calculateEbayNetProfit(
    price,
    cost,
    shippingCharged,
    shippingActual,
    categoryRate,
    adRate,
) {
    const gross = (price || 0) + (shippingCharged || 0);
    const fees = calculateEbayFees(
        price,
        shippingCharged,
        categoryRate,
        adRate,
    );
    return gross - fees - (shippingActual || 0) - (cost || 0);
}

module.exports = {
    US_MEDIAN_SAVINGS,
    formatCurrency,
    sanitizeState,
    parseCSVText,
    parseFidelityPositions,
    parseChaseStatement,
    parseCapitalOneStatement,
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
    windowToPoints,
    sliceProjectionData,
    buildProjectionData,
    pnlColorStyle,
    sortPositions,
    calculateEbayFees,
    calculateEbayNetProfit,
};
