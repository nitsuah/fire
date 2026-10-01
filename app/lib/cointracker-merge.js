/* ==========================================================================
   cointracker-merge.js — Folds CoinTracker wallets into state.customAccounts.
   Pure functions, loaded as-is by the browser (window.FireCoinTrackerMerge)
   and Node (tests, MCP server).

   CoinTracker is the source of truth for any wallet it tracks:
   - Each CoinTracker wallet becomes one Crypto account row
     (source: 'cointracker'), so the dashboard's aggregate crypto value and
     every per-wallet value come from one place.
   - A manual Crypto row whose identifier (address or ENS) matches one of the
     wallet's addresses is *adopted*: it keeps its id, name and APY, takes
     CoinTracker's value, and its manual fields are stashed in
     `manualSnapshot`. Nothing is counted twice, and disconnecting restores
     the manual row exactly.
   - Manual rows that can't be matched by address (ticker-only entries, or
     no identifier) are reported as possible duplicates, never changed.
   - A wallet missing from a partial sync is kept as-is; it is only dropped
     (or its manual row restored) after a complete sync without it.
   ========================================================================== */
/* global module */

(function (root) {
    'use strict';

    const SOURCE = 'cointracker';

    function lower(s) {
        return typeof s === 'string' ? s.trim().toLowerCase() : '';
    }

    function isCoinTrackerRow(acc) {
        return acc?.source === SOURCE && Boolean(acc.cointracker);
    }

    function meta(wallet, syncedAt) {
        return {
            providerId: wallet.providerId,
            kind: wallet.kind || null,
            chains: wallet.chains || [],
            addresses: wallet.addresses || [],
            holdings: wallet.holdings || [],
            syncedAt,
        };
    }

    // Manual fields a CoinTracker adoption overwrites or hides.
    const SNAPSHOT_KEYS = [
        'value',
        'identifier',
        'quantity',
        'valueSource',
        'valueLastRefreshed',
    ];

    function adopt(row, wallet, syncedAt) {
        const manualSnapshot = {};
        const next = { ...row };
        for (const key of SNAPSHOT_KEYS) {
            if (key in row) manualSnapshot[key] = row[key];
            delete next[key];
        }
        return {
            ...next,
            value: wallet.usdValue,
            source: SOURCE,
            cointracker: meta(wallet, syncedAt),
            manualSnapshot,
        };
    }

    function restore(row) {
        const rest = { ...row };
        delete rest.cointracker;
        delete rest.source;
        delete rest.manualSnapshot;
        return { ...rest, ...row.manualSnapshot };
    }

    function rowId(providerId) {
        return `cointracker-${String(providerId).replace(/[^A-Za-z0-9_-]/g, '_')}`;
    }

    function possibleDuplicates(accounts, wallets) {
        const symbols = new Set();
        for (const w of wallets) {
            for (const h of w.holdings || []) {
                if (h.symbol) symbols.add(lower(h.symbol));
            }
        }
        const out = [];
        for (const acc of accounts) {
            if (acc.type !== 'Crypto' || acc.source === SOURCE) continue;
            const id = lower(acc.identifier);
            if (!id) {
                out.push({ id: acc.id, name: acc.name, reason: 'no address' });
            } else if (symbols.has(id)) {
                out.push({
                    id: acc.id,
                    name: acc.name,
                    reason: `${acc.identifier.toUpperCase()} is also held in CoinTracker`,
                });
            }
        }
        return out;
    }

    /**
     * @param {object[]} accounts state.customAccounts
     * @param {object[]} wallets  normalized CoinTracker wallets
     * @param {object}   opts     { syncedAt, partial, excluded: providerId[] }
     * @returns {{accounts, added, updated, adopted, removed, possibleDuplicates}}
     */
    function mergeCoinTrackerWallets(accounts, wallets, opts = {}) {
        const syncedAt = opts.syncedAt || new Date().toISOString();
        const excluded = new Set((opts.excluded || []).map(String));
        // An empty result can't prove every wallet is gone.
        const partial = Boolean(opts.partial) || wallets.length === 0;
        const incoming = wallets.filter(
            (w) =>
                w &&
                w.providerId != null &&
                !excluded.has(String(w.providerId)),
        );
        const result = (accounts || []).slice();
        const counts = { added: 0, updated: 0, adopted: 0, removed: 0 };

        const byProvider = new Map();
        result.forEach((acc, i) => {
            if (isCoinTrackerRow(acc))
                byProvider.set(String(acc.cointracker.providerId), i);
        });

        const seen = new Set();
        for (const wallet of incoming) {
            const pid = String(wallet.providerId);
            seen.add(pid);
            const idx = byProvider.get(pid);
            if (idx !== undefined) {
                const cur = result[idx];
                result[idx] = {
                    ...cur,
                    // Adopted rows keep the user's own name.
                    name: cur.manualSnapshot ? cur.name : wallet.name,
                    value: wallet.usdValue,
                    cointracker: meta(wallet, syncedAt),
                };
                counts.updated++;
                continue;
            }
            const addrs = new Set((wallet.addresses || []).map(lower));
            const manualIdx = result.findIndex(
                (acc) =>
                    acc.type === 'Crypto' &&
                    acc.source !== SOURCE &&
                    addrs.has(lower(acc.identifier)),
            );
            if (manualIdx !== -1) {
                result[manualIdx] = adopt(result[manualIdx], wallet, syncedAt);
                byProvider.set(pid, manualIdx);
                counts.adopted++;
                continue;
            }
            result.push({
                id: rowId(pid),
                type: 'Crypto',
                name: wallet.name,
                value: wallet.usdValue,
                apy: 0,
                source: SOURCE,
                cointracker: meta(wallet, syncedAt),
            });
            byProvider.set(pid, result.length - 1);
            counts.added++;
        }

        const final = [];
        for (const acc of result) {
            if (!isCoinTrackerRow(acc)) {
                final.push(acc);
                continue;
            }
            const pid = String(acc.cointracker.providerId);
            const gone = !seen.has(pid) && (!partial || excluded.has(pid));
            if (!gone) {
                final.push(acc);
                continue;
            }
            counts.removed++;
            if (acc.manualSnapshot) final.push(restore(acc));
        }

        return {
            accounts: final,
            ...counts,
            possibleDuplicates: possibleDuplicates(final, incoming),
        };
    }

    // Disconnect: drop CoinTracker-only rows, restore adopted manual rows.
    function removeCoinTrackerWallets(accounts) {
        return (accounts || [])
            .filter((acc) => !isCoinTrackerRow(acc) || acc.manualSnapshot)
            .map((acc) => (isCoinTrackerRow(acc) ? restore(acc) : acc));
    }

    // Lower-cased addresses CoinTracker covers, for deduping other trackers
    // (e.g. the server-side wallet list in the MCP server's net worth).
    function coinTrackerAddresses(accounts) {
        const out = new Set();
        for (const acc of accounts || []) {
            if (!isCoinTrackerRow(acc)) continue;
            for (const a of acc.cointracker.addresses || []) out.add(lower(a));
        }
        return out;
    }

    const api = {
        SOURCE,
        isCoinTrackerRow,
        mergeCoinTrackerWallets,
        removeCoinTrackerWallets,
        coinTrackerAddresses,
        possibleDuplicates,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.FireCoinTrackerMerge = api;
})(globalThis);
