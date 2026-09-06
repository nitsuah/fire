'use strict';

/* ==========================================================================
   ens-wallet-lookup.js — Pure helpers for the ENS wallet-lookup route.
   Kept dependency-free (no direct require of ens-resolver/web3-prices) so
   they can be unit tested with plain stub functions instead of module
   mocking, and reused independently of Express.
   ========================================================================== */

// Maps an error thrown by resolveEnsAddress() to an HTTP status + JSON body.
function mapEnsErrorToResponse(err) {
    if (err && err.code === 'NOT_FOUND') {
        return { status: 404, body: { error: err.message } };
    }
    if (err && err.code === 'INVALID_NAME') {
        return { status: 400, body: { error: err.message } };
    }
    return {
        status: 502,
        body: { error: (err && err.message) || 'ENS lookup failed.' },
    };
}

// Fetches the balance of `address` on every EVM chain in `evmChains` via the
// injected `refreshFn` (normally web3-prices' refreshWalletBalance) and sums
// the USD value. Chains that fail or are missing an explorer API key still
// come back with `ok: false` + a warning rather than failing the lookup.
async function aggregateEvmWalletValue(address, evmChains, refreshFn) {
    const settled = await Promise.allSettled(
        evmChains.map((c) => refreshFn({ address, chain: c.id })),
    );

    const chains = settled.map((s, i) => {
        const chainDef = evmChains[i];
        if (s.status !== 'fulfilled') {
            return {
                chain: chainDef.id,
                name: chainDef.name,
                ok: false,
                usdValue: 0,
                warning: s.reason?.message || 'Lookup failed',
            };
        }
        const w = s.value || {};
        return {
            chain: chainDef.id,
            name: chainDef.name,
            ok: !w.warning,
            native: w.lastBalance ?? null,
            nativeSymbol: chainDef.nativeSymbol,
            usdValue: w.lastUsdValue || 0,
            warning: w.warning || null,
        };
    });

    const totalUsdValue = chains.reduce((sum, c) => sum + (c.usdValue || 0), 0);

    return { chains, totalUsdValue };
}

module.exports = { mapEnsErrorToResponse, aggregateEvmWalletValue };
