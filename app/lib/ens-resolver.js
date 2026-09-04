'use strict';

/* ==========================================================================
   ens-resolver.js — Resolves an ENS (.eth) name to a 0x address.
   Uses ethers.js against a public, keyless Ethereum mainnet RPC endpoint
   (overridable via ETH_RPC_URL for BYOK) rather than hand-rolling the
   Keccak-256/namehash algorithm ENS resolution requires.
   ========================================================================== */

const { JsonRpcProvider } = require('ethers');

const ENS_NAME_RE =
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.eth$/i;
const DEFAULT_RPC_URL = 'https://ethereum-rpc.publicnode.com';

function isEnsName(name) {
    return typeof name === 'string' && ENS_NAME_RE.test(name.trim());
}

let providerInstance;
function getProvider() {
    if (!providerInstance) {
        const url = process.env.ETH_RPC_URL || DEFAULT_RPC_URL;
        providerInstance = new JsonRpcProvider(url, 1, {
            staticNetwork: true,
        });
    }
    return providerInstance;
}

// Exposed for tests to inject a mock provider without touching module cache.
function _setProviderForTests(provider) {
    providerInstance = provider;
}

async function resolveEnsAddress(name) {
    if (!isEnsName(name)) {
        const err = new Error('Not a valid .eth ENS name.');
        err.code = 'INVALID_NAME';
        throw err;
    }
    const provider = getProvider();
    let address;
    try {
        address = await provider.resolveName(name.trim());
    } catch (cause) {
        const err = new Error(`ENS lookup failed: ${cause.message}`);
        err.code = 'RESOLVE_FAILED';
        err.cause = cause;
        throw err;
    }
    if (!address) {
        const err = new Error(`No address is set for ${name}.`);
        err.code = 'NOT_FOUND';
        throw err;
    }
    return address;
}

module.exports = {
    isEnsName,
    resolveEnsAddress,
    getProvider,
    _setProviderForTests,
    DEFAULT_RPC_URL,
};
