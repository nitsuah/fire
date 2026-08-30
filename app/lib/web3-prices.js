'use strict';

const path = require('path');
const fs = require('fs');

const CHAINS_FILE = path.join(__dirname, '../../config/chains.json');
const WEI_PER_NATIVE = 10n ** 18n;

let chainsCache;

function loadChains() {
    if (!chainsCache) {
        chainsCache = JSON.parse(fs.readFileSync(CHAINS_FILE, 'utf8'));
    }
    return chainsCache;
}

function parseWeiBalance(weiBalance) {
    const whole = weiBalance / WEI_PER_NATIVE;
    const fractional = weiBalance % WEI_PER_NATIVE;
    return Number(whole) + Number(fractional) / 1e18;
}

async function fetchCoinGeckoPrice(coingeckoId) {
    const key = process.env.COINGECKO_API_KEY;
    const base = key
        ? 'https://pro-api.coingecko.com/api/v3'
        : 'https://api.coingecko.com/api/v3';
    const headers = key ? { 'x-cg-pro-api-key': key } : {};
    const url = `${base}/simple/price?ids=${coingeckoId}&vs_currencies=usd`;
    try {
        const res = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data[coingeckoId]?.usd ?? null;
    } catch {
        return null;
    }
}

async function fetchEvmBalance(address, chain) {
    const apiKey = chain.envKey ? process.env[chain.envKey] : null;
    if (!apiKey && chain.envKey) {
        return { ok: false, warning: `${chain.envKey} not set` };
    }
    const params = new URLSearchParams({
        module: 'account',
        action: 'balance',
        address,
        tag: 'latest',
        ...(chain.chainId != null ? { chainid: String(chain.chainId) } : {}),
        ...(apiKey ? { apikey: apiKey } : {}),
    });
    try {
        const res = await fetch(`${chain.apiBase}?${params}`, {
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok)
            return { ok: false, warning: `Explorer returned ${res.status}` };
        const data = await res.json();
        if (data.status !== '1')
            return { ok: false, warning: data.message || 'Explorer error' };
        const weiBalance = BigInt(data.result || '0');
        const native = parseWeiBalance(weiBalance);
        const price = await fetchCoinGeckoPrice(chain.coingeckoId);
        const usdValue = price != null ? native * price : 0;
        return { ok: true, native, usdValue, price };
    } catch {
        return { ok: false, warning: 'Balance fetch failed' };
    }
}

async function fetchBitcoinBalance(address) {
    try {
        const res = await fetch(
            `https://blockstream.info/api/address/${encodeURIComponent(address)}`,
            { signal: AbortSignal.timeout(8000) },
        );
        if (!res.ok)
            return { ok: false, warning: `Blockstream returned ${res.status}` };
        const data = await res.json();
        const satoshis =
            (data.chain_stats?.funded_txo_sum || 0) -
            (data.chain_stats?.spent_txo_sum || 0);
        const native = satoshis / 1e8;
        const price = await fetchCoinGeckoPrice('bitcoin');
        const usdValue = price != null ? native * price : 0;
        return { ok: true, native, usdValue, price };
    } catch {
        return { ok: false, warning: 'Balance fetch failed' };
    }
}

async function fetchSolanaBalance(address) {
    try {
        const res = await fetch('https://api.mainnet-beta.solana.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getBalance',
                params: [address],
            }),
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok)
            return { ok: false, warning: `Solana RPC returned ${res.status}` };
        const data = await res.json();
        const lamports = data.result?.value || 0;
        const native = lamports / 1e9;
        const price = await fetchCoinGeckoPrice('solana');
        const usdValue = price != null ? native * price : 0;
        return { ok: true, native, usdValue, price };
    } catch {
        return { ok: false, warning: 'Balance fetch failed' };
    }
}

async function refreshWalletBalance(wallet) {
    const chains = loadChains();
    const chain = chains.find((c) => c.id === wallet.chain);
    if (!chain) {
        return {
            ...wallet,
            warning: `Unknown chain: ${wallet.chain}`,
            lastFetched: new Date().toISOString(),
        };
    }

    let result;
    if (chain.id === 'bitcoin') {
        result = await fetchBitcoinBalance(wallet.address);
    } else if (chain.id === 'solana') {
        result = await fetchSolanaBalance(wallet.address);
    } else if (chain.addressFormat === 'evm') {
        result = await fetchEvmBalance(wallet.address, chain);
    } else {
        result = { ok: false, warning: 'Unsupported chain' };
    }

    return {
        ...wallet,
        ...(result.ok
            ? {
                  lastBalance: result.native,
                  lastUsdValue: result.usdValue,
                  lastPrice: result.price ?? null,
              }
            : {}),
        lastFetched: new Date().toISOString(),
        ...(result.warning
            ? { warning: result.warning }
            : { warning: undefined }),
    };
}

module.exports = { refreshWalletBalance, loadChains };
