/* ==========================================================================
   mcp-connect.js — Hosted MCP consent page (#514). Runs only when the URL
   hash is `#/mcp-connect?req=...`. Text nodes only; no inline handlers.
   ========================================================================== */
import {
    BridgeHost,
    acquireBridgeLock,
    renderBanner,
} from '../bridge-host.mjs';
import {
    DEFAULT_LENGTH_MS,
    STATE_KEY,
    completionUrl,
    denyUrl,
    describeRequest,
    hasFireData,
    newSid,
    pendingFromHash,
} from './mcp-connect-core.mjs';

const CHANNEL = 'fire-bridge';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function relayUrl() {
    const meta = document.querySelector('meta[name="fire-relay-url"]');
    return meta ? meta.content : '';
}

/** The browser's tool core, loaded on demand; absent in builds without it. */
async function loadTools() {
    const mod = await import('./mcp-tools.browser.mjs');
    if (typeof mod.handleTool !== 'function') throw new Error('no tools');
    return mod.handleTool;
}

function readState() {
    return JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
}

function buildPanel() {
    const overlay = el('div', 'mcp-connect-overlay');
    overlay.id = 'mcp-connect-overlay';
    const panel = el('div', 'mcp-connect-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'mcp-connect-title');
    overlay.append(panel);
    document.body.append(overlay);
    return panel;
}

function message(panel, title, body) {
    panel.textContent = '';
    const h = el('h2', 'mcp-connect-title', title);
    h.id = 'mcp-connect-title';
    panel.append(h, el('p', 'mcp-connect-note', body));
}

async function approve(panel, info, req, chosen, lengthMs, status) {
    status.textContent = 'Connecting…';
    const lock = await acquireBridgeLock(navigator.locks);
    if (!lock) {
        status.textContent =
            'An agent is already connected in another fire tab. Disconnect it there first.';
        return;
    }
    let handleTool;
    try {
        handleTool = await loadTools();
    } catch {
        lock.release();
        status.textContent =
            'This build cannot serve MCP tools yet, so nothing was shared.';
        return;
    }
    const channel = new BroadcastChannel(CHANNEL);
    // Tell other fire tabs an agent is connected here.
    channel.onmessage = (ev) => {
        if (ev.data && ev.data.type === 'probe') {
            channel.postMessage({ type: 'busy', clientName: info.clientName });
        }
    };
    const sid = newSid();
    const banner = el('div', 'mcp-connect-banner');
    let linked = false;
    const host = new BridgeHost({
        createSocket: (url) => new WebSocket(url),
        relayUrl: relayUrl(),
        getState: readState,
        handleTool,
        storage: localStorage,
        onChange: async () => {
            renderBanner(document, banner, host);
            if (host.state === 'ended') {
                lock.release();
                channel.close();
                status.textContent =
                    'The connection ended. Start again from your agent.';
            }
            if (host.state === 'live' && !linked) {
                linked = true;
                status.textContent =
                    'Connected. Keep this tab open, then return to your agent.';
                const url = await completionUrl(location.origin, sid, req);
                const link = el(
                    'a',
                    'primary-btn mcp-connect-return',
                    `Return to ${info.redirectHost}`,
                );
                link.href = url;
                link.target = '_blank';
                link.rel = 'noopener';
                panel.append(link);
            }
        },
    });
    host.attachPageLifecycle(window);
    panel.textContent = '';
    const h = el('h2', 'mcp-connect-title', 'Agent connected');
    h.id = 'mcp-connect-title';
    panel.append(
        h,
        banner,
        status,
        el(
            'p',
            'mcp-connect-note',
            'Closing or reloading this tab ends the session.',
        ),
    );
    try {
        await host.start({
            sid,
            pendingAuth: req,
            scope: chosen,
            lengthMs,
            clientName: info.clientName,
        });
    } catch {
        lock.release();
        status.textContent = 'Could not start the connection.';
    }
}

function renderConsent(panel, info, req) {
    panel.textContent = '';
    const h = el(
        'h2',
        'mcp-connect-title',
        'Connect an agent to your fire data',
    );
    h.id = 'mcp-connect-title';
    const who = el('p', 'mcp-connect-who');
    who.append(
        el('strong', '', info.clientName || 'An unnamed client'),
        el(
            'span',
            'mcp-connect-unverified',
            ' (name set by the client, not verified)',
        ),
    );
    const host = el('p', 'mcp-connect-host');
    host.append('After you approve, you return to ');
    host.append(el('strong', '', info.redirectHost));
    host.append('. Only continue if you started this from that service.');

    const fieldset = el('fieldset', 'mcp-connect-groups');
    fieldset.append(el('legend', '', 'Read-only data this agent may see'));
    const boxes = info.groups.map((g) => {
        const label = el('label', 'mcp-connect-group');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = g.id;
        box.checked = g.checked;
        label.append(box, el('span', '', ` ${g.label}`));
        fieldset.append(label);
        return box;
    });

    const lengthLabel = el('label', 'mcp-connect-length', 'Session length ');
    const select = document.createElement('select');
    for (const m of [15, 30, 60]) {
        const opt = document.createElement('option');
        opt.value = String(m * 60_000);
        opt.textContent = `${m} minutes`;
        opt.selected = m * 60_000 === DEFAULT_LENGTH_MS;
        select.append(opt);
    }
    lengthLabel.append(select);

    const disclosure = el(
        'p',
        'mcp-connect-note',
        'A relay passes each request to this tab and each answer back, and sees it in plain text, in memory only, while it is in flight. It stores nothing. Keep this tab open while connected; closing it, reloading it, going idle for 10 minutes or pressing Disconnect ends the session.',
    );

    const status = el('p', 'mcp-connect-status');
    status.setAttribute('role', 'status');
    const approveBtn = el('button', 'primary-btn', 'Approve');
    approveBtn.type = 'button';
    approveBtn.id = 'mcp-connect-approve';
    const denyBtn = el('button', 'backup-btn', 'Deny');
    denyBtn.type = 'button';
    denyBtn.id = 'mcp-connect-deny';

    const sync = () => {
        approveBtn.disabled = !boxes.some((b) => b.checked);
    };
    boxes.forEach((b) => b.addEventListener('change', sync));
    sync();

    approveBtn.addEventListener('click', () => {
        approveBtn.disabled = true;
        denyBtn.disabled = true;
        const chosen = boxes.filter((b) => b.checked).map((b) => b.value);
        approve(panel, info, req, chosen, Number(select.value), status);
    });
    denyBtn.addEventListener('click', () => {
        location.assign(denyUrl(info));
    });

    const actions = el('div', 'mcp-connect-actions');
    actions.append(denyBtn, approveBtn);
    panel.append(
        h,
        who,
        host,
        fieldset,
        lengthLabel,
        disclosure,
        status,
        actions,
    );
}

export function initMcpConnect() {
    const req = pendingFromHash(location.hash);
    if (!req) return;
    const panel = buildPanel();
    if (!relayUrl()) {
        message(
            panel,
            'Not available',
            'This deployment has no relay configured.',
        );
        return;
    }
    const info = describeRequest(req);
    if (!info) {
        message(
            panel,
            'Invalid request',
            'This connection request could not be read. Start again from your agent.',
        );
        return;
    }
    if (!hasFireData(localStorage)) {
        message(
            panel,
            'No fire data in this browser',
            'This browser profile has no fire data to share. Open fire in the browser where you keep your data, then start the connection again.',
        );
        return;
    }
    renderConsent(panel, info, req);
}

initMcpConnect();
