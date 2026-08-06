/* ==========================================================================
   managers/asset-form.js — Unified asset entry form tab switcher
   ========================================================================== */

function initUnifiedAssetForm() {
    const tabs = document.querySelectorAll('.ua-tab-btn');
    const panels = ['account', 'cd', 'realestate', 'vehicle'];
    tabs.forEach((btn) => {
        btn.addEventListener('click', () => {
            tabs.forEach((t) => t.classList.remove('active'));
            btn.classList.add('active');
            const target = btn.dataset.uaTab;
            panels.forEach((p) => {
                const el = document.getElementById(`ua-panel-${p}`);
                if (el) el.style.display = target === p ? '' : 'none';
            });
        });
    });
}
