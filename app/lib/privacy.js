/* ==========================================================================
   privacy.js — Privacy policy modal: first-load gate + nav link
   ========================================================================== */

const PRIVACY_ACCEPTED_KEY = 'fire_privacy_v1_accepted';

async function loadPrivacyPolicy() {
    try {
        const res = await fetch('/docs/privacy-policy.md');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const md = await res.text();
        return typeof marked !== 'undefined'
            ? marked.parse(md)
            : `<pre style="white-space:pre-wrap;">${md}</pre>`;
    } catch (e) {
        console.warn('[Privacy] Could not load policy:', e);
        return '<p>Privacy policy could not be loaded. View it at <a href="https://github.com/nitsuah/fire/blob/main/docs/privacy-policy.md" target="_blank" rel="noopener">github.com/nitsuah/fire</a>.</p>';
    }
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

    overlay.classList.add('open');

    const acceptBtn = document.getElementById('btn-privacy-accept');
    const closeBtn = document.getElementById('btn-privacy-close');
    if (acceptBtn) acceptBtn.addEventListener('click', acceptPrivacy);
    if (closeBtn) closeBtn.addEventListener('click', closePrivacyModal);
}

function closePrivacyModal() {
    document.getElementById('privacy-modal-overlay').classList.remove('open');
}

function acceptPrivacy() {
    localStorage.setItem(PRIVACY_ACCEPTED_KEY, Date.now().toString());
    closePrivacyModal();
}

function checkFirstLoad() {
    if (!localStorage.getItem(PRIVACY_ACCEPTED_KEY)) {
        openPrivacyModal(true);
    }
}

document.getElementById('btn-nav-privacy').addEventListener('click', () => {
    openPrivacyModal(false);
});

document.getElementById('privacy-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget && localStorage.getItem(PRIVACY_ACCEPTED_KEY)) {
        closePrivacyModal();
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkFirstLoad);
} else {
    checkFirstLoad();
}
