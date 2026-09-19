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

// Compute annual passive income from yield-bearing accounts (CDs, HYSA).
// This is a current-snapshot figure used for display only — it does not drive
// the projection loop (blended return handles yield in portfolio growth).
// CD income is credited at the current rate regardless of maturity; post-maturity
// reinvestment is not modeled here.
function _getPassiveIncome(state) {
    const cdIncome = (state.cds || []).reduce(
        (s, cd) => s + (cd.principal || 0) * ((cd.rate || 0) / 100),
        0,
    );
    const savingsIncome = (state.customAccounts || [])
        .filter((a) => (a.type === 'Cash' || a.type === 'Savings') && a.apy > 0)
        .reduce((s, a) => s + (a.value || 0) * ((a.apy || 0) / 100), 0);
    return cdIncome + savingsIncome;
}

// Compute blended nominal return weighted by actual asset allocation.
// Must cover the same universe as _getAggregateNetWorth so the blended rate
// is applied to a consistent portfolio value.
// CDs use locked rates, savings use APY, everything else uses equityReturnPct.
// Call separately for each scenario so CD locked rates don't shift with bull/bear.
function _isCashPosition(pos) {
    const sym = pos.symbol || '';
    const desc = pos.description || '';
    return (
        sym.includes('SPAXX') ||
        sym.includes('FDRXX') ||
        desc.includes('MONEY MARKET')
    );
}

function _getBlendedNominalReturn(state, equityReturnPct, excludeCash = false) {
    let weightedIncome = 0;
    let totalValue = 0;

    (state.cds || []).forEach((cd) => {
        const v = cd.principal || 0;
        weightedIncome += v * ((cd.rate || 0) / 100);
        totalValue += v;
    });

    (state.customAccounts || []).forEach((a) => {
        const v = a.value || 0;
        if (excludeCash && (a.type === 'Cash' || a.type === 'Savings')) return;
        if ((a.type === 'Cash' || a.type === 'Savings') && (a.apy || 0) > 0) {
            weightedIncome += v * ((a.apy || 0) / 100);
        } else {
            weightedIncome += v * (equityReturnPct / 100);
        }
        totalValue += v;
    });

    (state.importedPositions || []).forEach((p) => {
        const v = p.value || 0;
        if (excludeCash && _isCashPosition(p)) return;
        weightedIncome += v * (equityReturnPct / 100);
        totalValue += v;
    });

    (state.realEstate || []).forEach((r) => {
        const v = Math.max(0, (r.marketValue || 0) - (r.mortgageBalance || 0));
        weightedIncome += v * (equityReturnPct / 100);
        totalValue += v;
    });

    (state.vehicles || []).forEach((v) => {
        const val = Math.max(0, (v.currentValue || 0) - (v.loanBalance || 0));
        weightedIncome += val * (equityReturnPct / 100);
        totalValue += val;
    });

    const gigBalance = (state.sideGigLedger || []).reduce(
        (s, sg) => s + (sg.net || 0),
        0,
    );
    if (gigBalance > 0) {
        weightedIncome += gigBalance * (equityReturnPct / 100);
        totalValue += gigBalance;
    }

    return totalValue > 0
        ? (weightedIncome / totalValue) * 100
        : equityReturnPct;
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
    Object.keys(expenses).forEach((k) => {
        base += expenses[k] || 0;
    });
    base +=
        insuranceToMonthly(ins.car || {}) + insuranceToMonthly(ins.home || {});
    const baseAnnual = base * 12;
    return baseAnnual + baseAnnual * ((taxRate || 0) / 100);
}

// The "cash-like" slice of net worth: settled cash/money-market positions
// plus Cash/Savings/"other" custom accounts (everything _getAggregateNetWorth
// doesn't classify as equities/CDs/real estate/vehicles/side-gig). Used both
// for the net worth total and, separately, to seed the cash bucket that
// post-retirement withdrawals draw from first (see buildProjectionData).
function _getCashBucket(state) {
    let cash = 0;
    (state.importedPositions || []).forEach((pos) => {
        const sym = pos.symbol || '';
        const desc = pos.description || '';
        if (
            sym.includes('SPAXX') ||
            sym.includes('FDRXX') ||
            desc.includes('MONEY MARKET')
        ) {
            cash += pos.value || 0;
        }
    });
    (state.customAccounts || []).forEach((acc) => {
        if (acc.type === 'Cash' || acc.type === 'Savings') {
            cash += acc.value || 0;
        }
    });
    return cash;
}

