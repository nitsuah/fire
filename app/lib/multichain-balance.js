'use strict';

/* ==========================================================================
   multichain-balance.js — Total USD value of an EVM address across chains,
   with no API keys.

   - Blockscout chains (Ethereum, Base, Optimism, Arbitrum, Polygon): the
     public v2 API returns the native balance and every ERC-20 balance, with
     USD exchange rates.
   - RPC-only chains (BNB Smart Chain, Avalanche): native balance via a
     public publicnode.com RPC, priced from Yahoo Finance.

   Tokens count only when Blockscout prices them and hasn't flagged them as
   scams, so airdropped spam doesn't inflate the total. Every chain is
   fetched independently: a chain that fails comes back with ok:false and a
   warning, the rest still count, and the result says it is partial.
   ========================================================================== */

const TIMEOUT_MS = 10 * 1000;
const USER_AGENT = 'fire-tracker/1.1 (+https://github.com/nitsuah/fire)';
// A token "worth" more than this in one wallet is almost always a fake
// price on an illiquid token; skip it rather than report it.
const MAX_TOKEN_USD = 10_000_000;
// Fewer holders than this and a priced token is most likely spam.
const MIN_TOKEN_HOLDERS = 50;

const CHAINS = [
    {
        id: 'ethereum',
        name: 'Ethereum',
        nativeSymbol: 'ETH',
        blockscout: 'https://eth.blockscout.com',
    },
    {
        id: 'base',
        name: 'Base',
        nativeSymbol: 'ETH',
        blockscout: 'https://base.blockscout.com',
    },
    {
        id: 'optimism',
        name: 'Optimism',
        nativeSymbol: 'ETH',
        blockscout: 'https://explorer.optimism.io',
    },
    {
        id: 'arbitrum',
        name: 'Arbitrum One',
        nativeSymbol: 'ETH',
        blockscout: 'https://arbitrum.blockscout.com',
    },
    {
        id: 'polygon',
        name: 'Polygon',
        nativeSymbol: 'POL',
        blockscout: 'https://polygon.blockscout.com',
    },
    {
        id: 'bnb',
        name: 'BNB Smart Chain',
        nativeSymbol: 'BNB',
        rpc: 'https://bsc-rpc.publicnode.com',
        yahoo: 'BNB-USD',
    },
    {
        id: 'avalanche',
        name: 'Avalanche',
        nativeSymbol: 'AVAX',
        rpc: 'https://avalanche-c-chain-rpc.publicnode.com',
        yahoo: 'AVAX-USD',
    },
];

const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

function round2(n) {
    return Math.round(n * 100) / 100;
}

// 18-decimal (or `decimals`) integer string → number, without losing the
// integer part to float precision on large balances.
function fromUnits(raw, decimals = 18) {
    if (raw == null || raw === '') return 0;
    const s = String(raw).replace(/^0+(?=\d)/, '');
    const d = Number(decimals) || 0;
    if (!/^\d+$/.test(s)) return Number(raw) || 0;
    if (d === 0) return Number(s);
    const padded = s.padStart(d + 1, '0');
    return Number(`${padded.slice(0, -d)}.${padded.slice(-d)}`);
}

