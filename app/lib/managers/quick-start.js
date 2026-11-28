/* ==========================================================================
   managers/quick-start.js — Quick Start card controller (#444)
   ========================================================================== */
(function (root) {
    'use strict';

    const CONSENT_KEY = 'fire_privacy_v1_accepted';
    const DISMISS_KEY = 'fire_quick_start_dismissed';
    // Set by exportFullState() in app.js.
    const JSON_EXPORT_KEY = 'fire_json_export_at';
    const HIGHLIGHT_MS = 3000;

    function readKey(key) {
        try {
            return root.localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    async function fetchStatuses() {
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

        return { providerStatuses, driveStatus };
    }

    // `statuses` lets a caller reuse an earlier fetchStatuses() promise, so
    // recomputing after an edit costs no requests. Everything local is read
    // after the await, so a slow request never shows stale data.
    async function loadFacts(statuses) {
        const { providerStatuses, driveStatus } = await (statuses ||
            fetchStatuses());

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
                jsonExported: !!readKey(JSON_EXPORT_KEY),
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

    // Bring a step's control into view, focus it and outline it briefly.
    function revealTarget(id) {
        const el = id && root.document.getElementById(id);
        if (!el) return;
        if (
            !el.matches('button, a[href], input, select, textarea') &&
            !el.hasAttribute('tabindex')
        )
            el.setAttribute('tabindex', '-1');
        el.scrollIntoView({ block: 'center' });
        el.focus({ preventScroll: true });
        el.classList.add('qs-highlight');
        root.setTimeout(
            () => el.classList.remove('qs-highlight'),
            HIGHLIGHT_MS,
        );
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
                const count = `${progress.doneCount} of ${progress.total} done`;
                if (progress.doneCount === progress.total) {
                    progressEl.textContent = `All ${progress.total} steps completed`;
                } else if (progress.requiredDone) {
                    progressEl.textContent = `${count} · essentials completed`;
                } else {
                    progressEl.textContent = count;
                }
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
                if (step.done) {
                    const mark = doc.createElement('span');
                    mark.className = 'quick-start-tag quick-start-done';
                    mark.textContent = '✓ Completed';
                    btn.appendChild(mark);
                }
                btn.addEventListener('click', () => {
                    const target = doc.getElementById(
                        step.tab ? 'btn-tab-' + step.tab : 'btn-nav-privacy',
                    );
                    if (target) target.click();
                    // After the tab switch has laid out.
                    if (step.target)
                        root.setTimeout(() => revealTarget(step.target), 0);
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

        let statuses = null;

        // { cached: true } recomputes from the last status answers.
        async function render(options) {
            keepReopenBesideCard();
            const consented = !!readKey(CONSENT_KEY);
            const dismissed = readKey(DISMISS_KEY) === '1';
            card.hidden = !consented || dismissed;
            reopen.hidden = !consented || !dismissed;

            if (!consented) {
                renderSteps({});
                return;
            }

            if (!statuses || options?.cached !== true)
                statuses = fetchStatuses();
            const facts = await loadFacts(statuses);
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

        // Recompute on dashboard open and when the window becomes visible.
        // saveState() and Chaos Mode call refreshQuickStart for other changes.
        doc.getElementById('btn-tab-dashboard')?.addEventListener('click', () =>
            render(),
        );
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
        root.revealControl = revealTarget;
        root.loadQuickStartFacts = loadFacts;
        if (root.document.readyState === 'loading') {
            root.document.addEventListener('DOMContentLoaded', initQuickStart);
        } else {
            initQuickStart();
        }
    }
})(globalThis);
