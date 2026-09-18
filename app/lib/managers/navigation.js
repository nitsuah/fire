/* ==========================================================================
   managers/navigation.js — Tab navigation controller
   ========================================================================== */

const SIDEBAR_COLLAPSE_KEY = 'fire_sidebar_collapsed';
// Matches the @media (max-width: 768px) breakpoint in layout.css where the
// sidebar switches from a persistent desktop rail to an off-canvas drawer.
const MOBILE_BREAKPOINT = 768;

function isMobileViewport() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
}

// Below the mobile breakpoint the same button opens/closes an off-canvas
// nav drawer (.nav-drawer-open) instead of the desktop icon-rail collapse
// (.sidebar-collapsed) — two different affordances behind one control,
// matched to what's actually useful at each width, rather than a single
// class whose desktop-only CSS silently did nothing on a narrow viewport.
window.toggleSidebarCollapse = function () {
    const container = document.querySelector('.app-container');
    if (!container) return;

    if (isMobileViewport()) {
        const open = container.classList.toggle('nav-drawer-open');
        setToggleBtnState(open ? 'Close menu' : 'Open menu', open);
        return;
    }

    const collapsed = container.classList.toggle('sidebar-collapsed');
    try {
        localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
        /* localStorage unavailable — collapse state just won't persist */
    }
    setToggleBtnState(
        collapsed ? 'Expand sidebar' : 'Collapse sidebar',
        !collapsed,
    );
};

window.closeNavDrawer = function () {
    const container = document.querySelector('.app-container');
    if (!container) return;
    container.classList.remove('nav-drawer-open');
    setToggleBtnState('Open menu', false);
};

function setToggleBtnState(label, expanded) {
    const btn = document.getElementById('sidebar-collapse-btn');
    if (!btn) return;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

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

            if (isMobileViewport()) closeNavDrawer();

            if (targetTab === 'dashboard') {
                renderAssetAllocationChart();
                renderDashboardProjectionsChart();
            } else if (targetTab === 'projections') {
                calculateAndRenderProjections();
            } else if (targetTab === 'insights') {
                if (typeof renderTaxHarvestTable === 'function')
                    renderTaxHarvestTable();
            } else if (targetTab === 'settings') {
                if (typeof window.loadSettingsTab === 'function')
                    window.loadSettingsTab();
            }
        });
    });
}
