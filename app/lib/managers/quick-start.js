/* ==========================================================================
   managers/quick-start.js — Quick Start card controller (#444)
   ========================================================================== */
(function (root) {
    'use strict';

    const CONSENT_KEY = 'fire_privacy_v1_accepted';
    const DISMISS_KEY = 'fire_quick_start_dismissed';

    function readKey(key) {
        try {
            return root.localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    async function loadFacts() {
        let hosted = null;
        try {
            hosted = root.FireDeployMode
                ? await root.FireDeployMode.whenKnown()
                : null;
        } catch {
            /* unknown deployment mode: preserve existing provider checks */
        }

        const providerEndpoints = [
            '/api/sync/ebay/status',
            '/api/sync/etsy/status',
            '/api/sync/plaid/status',
            '/api/sync/cointracker/status',
            ...(hosted === true ? [] : ['/api/sync/stripe/status']),
        ];

        const driveEndpoint = '/api/backup/drive/status';

        async function fetchJson(url) {
            try {
                const res = await root.fetch(url, { cache: 'no-store' });
                if (!res.ok) return null;
                return await res.json();
            } catch {
                return null;
            }
        }

        const providerResults = await Promise.allSettled(
            providerEndpoints.map(fetchJson),
        );
        const driveResult = await fetchJson(driveEndpoint);

        const providerStatuses = providerResults
            .filter((r) => r.status === 'fulfilled')
            .map((r) => r.value);

        const driveStatus =
            driveResult && typeof driveResult === 'object' ? driveResult : null;

        const privacyAccepted = !!readKey(CONSENT_KEY);

        let chaos = null;
        try {
            const raw = readKey('fire_chaos_mode');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.seed === 'number') {
                    chaos = { seed: parsed.seed };
                }
            }
        } catch {
            /* ignore parse errors */
        }

        const state = root.state || {};

        if (
            root.FireQuickStartFacts &&
            root.FireQuickStartFacts.buildQuickStartFacts
        ) {
            return root.FireQuickStartFacts.buildQuickStartFacts({
                privacyAccepted,
                state,
                providerStatuses,
                driveStatus,
                chaos,
            });
        }
        return {
            privacy: privacyAccepted,
            accounts: false,
            profile: false,
            providers: false,
            backup: false,
            explore: false,
        };
    }

    function initQuickStart() {
        const doc = root.document;
        const card = doc.getElementById('quick-start-card');
        const reopen = doc.getElementById('quick-start-reopen');
        const dismiss = doc.getElementById('quick-start-dismiss');
        if (!card || !reopen || !dismiss) return;

        function renderSteps(facts) {
            const list = doc.getElementById('quick-start-steps');
            const model = root.FireQuickStart;
            if (!list || !model) return;
            const progress = model.quickStartProgress(facts);
            const progressEl = doc.getElementById('quick-start-progress');
            if (progressEl) {
                progressEl.textContent = `${progress.doneCount} of ${progress.total} done`;
            }
            list.textContent = '';
            progress.steps.forEach((step) => {
                const btn = doc.createElement('button');
                btn.type = 'button';
                btn.textContent = step.title;
                // A real text label (not CSS ::after) so it is read out and testable.
                if (step.optional) {
                    const tag = doc.createElement('span');
                    tag.className = 'quick-start-tag';
                    tag.textContent = 'Optional';
                    btn.appendChild(tag);
                }
                btn.addEventListener('click', () => {
                    const target = doc.getElementById(
                        step.tab ? 'btn-tab-' + step.tab : 'btn-nav-privacy',
                    );
                    if (target) target.click();
                });
                const li = doc.createElement('li');
                // Done steps stay clickable (the privacy step reopens the notice).
                li.className = [
                    step.done && 'done',
                    step.optional && 'optional',
                ]
                    .filter(Boolean)
                    .join(' ');
                li.appendChild(btn);
                list.appendChild(li);
            });
        }

        // The layout manager can move the card out of its column and then hide
        // the emptied column, so keep the reopen control next to the card.
        function keepReopenBesideCard() {
            const parent = card.parentNode;
            if (parent && reopen.parentNode !== parent && parent.insertBefore) {
                parent.insertBefore(reopen, card.nextSibling || null);
            }
        }

        async function render() {
            keepReopenBesideCard();
            const consented = !!readKey(CONSENT_KEY);
            const dismissed = readKey(DISMISS_KEY) === '1';
            card.hidden = !consented || dismissed;
            reopen.hidden = !consented || !dismissed;

            if (!consented) {
                renderSteps({});
                return;
            }

            const facts = await loadFacts();
            renderSteps(facts);
        }

        function renderSync() {
            keepReopenBesideCard();
            const consented = !!readKey(CONSENT_KEY);
            const dismissed = readKey(DISMISS_KEY) === '1';
            card.hidden = !consented || dismissed;
            reopen.hidden = !consented || !dismissed;
            renderSteps({});
        }

        dismiss.addEventListener('click', () => {
            try {
                root.localStorage.setItem(DISMISS_KEY, '1');
            } catch {
                /* storage unavailable: dismissal lasts until reload */
            }
            card.hidden = true;
            keepReopenBesideCard();
            reopen.hidden = !readKey(CONSENT_KEY);
        });
        reopen.addEventListener('click', () => {
            try {
                root.localStorage.removeItem(DISMISS_KEY);
            } catch {
                /* storage unavailable */
            }
            render();
        });

        // Initial sync render (empty facts) so card is not empty while fetches run
        renderSync();
        // Then async render with real facts
        render();

        // Recompute on tab activation
        root.addEventListener('visibilitychange', () => {
            if (root.document.visibilityState === 'visible') {
                render();
            }
        });

        // Privacy consent can arrive after init (first visit): let it refresh
        // visibility without registering the click handlers again.
        root.refreshQuickStart = render;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            initQuickStart,
            CONSENT_KEY,
            DISMISS_KEY,
            loadFacts,
        };
    } else {
        root.initQuickStart = initQuickStart;
        root.loadQuickStartFacts = loadFacts;
        if (root.document.readyState === 'loading') {
            root.document.addEventListener('DOMContentLoaded', initQuickStart);
        } else {
            initQuickStart();
        }
    }
})(globalThis);
