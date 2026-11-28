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

function extractSummaryBullets(md) {
    const lines = md.split('\n');
    const bullets = [];

    // Look for key section headings and create summary bullets
    const sections = [
        { heading: '## 2. Data Storage', label: 'Data Storage', summary: 'All financial data stays on your device (localStorage or local file). Nothing leaves your browser unless you opt into an integration.' },
        { heading: '## 4. External Services', label: 'Data Sharing', summary: 'Data is shared with third parties only when you explicitly connect an integration (eBay, CoinTracker, Plaid, Etsy, Google Drive). No data is sold.' },
        { heading: '## 8. Data Backup', label: 'Your Rights', summary: 'You can export, delete, or revoke access to your data at any time. No server-side account exists to request deletion from.' },
    ];

    for (const section of sections) {
        const found = lines.some(line => line.trim().startsWith(section.heading));
        if (found) {
            bullets.push(`<li><strong>${section.label}:</strong> ${section.summary}</li>`);
        }
    }

    // Always include a "What We Don't Collect" bullet if that section exists
    const noCollectFound = lines.some(line => line.trim().startsWith('## 3. What We Don'));
    if (noCollectFound) {
        bullets.push('<li><strong>What We Don\'t Collect:</strong> No account balances, PII, IP addresses, or financial data — unless you opt into an integration.</li>');
    }

    if (bullets.length === 0) return '';

    return `
<div class="privacy-summary" role="region" aria-label="Privacy policy summary">
    <h3>Privacy Policy — Quick Summary</h3>
    <ul>${bullets.join('')}</ul>
    <p class="privacy-summary-note">Full policy continues below.</p>
</div>`;
}

async function loadPrivacyPolicy() {
    try {
        const res = await fetch('/docs/privacy-policy.md');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const md = stripNavRow(await res.text());
        const summary = extractSummaryBullets(md);
        const fullPolicy = typeof marked !== 'undefined'
            ? marked.parse(md)
            : `<pre class="csp-pre-wrap">${md}</pre>`;
        return summary + fullPolicy;
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

if (document.readyState === 'complete') {
    checkFirstLoad();
} else {
    document.addEventListener('DOMContentLoaded', checkFirstLoad);
}

// Native ES module. app.js dispatches data-csp-click-action="openPrivacyModal"
// through window[...], so the function stays on window until app.js imports it.
if (typeof window !== 'undefined') window.openPrivacyModal = openPrivacyModal;
