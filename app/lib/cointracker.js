/* ==========================================================================
   cointracker.js — Optional CoinTracker wallet sync (Settings card).

   Same flow on the self-hosted server and the Netlify deploy: the server
   side (/api/sync/cointracker/*) only brokers OAuth and reads CoinTracker's
   MCP server; the browser keeps the sealed token in its own localStorage key
   (so JSON backups of fire_tracker_state never carry it) and merges the
   wallets into state.customAccounts with FireCoinTrackerMerge, then saves
   the usual way. CoinTracker is read-only here: balances only, never P&L,
   cost basis or tax data, and never private keys.
   ========================================================================== */

const CT_TOKEN_KEY = 'fire_cointracker_token';
const CT_LAST_SYNC_KEY = 'fire_cointracker_last_sync';
const CT_LAST_RESULT_KEY = 'fire_cointracker_last_result';
const CT_CONNECT_PENDING_KEY = 'fire_cointracker_connect_pending';
// Stale balances are refreshed quietly on page load after this long.
const CT_AUTO_SYNC_MS = 6 * 60 * 60 * 1000;

function ctRead(key, storage = localStorage) {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
}

function ctWrite(key, value, storage = localStorage) {
    try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
    } catch {
        /* storage unavailable — nothing to persist */
    }
}

function ctLastResult() {
    try {
        return JSON.parse(ctRead(CT_LAST_RESULT_KEY) || 'null');
    } catch {
        return null;
    }
}

function ctExcluded() {
    return Array.isArray(state.coinTrackerExcluded)
        ? state.coinTrackerExcluded.map(String)
        : [];
}

// Auth0 rotates refresh tokens, so two requests refreshing the same blob
// at once (an Exclude click during a sync, or auto-sync in a second tab)
// would burn the grant. Every call runs under one cross-tab Web Lock (or a
// per-tab queue where Web Locks are unavailable) and reads the token only
// once it holds the lock, so it always sends the newest blob.
let ctQueue = Promise.resolve();

function ctLocked(fn) {
    if (navigator.locks?.request) {
        return navigator.locks.request('fire-cointracker', fn);
    }
    const run = ctQueue.then(fn, fn);
    ctQueue = run.catch(() => {});
    return run;
}

