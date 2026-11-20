/* global module */
(function (root) {
    'use strict';

    const DEFAULT_PROJECTION = {
        annualSavings: 25000,
        expectedReturn: 8,
        inflationRate: 2.5,
        swr: 4,
        spanYears: 30,
        currentAge: 30,
        retireAge: 60,
    };

    function buildQuickStartFacts(input) {
        const i = input || {};
        const s = i.state || {};
        const p = s.projectionSettings || {};
        return {
            privacy: i.privacyAccepted === true,
            accounts: [s.customAccounts, s.importedPositions].some(
                (a) => Array.isArray(a) && a.length > 0,
            ),
            profile: Object.keys(DEFAULT_PROJECTION).some(
                (k) => Number.isFinite(p[k]) && p[k] !== DEFAULT_PROJECTION[k],
            ),
            providers:
                Array.isArray(i.providerStatuses) &&
                i.providerStatuses.some((x) => x && x.connected === true),
            backup: !!i.driveStatus && i.driveStatus.authorized === true,
            explore: !!i.chaos && Number.isInteger(i.chaos.seed) && i.chaos.seed > 0,
        };
    }

    const api = { DEFAULT_PROJECTION, buildQuickStartFacts };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.FireQuickStartFacts = api;
})(globalThis);