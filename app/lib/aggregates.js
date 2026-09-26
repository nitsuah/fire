/* ==========================================================================
   aggregates.js — Net-worth, interest and expense aggregates: the ONE copy
   shared by the browser (window.FireAggregates, wrapped by the global
   helpers in app.js) and Node (finance-core.js re-exports it for the
   server, MCP server and tests). Pure functions of their arguments — no
   globals, no requires — so both runtimes can load this file as-is.
   ========================================================================== */
/* global module */

(function (root) {
    'use strict';

    function insuranceToMonthly(ins) {
        const amt = ins.amt || 0;
        if (ins.freq === '6month') return amt / 6;
        if (ins.freq === 'annual') return amt / 12;
        return amt; // monthly
    }

    function getInsuranceMonthly(insurances) {
        const ins = insurances || {};
        return (
            insuranceToMonthly(ins.car || {}) +
            insuranceToMonthly(ins.home || {})
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

    // A CD past its maturity date no longer earns its contract rate (the
    // money typically sits at a much lower rate until it's rolled over).
    // Date-only strings are parsed as local time, matching the dashboard.
    function isCdMatured(cd, now = new Date()) {
        if (!cd || typeof cd.maturity !== 'string' || !cd.maturity)
            return false;
        const mat = new Date(cd.maturity.replace(/-/g, '/'));
        if (Number.isNaN(mat.getTime())) return false;
        const today = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
        );
        return mat < today;
    }

    // Estimated yearly interest/yield: HYSA/cash accounts with an APY
    // (open-ended, so simply balance × APY), active (unmatured) CDs (principal
    // × rate) and crypto staking/lending (balance × APY). Returns
    // { savings, cds, staking, total } in dollars per year.
    function getEstimatedAnnualInterest(customAccounts, cds, now = new Date()) {
        const savings = (customAccounts || []).reduce(
            (sum, acc) =>
                (acc.type === 'Savings' || acc.type === 'Cash') &&
                (acc.apy || 0) > 0
                    ? sum + (acc.value || 0) * (acc.apy / 100)
                    : sum,
            0,
        );
        const cdInterest = (cds || []).reduce(
            (sum, cd) =>
                isCdMatured(cd, now)
                    ? sum
                    : sum + (cd.principal || 0) * ((cd.rate || 0) / 100),
            0,
        );
        const staking = (customAccounts || []).reduce(
            (sum, acc) =>
                acc.type === 'Crypto' && (acc.apy || 0) > 0
                    ? sum + (acc.value || 0) * (acc.apy / 100)
                    : sum,
            0,
        );
        return {
            savings,
            cds: cdInterest,
            staking,
            total: savings + cdInterest + staking,
        };
    }

    function getSideGigYTDNet(sideGigLedger) {
        return (sideGigLedger || []).reduce(
            (sum, sg) => sum + (sg.net || 0),
            0,
        );
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
            getAggregateEquities(
                state.importedPositions,
                state.customAccounts,
            ) +
            getAggregateOtherAssets(state.customAccounts) +
            getAggregateRealEstate(state.realEstate) +
            getAggregateVehicles(state.vehicles)
        );
    }

    const api = {
        insuranceToMonthly,
        getInsuranceMonthly,
        getMonthlyExpensesBase,
        getAnnualExpensesTotal,
        isSettledCash,
        getAggregateCash,
        getAggregateCDs,
        getAggregateEquities,
        getAggregateOtherAssets,
        isCdMatured,
        getEstimatedAnnualInterest,
        getSideGigYTDNet,
        getAggregateRealEstate,
        getAggregateVehicles,
        getAggregateNetWorth,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.FireAggregates = api;
})(globalThis);
