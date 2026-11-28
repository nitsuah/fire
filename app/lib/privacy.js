/* ==========================================================================
   privacy.js — Privacy policy modal: first-load gate + nav link
   ========================================================================== */

const PRIVACY_ACCEPTED_KEY = 'fire_privacy_v1_accepted';

export function stripNavRow(md) {
    return md
        .split('\n')
        .filter((line) => !line.trimEnd().endsWith('<!-- nav -->'))
        .join('\n');
}

async function loadPrivacyPolicy() {
    try {
        const res = await fetch('/docs/privacy-policy.md');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const md = stripNavRow(await res.text());
        return typeof marked !== 'undefined'
            ? marked.parse(md)
            : `<pre class="csp-pre-wrap">${md}</pre>`;
    } catch (e) {
        console.warn('[Privacy] Could not load policy:', e);
        return '<p>Privacy policy could not be loaded. View it at <a href="https://github.com/nitsuah/fire/blob/main/docs/privacy-policy.md" target="_blank" rel="noopener">github.com/nitsuah/fire</a>.</p>';
    }
}

// While the window is open the rest of the page is inert, so neither Tab nor
// assistive technology can reach it. Only what was changed here is restored.
let inertedElements = [];
let returnFocusTo = null;

function setBackgroundInert(overlay) {
    inertedElements = Array.from(document.body.children).filter(
        (el) => el !== overlay && el.tagName !== 'SCRIPT' && !el.inert,
    );
    inertedElements.forEach((el) => (el.inert = true));
}

async function openPrivacyModal(isRequired) {
    const overlay = document.getElementById('privacy-modal-overlay');
    const body = document.getElementById('privacy-modal-body');
    const footer = document.getElementById('privacy-modal-footer');

    if (!body.dataset.loaded) {
        body.innerHTML = '<div class="privacy-loading">Loading policy…</div>';
        body.innerHTML = await loadPrivacyPolicy();
        body.dataset.loaded = '1';
    }

    footer.innerHTML = isRequired
        ? `<p class="privacy-notice">This application stores your financial data locally on your device. Review the policy above before continuing.</p>
           <button class="primary-btn" id="btn-privacy-accept">I Understand — Continue</button>`
        : `<button class="backup-btn" id="btn-privacy-close">Close</button>`;

    if (!overlay.classList.contains('open')) {
        returnFocusTo = document.activeElement;
        setBackgroundInert(overlay);
        overlay.classList.add('open');
    }
    // Focus the dialog itself so a screen reader announces it and the policy
    // is read from the top, rather than starting at the footer button.
    document.getElementById('privacy-modal').focus();

    const acceptBtn = document.getElementById('btn-privacy-accept');
    const closeBtn = document.getElementById('btn-privacy-close');
    if (acceptBtn) acceptBtn.addEventListener('click', acceptPrivacy);
    if (closeBtn) closeBtn.addEventListener('click', closePrivacyModal);
}

function closePrivacyModal() {
    document.getElementById('privacy-modal-overlay').classList.remove('open');
    inertedElements.forEach((el) => (el.inert = false));
    inertedElements = [];
    if (returnFocusTo?.isConnected) returnFocusTo.focus();
    returnFocusTo = null;
}

function acceptPrivacy() {
    localStorage.setItem(PRIVACY_ACCEPTED_KEY, Date.now().toString());
    closePrivacyModal();
    // Quick Start waits for consent; show it now instead of after a reload.
    if (typeof globalThis.refreshQuickStart === 'function') {
        globalThis.refreshQuickStart();
    }
}

function checkFirstLoad() {
    if (!localStorage.getItem(PRIVACY_ACCEPTED_KEY)) {
        openPrivacyModal(true);
    }
}

document.getElementById('btn-nav-privacy').addEventListener('click', () => {
    openPrivacyModal(false);
});

document
    .getElementById('privacy-modal-overlay')
    .addEventListener('click', (e) => {
        if (
            e.target === e.currentTarget &&
            localStorage.getItem(PRIVACY_ACCEPTED_KEY)
        ) {
            closePrivacyModal();
        }
    });

// Escape closes a reopened window; the first-run one still needs consent.
document.addEventListener('keydown', (e) => {
    if (
        e.key === 'Escape' &&
        document
            .getElementById('privacy-modal-overlay')
            ?.classList?.contains('open') &&
        localStorage.getItem(PRIVACY_ACCEPTED_KEY)
    ) {
        closePrivacyModal();
    }
});

if (document.readyState === 'complete') {
    checkFirstLoad();
} else {
    document.addEventListener('DOMContentLoaded', checkFirstLoad);
}

// Native ES module. app.js dispatches data-csp-click-action="openPrivacyModal"
// through window[...], so the function stays on window until app.js imports it.
if (typeof window !== 'undefined') window.openPrivacyModal = openPrivacyModal;
