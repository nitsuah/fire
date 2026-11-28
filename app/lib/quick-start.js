/* global module */
(function (root) {
    'use strict';

    const STEPS = [
        {
            id: 'privacy',
            title: 'Understand where your data is stored',
            optional: false,
            tab: null,
        },
        {
            id: 'accounts',
            title: 'Add or import your accounts',
            optional: false,
            tab: 'financial',
            target: 'qs-add-assets',
        },
        {
            id: 'profile',
            title: 'Set your retirement assumptions',
            optional: false,
            tab: 'projections',
            target: 'proj-settings-card',
        },
        {
            id: 'providers',
            title: 'Connect a supported provider',
            optional: true,
            tab: 'settings',
            target: 'qs-connect-provider',
        },
        {
            id: 'backup',
            title: 'Set up a backup: download a JSON copy',
            optional: true,
            tab: 'settings',
            target: 'btn-export-json',
        },
        {
            id: 'explore',
            title: 'Try Chaos Mode on your projections',
            optional: true,
            tab: 'projections',
            target: 'proj-chaos-btn',
        },
    ];

    function quickStartProgress(facts) {
        const f = facts || {};
        const steps = STEPS.map((step) => ({
            ...step,
            done: f[step.id] === true,
        }));
        return {
            steps,
            doneCount: steps.filter((step) => step.done).length,
            total: steps.length,
            requiredDone: steps
                .filter((step) => !step.optional)
                .every((step) => step.done),
        };
    }

    const api = { STEPS, quickStartProgress };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.FireQuickStart = api;
})(globalThis);