function _getAggregateNetWorth(state) {
    const cash = _getCashBucket(state);
    let equities = 0;
    let other = 0;
    (state.importedPositions || []).forEach((pos) => {
        const sym = pos.symbol || '';
        const desc = pos.description || '';
        const isCash =
            sym.includes('SPAXX') ||
            sym.includes('FDRXX') ||
            desc.includes('MONEY MARKET');
        if (!isCash) equities += pos.value || 0;
    });
    (state.customAccounts || []).forEach((acc) => {
        if (acc.type === 'Brokerage' || acc.type === 'Crypto')
            equities += acc.value || 0;
        else if (acc.type !== 'Cash' && acc.type !== 'Savings')
            other += acc.value || 0; // metals, pensions, etc. — not spendable cash
    });
    const cds = (state.cds || []).reduce((s, cd) => s + (cd.principal || 0), 0);
    const re = (state.realEstate || []).reduce(
        (s, r) =>
            s + Math.max(0, (r.marketValue || 0) - (r.mortgageBalance || 0)),
        0,
    );
    const veh = (state.vehicles || []).reduce(
        (s, v) => s + Math.max(0, (v.currentValue || 0) - (v.loanBalance || 0)),
        0,
    );
    const gig = (state.sideGigLedger || []).reduce(
        (s, sg) => s + (sg.net || 0),
        0,
    );
    return cash + equities + other + cds + re + veh + gig;
}

// One retirement year's withdrawal: draws `expense` from `cash` first (cash
// earns no return in this model) and only pulls the remainder from
// `invested` — after `invested` has already grown at `returnRate` for the
// year, same "grow then withdraw" order the pre-cash-first model used.
// Mirrors a real retiree's typical sequencing (spend cash reserves before
// selling invested assets, especially during a downturn) rather than
// treating the whole portfolio as one undifferentiated pool.
function _withdrawCashFirst(cash, invested, returnRate, expense) {
    const totalBefore = cash + invested;
    const cashDrawn = Math.min(cash, expense);
    const remaining = expense - cashDrawn;
    const rawInvested = invested * (1 + returnRate) - remaining;
    const nextCash = cash - cashDrawn;
    return {
        cash: nextCash,
        invested: Math.max(0, rawInvested),
        depletedThisYear: totalBefore > 0 && nextCash + rawInvested <= 0,
    };
}

