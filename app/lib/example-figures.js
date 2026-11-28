/* ==========================================================================
   example-figures.js — which shown figures are still the shipped examples
   (#679). Loads as-is under Node (module.exports) and in the browser.
   ========================================================================== */
/* global module, require */
(function (root) {
    'use strict';

    const DEFAULT_GROSS_INCOME = 100000;
    const DEFAULT_EXPENSES = {
        housing: 1500,
        utilities: 250,
        food: 400,
        transport: 300,
        healthcare: 150,
        discretionary: 500,
    };

    const projectionDefaults = () =>
        (typeof module !== 'undefined' && module.exports
            ? require('./quick-start-facts.js')
            : root.FireQuickStartFacts
        ).DEFAULT_PROJECTION;

    // Returns the groups still at their example values. Editing any one value
    // in a group, or confirming the figures, clears it.
    function exampleFigures(state) {
        const s = state || {};
        if (s.assumptionsConfirmed === true) return [];
        const groups = [];
        if (s.taxGrossIncome === DEFAULT_GROSS_INCOME) groups.push('income');
        const expenses = s.expenses || {};
        const insurances = s.insurances || {};
        if (
            Object.keys(DEFAULT_EXPENSES).every(
                (k) => expenses[k] === DEFAULT_EXPENSES[k],
            ) &&
            !insurances.car?.amt &&
            !insurances.home?.amt
        )
            groups.push('spending');
        const projection = s.projectionSettings || {};
        const defaults = projectionDefaults();
        if (
            Object.keys(defaults).every(
                (k) =>
                    projection[k] === undefined ||
                    projection[k] === defaults[k],
            )
        )
            groups.push('growth assumptions');
        return groups;
    }

    const api = { DEFAULT_GROSS_INCOME, DEFAULT_EXPENSES, exampleFigures };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.FireExampleFigures = api;
})(globalThis);
