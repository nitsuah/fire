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

    function initQuickStart() {
        const doc = root.document;
        const card = doc.getElementById('quick-start-card');
        const reopen = doc.getElementById('quick-start-reopen');
        const dismiss = doc.getElementById('quick-start-dismiss');
        if (!card || !reopen || !dismiss) return;

        function renderSteps() {
            const list = doc.getElementById('quick-start-steps');
            const model = root.FireQuickStart;
            if (!list || !model) return;
            list.textContent = '';
            model.STEPS.forEach((step) => {
                const btn = doc.createElement('button');
                btn.type = 'button';
                btn.textContent = step.title;
                btn.addEventListener('click', () => {
                    const target = doc.getElementById(
                        step.tab ? 'btn-tab-' + step.tab : 'btn-nav-privacy',
                    );
                    if (target) target.click();
                });
                const li = doc.createElement('li');
                li.appendChild(btn);
                list.appendChild(li);
            });
        }

        function render() {
            const consented = !!readKey(CONSENT_KEY);
            const dismissed = readKey(DISMISS_KEY) === '1';
            card.hidden = !consented || dismissed;
            reopen.hidden = !consented || !dismissed;
        }

        dismiss.addEventListener('click', () => {
            try {
                root.localStorage.setItem(DISMISS_KEY, '1');
            } catch {
                /* storage unavailable: dismissal lasts until reload */
            }
            card.hidden = true;
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
        renderSteps();
        render();
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { initQuickStart, CONSENT_KEY, DISMISS_KEY };
    } else {
        root.initQuickStart = initQuickStart;
        if (root.document.readyState === 'loading') {
            root.document.addEventListener('DOMContentLoaded', initQuickStart);
        } else {
            initQuickStart();
        }
    }
})(globalThis);