async function getJson(url, init = {}, fetchImpl = fetch) {
    const res = await fetchImpl(url, {
        ...init,
        headers: {
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
            ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function priceToken(t) {
    const token = t?.token || {};
    if (token.type && token.type !== 'ERC-20') return null;
    if (token.reputation === 'scam') return null;
    const rate = Number(token.exchange_rate);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const holders = Number(token.holders_count ?? token.holders);
    if (Number.isFinite(holders) && holders < MIN_TOKEN_HOLDERS) return null;
    const balance = fromUnits(t.value, token.decimals ?? 18);
    const usdValue = balance * rate;
    // Dust (< 1¢) adds nothing but noise to the breakdown.
    if (!(usdValue >= 0.01) || usdValue > MAX_TOKEN_USD) return null;
    return {
        symbol: token.symbol || '?',
        balance,
        usdValue: round2(usdValue),
        contract: token.address_hash || token.address || null,
    };
}

async function blockscoutChain(chain, address, fetchImpl) {
    const base = `${chain.blockscout}/api/v2/addresses/${address}`;
    const [info, tokens] = await Promise.all([
        getJson(base, {}, fetchImpl),
        getJson(`${base}/token-balances`, {}, fetchImpl).catch(() => null),
    ]);
    const native = fromUnits(info?.coin_balance);
    const rate = Number(info?.exchange_rate) || 0;
    const nativeUsd = native * rate;
    const priced = Array.isArray(tokens)
        ? tokens
              .map(priceToken)
              .filter(Boolean)
              .sort((a, b) => b.usdValue - a.usdValue)
        : [];
    const tokenUsd = priced.reduce((s, t) => s + t.usdValue, 0);
    return {
        native,
        nativeUsd: round2(nativeUsd),
        tokens: priced,
        tokenUsd: round2(tokenUsd),
        // Native value without a price, or tokens that failed to load,
        // make this chain's figure a lower bound.
        warning:
            tokens === null
                ? 'Token balances unavailable; native balance only.'
                : native > 0 && !rate
                  ? `No ${chain.nativeSymbol} price; native balance not valued.`
                  : null,
    };
}

async function yahooPrice(symbol, fetchImpl) {
    const data = await getJson(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
        {},
        fetchImpl,
    );
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (!price) throw new Error(`No price for ${symbol}`);
    return price;
}

async function rpcChain(chain, address, fetchImpl) {
    const data = await getJson(
        chain.rpc,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_getBalance',
                params: [address, 'latest'],
                id: 1,
            }),
        },
        fetchImpl,
    );
    if (data?.error || typeof data?.result !== 'string') {
        throw new Error(data?.error?.message || 'RPC returned no balance');
    }
    const native = fromUnits(BigInt(data.result).toString());
    // Skip the price lookup for an empty wallet.
    const price = native > 0 ? await yahooPrice(chain.yahoo, fetchImpl) : 0;
    return {
        native,
        nativeUsd: round2(native * price),
        tokens: [],
        tokenUsd: 0,
        warning: null,
    };
}

/**
 * @returns {Promise<{address, usdValue, partial, chains: Array<{chain, name,
 *   ok, native, nativeSymbol, nativeUsd, tokens, tokenUsd, usdValue,
 *   warning}>}>}
 */
async function getMultichainValue(address, { fetchImpl = fetch } = {}) {
    if (!EVM_ADDR_RE.test(String(address || ''))) {
        throw Object.assign(new Error(`Not an EVM address: ${address}`), {
            status: 400,
        });
    }
    const settled = await Promise.allSettled(
        CHAINS.map((c) =>
            c.blockscout
                ? blockscoutChain(c, address, fetchImpl)
                : rpcChain(c, address, fetchImpl),
        ),
    );
    const chains = settled.map((s, i) => {
        const c = CHAINS[i];
        if (s.status !== 'fulfilled') {
            return {
                chain: c.id,
                name: c.name,
                ok: false,
                native: null,
                nativeSymbol: c.nativeSymbol,
                nativeUsd: 0,
                tokens: [],
                tokenUsd: 0,
                usdValue: 0,
                warning: `Lookup failed (${s.reason?.message || 'error'})`,
            };
        }
        const r = s.value;
        return {
            chain: c.id,
            name: c.name,
            ok: !r.warning,
            native: r.native,
            nativeSymbol: c.nativeSymbol,
            nativeUsd: r.nativeUsd,
            tokens: r.tokens,
            tokenUsd: r.tokenUsd,
            usdValue: round2(r.nativeUsd + r.tokenUsd),
            warning: r.warning,
        };
    });
    if (chains.every((c) => c.native === null)) {
        throw Object.assign(
            new Error('Every chain lookup failed. Try again shortly.'),
            { status: 502 },
        );
    }
    return {
        address,
        usdValue: round2(chains.reduce((s, c) => s + c.usdValue, 0)),
        partial: chains.some((c) => !c.ok),
        chains,
    };
}

// Compact per-chain summary to store on an account row (no full token
// lists): chains holding at least a cent, largest first.
function summarizeChains(chains) {
    return (chains || [])
        .filter((c) => c.usdValue >= 0.01 || !c.ok)
        .sort((a, b) => b.usdValue - a.usdValue)
        .map((c) => ({
            chain: c.chain,
            name: c.name,
            usdValue: c.usdValue,
            ok: c.ok,
            topTokens: (c.tokens || [])
                .slice(0, 3)
                .map((t) => ({ symbol: t.symbol, usdValue: t.usdValue })),
        }));
}

module.exports = {
    CHAINS,
    fromUnits,
    priceToken,
    getMultichainValue,
    summarizeChains,
};