function buildProjectionData(state, scenarioOffset) {
    const offset = scenarioOffset || 0;
    const expenses = state.expenses || {};
    const insurances = state.insurances || {};
    const taxRate = state.taxRate || 0;
    const networth = _getAggregateNetWorth(state);
    const annualExpenses = _getAnnualExpensesTotal(
        expenses,
        insurances,
        taxRate,
    );
    const swr = (state.projectionSettings.swr || 4.0) / 100;
    const fireNumber = swr > 0 ? annualExpenses / swr : 0;

    const savings = state.projectionSettings.annualSavings || 0;
    const equityReturnPct =
        (state.projectionSettings.expectedReturn || 0) + offset;
    const blendedNominalReturn = _getBlendedNominalReturn(
        state,
        equityReturnPct,
    );
    const bullBlended = _getBlendedNominalReturn(state, equityReturnPct + 2);
    const bearBlended = _getBlendedNominalReturn(
        state,
        Math.max(equityReturnPct - 2, 0),
    );
    const inflation = (state.projectionSettings.inflationRate || 0) / 100;
    const toRealReturn = (nominalPct) =>
        (1 + nominalPct / 100) / (1 + inflation) - 1;
    const realReturn = toRealReturn(blendedNominalReturn);
    // Once cash is split out (cash-first drawdown), the invested bucket must
    // grow at the return of the *non-cash* assets — the blended rate above
    // includes cash APY, which would understate it.
    const investedReturn = toRealReturn(
        _getBlendedNominalReturn(state, equityReturnPct, true),
    );
    const investedBullReturn = toRealReturn(
        _getBlendedNominalReturn(state, equityReturnPct + 2, true),
    );
    const investedBearReturn = Math.max(
        toRealReturn(
            _getBlendedNominalReturn(
                state,
                Math.max(equityReturnPct - 2, 0),
                true,
            ),
        ),
        -0.01,
    );
    const span = state.projectionSettings.spanYears || 30;
    const currentAge = state.projectionSettings.currentAge || 30;
    const retireAge = state.projectionSettings.retireAge || 60;

    const passiveIncome = _getPassiveIncome(state);
    const netWithdrawal = Math.max(0, annualExpenses - passiveIncome);

    const labels = [],
        nwData = [],
        fireLine = [],
        leanFireLine = [],
        fatFireLine = [],
        coastFireLine = [];
    let currentNW = networth;
    let bullNW = networth,
        bearNW = networth;
    const bullReturn = toRealReturn(bullBlended);
    const bearReturn = Math.max(toRealReturn(bearBlended), -0.01);
    const bullData = [],
        bearData = [],
        benchData = [];

    // Cash/invested split, seeded from the real current portfolio
    // composition and carried forward at that fixed fraction through the
    // (unchanged) pre-retirement accumulation phase. Populated the moment
    // each scenario crosses into retirement, below.
    const cashFraction0 =
        networth > 0
            ? Math.min(Math.max(_getCashBucket(state) / networth, 0), 1)
            : 0;
    let cashBase = null,
        investedBase = null;
    let cashBull = null,
        investedBull = null;
    let cashBear = null,
        investedBear = null;

    const coastYears = retireAge - currentAge;
    const coastFireTarget =
        coastYears > 0
            ? fireNumber / Math.pow(1 + Math.max(realReturn, 0.001), coastYears)
            : fireNumber;

    const ageKeys = Object.keys(US_MEDIAN_SAVINGS)
        .map(Number)
        .sort((a, b) => a - b);
    let retirementLineIndex = -1;
    let baseDepletionAge = null;
    let bullDepletionAge = null;
    let bearDepletionAge = null;

    for (let yr = 0; yr <= span; yr++) {
        const age = currentAge + yr;
        const displayBase =
            cashBase !== null ? cashBase + investedBase : currentNW;
        const displayBull =
            cashBull !== null ? cashBull + investedBull : bullNW;
        const displayBear =
            cashBear !== null ? cashBear + investedBear : bearNW;
        labels.push(`Age ${age}`);
        nwData.push(Math.round(displayBase));
        fireLine.push(Math.round(fireNumber));
        leanFireLine.push(Math.round(fireNumber * 0.75));
        fatFireLine.push(Math.round(fireNumber * 1.25));
        coastFireLine.push(Math.round(coastFireTarget));
        bullData.push(Math.round(displayBull));
        bearData.push(Math.round(Math.max(displayBear, 0)));

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
            const isRetired = age >= retireAge;
            if (isRetired) {
                if (cashBase === null) {
                    // First retirement year for this scenario: split
                    // whatever it's accumulated to by the fixed
                    // real-portfolio cash fraction.
                    cashBase = currentNW * cashFraction0;
                    investedBase = currentNW * (1 - cashFraction0);
                    cashBull = bullNW * cashFraction0;
                    investedBull = bullNW * (1 - cashFraction0);
                    cashBear = bearNW * cashFraction0;
                    investedBear = bearNW * (1 - cashFraction0);
                }

                const stepBase = _withdrawCashFirst(
                    cashBase,
                    investedBase,
                    investedReturn,
                    annualExpenses,
                );
                if (stepBase.depletedThisYear && baseDepletionAge === null)
                    baseDepletionAge = age + 1;
                cashBase = stepBase.cash;
                investedBase = stepBase.invested;

                const stepBull = _withdrawCashFirst(
                    cashBull,
                    investedBull,
                    investedBullReturn,
                    annualExpenses,
                );
                if (stepBull.depletedThisYear && bullDepletionAge === null)
                    bullDepletionAge = age + 1;
                cashBull = stepBull.cash;
                investedBull = stepBull.invested;

                const stepBear = _withdrawCashFirst(
                    cashBear,
                    investedBear,
                    investedBearReturn,
                    annualExpenses,
                );
                if (stepBear.depletedThisYear && bearDepletionAge === null)
                    bearDepletionAge = age + 1;
                cashBear = stepBear.cash;
                investedBear = stepBear.invested;
            } else {
                currentNW = currentNW * (1 + realReturn) + savings;
                bullNW = bullNW * (1 + bullReturn) + savings;
                bearNW = bearNW * (1 + bearReturn) + savings;
            }
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
        passiveIncome,
        netWithdrawal,
        blendedReturn: blendedNominalReturn,
        depletionAge: {
            base: baseDepletionAge,
            bull: bullDepletionAge,
            bear: bearDepletionAge,
        },
        // Add metadata for UI
        annualExpenses,
        swr,
        realReturnPct: realReturn * 100,
        portfolioSurvives:
            baseDepletionAge === null || baseDepletionAge > currentAge + span,
    };
}

module.exports = {
    US_MEDIAN_SAVINGS,
    windowToPoints,
    sliceProjectionData,
    buildProjectionData,
};
