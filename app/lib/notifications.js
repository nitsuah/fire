/* ==========================================================================
   lib/notifications.js — Local browser notification alerts
   ========================================================================== */

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
    } else {
        btn.textContent = 'Enable';
        statusEl.textContent =
            'Enable browser notifications to receive FIRE milestone and CD maturity alerts.';
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
            });
            if (sendPush && daysLeft <= 14)
                _sendNotification(
                    'Tax-Loss Harvesting Deadline',
                    msg,
                    'taxloss-yearend',
                );
        }
    }

    // Render inline alert list
    const listEl = document.getElementById('notif-alerts-list');
    if (listEl) {
        if (alerts.length === 0) {
            listEl.style.display = 'none';
        } else {
            listEl.style.display = '';
            listEl.innerHTML = alerts
                .map(
                    (a) => `
                <div class="notif-alert ${a.urgent ? 'notif-urgent' : ''}" style="padding:6px 10px;margin:4px 0;border-radius:6px;background:${a.urgent ? 'rgba(255,80,80,0.15)' : 'rgba(255,255,255,0.07)'};border-left:3px solid ${a.urgent ? 'var(--color-danger)' : 'var(--color-amber)'};">
                    <span class="font-bold" style="font-size:11px;text-transform:uppercase;color:${a.urgent ? 'var(--color-danger)' : 'var(--color-amber)'};">${escHtml(a.label)}</span>
                    <span style="display:block;font-size:13px;margin-top:2px;">${escHtml(a.msg)}</span>
                </div>
            `,
                )
                .join('');
        }
    }

    return alerts;
};

// Exposed so refreshAllUI() can call it after state is loaded
window.updateNotifUI = _updateNotifUI;
