/* ==========================================================================
   managers/navigation.js — Tab navigation controller
   ========================================================================== */

const SIDEBAR_COLLAPSE_KEY = 'fire_sidebar_collapsed';

window.toggleSidebarCollapse = function () {
    const container = document.querySelector('.app-container');
    if (!container) return;
    const collapsed = container.classList.toggle('sidebar-collapsed');
    try {
        localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
        /* localStorage unavailable — collapse state just won't persist */
    }
    const btn = document.getElementById('sidebar-collapse-btn');
    if (btn) {
        btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
        btn.setAttribute(
            'aria-label',
            collapsed ? 'Expand sidebar' : 'Collapse sidebar',
        );
    }
};

function initSidebarCollapseState() {
    let stored = null;
    try {
        stored = localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
    } catch {
        /* ignore */
    }
    if (stored === '1') {
        document
            .querySelector('.app-container')
            ?.classList.add('sidebar-collapsed');
        const btn = document.getElementById('sidebar-collapse-btn');
        if (btn) {
            btn.title = 'Expand sidebar';
            btn.setAttribute('aria-label', 'Expand sidebar');
        }
    }
}

function initNavigation() {
    initSidebarCollapseState();
    const navButtons = document.querySelectorAll('.nav-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');

            navButtons.forEach((b) => b.classList.remove('active'));
            tabPanes.forEach((pane) => pane.classList.remove('active'));

            btn.classList.add('active');
            const activePane = document.getElementById(`tab-${targetTab}`);
            if (activePane) activePane.classList.add('active');

            if (targetTab === 'dashboard') {
                renderAssetAllocationChart();
                renderDashboardProjectionsChart();
            } else if (targetTab === 'projections') {
                calculateAndRenderProjections();
            } else if (targetTab === 'taxes') {
                if (typeof renderTaxHarvestTable === 'function')
                    renderTaxHarvestTable();
            } else if (targetTab === 'settings') {
                if (typeof window.loadSettingsTab === 'function')
                    window.loadSettingsTab();
            }
        });
    });
}