function ctPost(action, extra = {}) {
    return ctLocked(async () => {
        const token = ctRead(CT_TOKEN_KEY);
        if (!token) throw new Error('CoinTracker is not connected.');
        const res = await fetch(`/api/sync/cointracker/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, ...extra }),
        });
        const data = await res.json().catch(() => ({}));
        // A dead or unreadable grant can never work again: drop it so the
        // card offers Connect instead of failing on every sync.
        if (
            res.status === 401 &&
            /^cointracker_(revoked|token_invalid)$/.test(data.code || '')
        ) {
            ctWrite(CT_TOKEN_KEY, null);
            const d = data.diagnostic;
            const detail = d
                ? ` (token: ${d.format}${d.aud ? `, aud ${[].concat(d.aud).join(' ')}` : ''}${d.scope ? `, scope ${d.scope}` : ''}${d.permissions ? `, permissions [${d.permissions.join(' ')}]` : d.format === 'jwt' ? ', no permissions claim' : ''})`
                : '';
            throw new Error(
                (data.error || 'CoinTracker connection expired. Reconnect.') +
                    detail,
            );
        }
        // Saved even on failure: a refresh before the error rotated it.
        if (data.token) ctWrite(CT_TOKEN_KEY, data.token);
        if (!res.ok)
            throw new Error(
                data.error ||
                    `CoinTracker request failed (HTTP ${res.status}).`,
            );
        return data;
    });
}

function ctSetStatus(text, color = 'var(--text-muted)') {
    const el = document.getElementById('cointracker-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = color;
}

async function runCoinTrackerSync({ silent = false } = {}) {
    const btn = document.getElementById('btn-cointracker-sync');
    if (btn) btn.disabled = true;
    if (!silent)
        ctSetStatus('Syncing CoinTracker wallets…', 'var(--color-warning)');
    try {
        const data = await ctPost('sync');
        const merged = FireCoinTrackerMerge.mergeCoinTrackerWallets(
            state.customAccounts,
            data.wallets || [],
            {
                syncedAt: data.syncedAt,
                partial: Boolean(data.partial),
                keep: data.skippedProviderIds || [],
                excluded: ctExcluded(),
            },
        );
        state.customAccounts = merged.accounts;
        await saveState();
        ctWrite(CT_LAST_SYNC_KEY, data.syncedAt);
        ctWrite(
            CT_LAST_RESULT_KEY,
            JSON.stringify({
                tool: data.tool,
                warnings: data.warnings || [],
                wallets: (data.wallets || []).map((w) => ({
                    providerId: w.providerId,
                    name: w.name,
                    usdValue: w.usdValue,
                })),
                counts: {
                    added: merged.added,
                    updated: merged.updated,
                    adopted: merged.adopted,
                    removed: merged.removed,
                },
            }),
        );
        if (typeof refreshAllUI === 'function') refreshAllUI();
        renderCoinTrackerCard();
        return merged;
    } catch (err) {
        ctSetStatus(`Sync failed: ${err.message}`, 'var(--color-danger)');
        if (!silent) throw err;
        return null;
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function disconnectCoinTracker() {
    if (
        !confirm(
            'Disconnect CoinTracker? Wallets it added are removed, and manual crypto accounts it replaced are restored.',
        )
    )
        return;
    try {
        await ctPost('disconnect');
    } catch {
        /* revocation is best effort; the local token goes regardless */
    }
    ctWrite(CT_TOKEN_KEY, null);
    ctWrite(CT_LAST_SYNC_KEY, null);
    ctWrite(CT_LAST_RESULT_KEY, null);
    state.customAccounts = FireCoinTrackerMerge.removeCoinTrackerWallets(
        state.customAccounts,
    );
    await saveState();
    if (typeof refreshAllUI === 'function') refreshAllUI();
    renderCoinTrackerCard();
}

async function inspectCoinTrackerTools() {
    const out = document.getElementById('cointracker-inspect');
    if (!out) return;
    out.textContent = 'Loading CoinTracker tool list…';
    try {
        const data = await ctPost('inspect');
        out.innerHTML = `<p class="csp-text-12">Balance tool in use: <strong>${escHtml(data.selected || 'none found')}</strong></p><ul class="csp-text-11">${(
            data.tools || []
        )
            .map(
                (t) =>
                    `<li><code>${escHtml(t.name)}</code>${t.arguments.length ? ` (${escHtml(t.arguments.join(', '))})` : ''} — ${escHtml(t.description)}</li>`,
            )
            .join('')}</ul>`;
    } catch (err) {
        out.textContent = `Could not list tools: ${err.message}`;
    }
}

async function toggleCoinTrackerWallet(providerId) {
    const excluded = new Set(ctExcluded());
    if (excluded.has(providerId)) excluded.delete(providerId);
    else excluded.add(providerId);
    state.coinTrackerExcluded = [...excluded];
    // Persist first: the choice must stick even if the sync below fails.
    await saveState();
    renderCoinTrackerCard();
    await runCoinTrackerSync({ silent: true });
}

function renderCoinTrackerCard() {
    const connected = Boolean(ctRead(CT_TOKEN_KEY));
    const lastSync = ctRead(CT_LAST_SYNC_KEY);
    const result = ctLastResult();
    const toggle = (id, show) => {
        const el = document.getElementById(id);
        if (el) el.style.display = show ? '' : 'none';
    };
    toggle('btn-cointracker-connect', !connected);
    toggle('btn-cointracker-sync', connected);
    toggle('btn-cointracker-inspect', connected);
    toggle('btn-cointracker-disconnect', connected);

    const rows = (state.customAccounts || []).filter((a) =>
        FireCoinTrackerMerge.isCoinTrackerRow(a),
    );
    const total = rows.reduce((s, a) => s + (Number(a.value) || 0), 0);
    if (!connected) {
        ctSetStatus('Not connected');
    } else {
        const when = lastSync ? new Date(lastSync).toLocaleString() : 'never';
        const warn = result?.warnings?.length
            ? ` · ⚠ ${result.warnings.join(' ')}`
            : '';
        ctSetStatus(
            `Connected · ${rows.length} wallet${rows.length === 1 ? '' : 's'} · ${formatCurrency(total)} · Last sync: ${when}${warn}`,
            warn ? 'var(--color-warning)' : 'var(--color-success)',
        );
    }

    const listEl = document.getElementById('cointracker-wallets');
    if (listEl) {
        const excluded = new Set(ctExcluded());
        const known = new Map(
            rows.map((r) => [String(r.cointracker.providerId), r]),
        );
        const wallets = (result?.wallets || []).filter(Boolean);
        listEl.innerHTML =
            connected && wallets.length
                ? wallets
                      .map((w) => {
                          const pid = String(w.providerId);
                          const row = known.get(pid);
                          const isExcluded = excluded.has(pid);
                          const meta = row?.cointracker || {};
                          const chains = (meta.chains || []).join(', ');
                          const holdings = (meta.holdings || [])
                              .filter((h) => h.symbol)
                              .sort(
                                  (a, b) =>
                                      (b.usdValue || 0) - (a.usdValue || 0),
                              )
                              .slice(0, 5)
                              .map(
                                  (h) =>
                                      `${h.symbol}${h.usdValue != null ? ` ${formatCurrency(h.usdValue)}` : ''}`,
                              )
                              .join(' · ');
                          const adopted = row?.manualSnapshot
                              ? ' · replaces your manual entry'
                              : '';
                          return `<div class="chain-balance-row wallet-row">
                <span class="chain-name">
                    <strong>${escHtml(row?.name || w.name)}</strong>
                    ${chains ? `<span class="tag-badge csp-ml-6">${escHtml(chains)}</span>` : ''}
                    <span class="text-muted csp-block csp-text-10">${escHtml(holdings || 'no per-asset detail')}${escHtml(adopted)}</span>
                </span>
                <span class="chain-val wallet-row-actions">
                    <span>${isExcluded ? '<span class="text-muted">excluded</span>' : formatCurrency(w.usdValue)}</span>
                    <button type="button" class="action-btn" data-ct-toggle="${escHtml(pid)}">${isExcluded ? 'Include' : 'Exclude'}</button>
                </span>
            </div>`;
                      })
                      .join('')
                : '';
    }

    const dupEl = document.getElementById('cointracker-duplicates');
    if (dupEl) {
        const dups = connected
            ? FireCoinTrackerMerge.possibleDuplicates(
                  state.customAccounts || [],
                  rows.map((r) => ({ holdings: r.cointracker.holdings || [] })),
              )
            : [];
        dupEl.innerHTML = dups.length
            ? `<p class="csp-text-12"><strong>Possible duplicates</strong>: these manual crypto accounts couldn't be matched to a CoinTracker wallet by address. If CoinTracker already tracks them, delete them in Accounts so they aren't counted twice.</p><ul class="csp-text-11">${dups
                  .map(
                      (d) =>
                          `<li>${escHtml(d.name)} — ${escHtml(d.reason)}</li>`,
                  )
                  .join('')}</ul>`
            : '';
    }
}

// The callback returns to /#cointracker-connected=<blob> or
// /#cointracker-error=<code>. Like eBay's flow, a result is only accepted
// by the tab that started the connect, so a crafted link can't attach
// someone else's CoinTracker account to this browser.
async function consumeCoinTrackerFragment() {
    const match = (window.location.hash || '').match(
        /^#cointracker-(connected|error)=(.*)$/,
    );
    if (!match) return false;
    history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
    );
    const pending = ctRead(CT_CONNECT_PENDING_KEY, sessionStorage) === '1';
    ctWrite(CT_CONNECT_PENDING_KEY, null, sessionStorage);
    if (!pending) {
        console.warn(
            '[CoinTracker] Ignored an OAuth result this tab did not start.',
        );
        return false;
    }
    if (match[1] === 'error') {
        ctSetStatus(
            `CoinTracker connection failed (${decodeURIComponent(match[2])}).`,
            'var(--color-danger)',
        );
        return false;
    }
    ctWrite(CT_TOKEN_KEY, decodeURIComponent(match[2]));
    try {
        await runCoinTrackerSync();
    } catch {
        /* status line already shows the failure */
    }
    return true;
}

function initCoinTracker() {
    const card = document.getElementById('cointracker-card');
    if (!card) return;
    card.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;
        if (target.id === 'btn-cointracker-connect') {
            ctWrite(CT_CONNECT_PENDING_KEY, '1', sessionStorage);
            window.location.assign('/api/sync/cointracker/authorize');
        } else if (target.id === 'btn-cointracker-sync') {
            runCoinTrackerSync().catch(() => {});
        } else if (target.id === 'btn-cointracker-disconnect') {
            disconnectCoinTracker();
        } else if (target.id === 'btn-cointracker-inspect') {
            inspectCoinTrackerTools();
        } else if (target.dataset.ctToggle) {
            toggleCoinTrackerWallet(target.dataset.ctToggle);
        }
    });
    renderCoinTrackerCard();
    consumeCoinTrackerFragment().then((handled) => {
        if (handled || !ctRead(CT_TOKEN_KEY)) return;
        const last = Date.parse(ctRead(CT_LAST_SYNC_KEY) || '');
        if (!Number.isFinite(last) || Date.now() - last > CT_AUTO_SYNC_MS) {
            runCoinTrackerSync({ silent: true });
        }
    });
}
