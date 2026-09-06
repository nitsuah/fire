/* ==========================================================================
   lib/notifications.js — Local browser notification alerts
   Lives behind the bell icon in the top nav (next to the FIRE Progress /
   projection bar) instead of a dashboard card.
   ========================================================================== */

const NOTIF_DISMISSED_KEY = 'fire_dismissed_alerts';

function _getDismissedAlerts() {
    try {
        const stored = localStorage.getItem(NOTIF_DISMISSED_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

window.dismissNotifAlert = function (tag) {
    const dismissed = _getDismissedAlerts();
    if (!dismissed.includes(tag)) {
        dismissed.push(tag);
        try {
            localStorage.setItem(
                NOTIF_DISMISSED_KEY,
                JSON.stringify(dismissed),
            );
        } catch {
            /* localStorage unavailable — dismissal just won't persist */
        }
    }
    checkAndNotify(state, false);
};

window.toggleNotifDropdown = function (forceOpen) {
    const dd = document.getElementById('notif-dropdown');
    const btn = document.getElementById('notif-bell-btn');
    if (!dd || !btn) return;
    const shouldOpen =
        typeof forceOpen === 'boolean'
            ? forceOpen
            : dd.style.display === 'none';
    dd.style.display = shouldOpen ? 'block' : 'none';
    btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
};

// Close the dropdown when clicking anywhere outside it.
document.addEventListener('click', (e) => {
    const dd = document.getElementById('notif-dropdown');
    const wrap = document.querySelector('.notif-bell-wrap');
    if (!dd || !wrap || dd.style.display === 'none') return;
    if (!wrap.contains(e.target)) window.toggleNotifDropdown(false);
});

function _updateNotifUI() {
    const btn = document.getElementById('notif-enable-btn');
    const statusEl = document.getElementById('notif-status-text');
    if (!btn || !statusEl) return;

    if (!('Notification' in window)) {
        statusEl.textContent = 'Your browser does not support notifications.';
        btn.disabled = true;
        return;
    }

    const perm = Notification.permission;
    if (perm === 'granted') {
        btn.textContent = 'Check Now';
        btn.onclick = () => checkAndNotify(state, true);
        statusEl.textContent =
            'Notifications enabled. Active alerts are shown below.';
        checkAndNotify(state, false);
    } else if (perm === 'denied') {
        btn.textContent = 'Blocked';
        btn.disabled = true;
        statusEl.textContent =
            'Notifications blocked. Allow them in your browser settings to re-enable.';
        checkAndNotify(state, false);
    } else {
        btn.textContent = 'Enable';
        statusEl.textContent =
            'Enable browser notifications to receive FIRE milestone and CD maturity alerts.';
        checkAndNotify(state, false);
    }
}

window.requestNotificationPermission = async function () {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') {
        await Notification.requestPermission();
    }
    _updateNotifUI();
    if (Notification.permission === 'granted') {
        checkAndNotify(state, true);
    }
};

function _sendNotification(title, body, tag) {
    if (Notification.permission !== 'granted') return;
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready
            .then((reg) => {
                reg.showNotification(title, {
                    body,
                    tag,
                    icon: '/favicon.ico',
                    badge: '/favicon.ico',
                });
            })
            .catch(() => {});
    } else {
        new Notification(title, { body, tag });
    }
}

window.checkAndNotify = function (s, sendPush) {
    const alerts = [];
    const prefs = s.notificationSettings || {};
    const globalEnabled = prefs.enabled !== false;
    const now = new Date();
    const daysLeft = Math.ceil(
        (new Date(now.getFullYear(), 11, 31) - now) / 86400000,
    );

    // CD maturity within 30 days
    if (globalEnabled && prefs.cdAlerts !== false) {
        (s.cds || []).forEach((cd) => {
            if (!cd.maturity) return;
            const matDate = new Date(cd.maturity);
            const daysToMat = Math.ceil((matDate - now) / 86400000);
            if (daysToMat >= 0 && daysToMat <= 30) {
                const msg = `${cd.bank} CD ($${(cd.principal || 0).toLocaleString()}) matures in ${daysToMat} day${daysToMat !== 1 ? 's' : ''}.`;
                alerts.push({
                    type: 'cd',
                    label: 'CD Maturity',
                    msg,
                    urgent: daysToMat <= 7,
                    tag: `cd-${cd.id}`,
                });
                if (sendPush)
                    _sendNotification('CD Maturing Soon', msg, `cd-${cd.id}`);
            }
        });
    }

    // FIRE milestone check
    if (globalEnabled && prefs.fireMilestones !== false) {
        if (typeof buildProjectionData === 'function' && s.projectionSettings) {
            try {
                const data = buildProjectionData(s, 0);
                if (data && data.fireNumber > 0) {
                    const nw = data.nwData?.[0] || 0;
                    const pct = (nw / data.fireNumber) * 100;
                    const milestones = [25, 50, 75, 90, 100];
                    milestones.forEach((m) => {
                        if (pct >= m) {
                            const key = `fire-milestone-${m}`;
                            const msg = `You've reached ${m}% of your FIRE number ($${Math.round(data.fireNumber).toLocaleString()})!`;
                            alerts.push({
                                type: 'fire',
                                label: `FIRE ${m}%`,
                                msg,
                                urgent: m >= 100,
                                tag: key,
                            });
                            if (sendPush && !sessionStorage.getItem(key)) {
                                _sendNotification(
                                    `FIRE Milestone: ${m}%`,
                                    msg,
                                    key,
                                );
                                sessionStorage.setItem(key, '1');
                            }
                        }
                    });
                }
            } catch (_) {
                /* projection not ready */
            }
        }
    }

    // Tax-loss harvesting urgency
    if (globalEnabled && prefs.taxHarvestAlerts !== false) {
        const hasLosses = (s.importedPositions || []).some(
            (p) => p.costBasis > 0 && p.value < p.costBasis,
        );
        if (hasLosses && daysLeft <= 45) {
            const msg = `${daysLeft} days left in the year — review Tax-Loss Harvesting opportunities in the Taxes tab.`;
            alerts.push({
                type: 'taxloss',
                label: 'Tax-Loss Harvest',
                msg,
                urgent: daysLeft <= 14,
                tag: 'taxloss-yearend',
            });
            if (sendPush && daysLeft <= 14)
                _sendNotification(
                    'Tax-Loss Harvesting Deadline',
                    msg,
                    'taxloss-yearend',
                );
        }
    }

    // Individually dismissible — dismissed alerts stay hidden (and excluded
    // from the badge count) until the underlying condition changes and
    // regenerates a different tag (e.g. a new FIRE milestone %).
    const dismissed = _getDismissedAlerts();
    const visibleAlerts = alerts.filter(
        (a) => !a.tag || !dismissed.includes(a.tag),
    );

    // Render dismissible alert list in the bell dropdown
    const listEl = document.getElementById('notif-alerts-list');
    if (listEl) {
        if (visibleAlerts.length === 0) {
            listEl.innerHTML =
                '<div class="notif-dropdown-empty">No active alerts 🎉</div>';
        } else {
            listEl.innerHTML = visibleAlerts
                .map(
                    (a) => `
                <div class="notif-alert-row ${a.urgent ? 'notif-urgent' : ''}">
                    ${a.tag ? `<button class="notif-dismiss-btn" onclick="dismissNotifAlert('${a.tag}')" aria-label="Dismiss">✕</button>` : ''}
                    <span class="font-bold" style="font-size:11px;text-transform:uppercase;color:${a.urgent ? 'var(--color-danger)' : 'var(--color-warning)'};">${escHtml(a.label)}</span>
                    <span style="display:block;font-size:13px;margin-top:2px;">${escHtml(a.msg)}</span>
                </div>
            `,
                )
                .join('');
        }
    }

    // Bell badge — count of visible (non-dismissed) alerts, red for urgent
    const badge = document.getElementById('notif-bell-badge');
    if (badge) {
        if (visibleAlerts.length === 0) {
            badge.style.display = 'none';
        } else {
            badge.style.display = '';
            badge.textContent = String(visibleAlerts.length);
            badge.style.background = visibleAlerts.some((a) => a.urgent)
                ? 'var(--color-danger)'
                : 'var(--color-warning)';
        }
    }

    return visibleAlerts;
};

// Exposed so refreshAllUI() can call it after state is loaded
window.updateNotifUI = _updateNotifUI;
