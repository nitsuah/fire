'use strict';

const path = require('path');
const fs = require('fs');

const CHAINS_FILE = path.join(__dirname, '../../config/chains.json');

function loadChains() {
    return JSON.parse(fs.readFileSync(CHAINS_FILE, 'utf8'));
}

async function fetchCoinGeckoPrice(coingeckoId) {
    const key = process.env.COINGECKO_API_KEY;
    const base = key
        ? 'https://pro-api.coingecko.com/api/v3'
        : 'https://api.coingecko.com/api/v3';
    const headers = key ? { 'x-cg-pro-api-key': key } : {};
    const url = `${base}/simple/price?ids=${coingeckoId}&vs_currencies=usd`;
    try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
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
        return { native: 0, usdValue: 0, warning: `${chain.envKey} not set` };
    }
    const params = new URLSearchParams({
        module: 'account',
        action: 'balance',
        address,
        tag: 'latest',
        ...(apiKey ? { apikey: apiKey } : {}),
    });
    try {
        const res = await fetch(`${chain.apiBase}?${params}`, {
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return { native: 0, usdValue: 0 };
        const data = await res.json();
        if (data.status !== '1') return { native: 0, usdValue: 0 };
        const weiBalance = BigInt(data.result || '0');
        const native = Number(weiBalance) / 1e18;
        const price = await fetchCoinGeckoPrice(chain.coingeckoId);
        const usdValue = price != null ? native * price : 0;
        return { native, usdValue, price };
    } catch {
        return { native: 0, usdValue: 0 };
    }
}

async function fetchBitcoinBalance(address) {
    try {
        const res = await fetch(
            `https://blockstream.info/api/address/${encodeURIComponent(address)}`,
            { signal: AbortSignal.timeout(8000) },
        );
        if (!res.ok) return { native: 0, usdValue: 0 };
        const data = await res.json();
        const satoshis =
            (data.chain_stats?.funded_txo_sum || 0) -
            (data.chain_stats?.spent_txo_sum || 0);
        const native = satoshis / 1e8;
        const price = await fetchCoinGeckoPrice('bitcoin');
        const usdValue = price != null ? native * price : 0;
        return { native, usdValue, price };
    } catch {
        return { native: 0, usdValue: 0 };
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
        if (!res.ok) return { native: 0, usdValue: 0 };
        const data = await res.json();
        const lamports = data.result?.value || 0;
        const native = lamports / 1e9;
        const price = await fetchCoinGeckoPrice('solana');
        const usdValue = price != null ? native * price : 0;
        return { native, usdValue, price };
    } catch {
        return { native: 0, usdValue: 0 };
    }
}

async function refreshWalletBalance(wallet) {
    const chains = loadChains();
    const chain = chains.find((c) => c.id === wallet.chain);
    if (!chain) {
        return { ...wallet, warning: `Unknown chain: ${wallet.chain}`, lastFetched: new Date().toISOString() };
    }

    let result;
    if (chain.id === 'bitcoin') {
        result = await fetchBitcoinBalance(wallet.address);
    } else if (chain.id === 'solana') {
        result = await fetchSolanaBalance(wallet.address);
    } else if (chain.addressFormat === 'evm') {
        result = await fetchEvmBalance(wallet.address, chain);
    } else {
        result = { native: 0, usdValue: 0, warning: 'Unsupported chain' };
    }

    return {
        ...wallet,
        lastBalance: result.native,
        lastUsdValue: result.usdValue,
        lastPrice: result.price ?? null,
        lastFetched: new Date().toISOString(),
        ...(result.warning ? { warning: result.warning } : {}),
    };
}

module.exports = { refreshWalletBalance, loadChains };
