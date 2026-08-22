'use strict';

// Public Ethereum JSON-RPC (no key required)
const ETH_RPC = 'https://cloudflare-eth.com';
// ENS resolution via free public API
const ENS_API = 'https://ensdata.net';

const ENS_RE = /^[a-z0-9-]+\.eth$/i;
const ETH_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
// Coin tickers: 1–10 uppercase letters, optionally followed by numbers
const TICKER_RE = /^[A-Z]{1,10}[0-9]*$/;

// Stablecoins priced at $1.00 without a market lookup
const STABLECOINS = new Set([
    'USDC',
    'USDT',
    'DAI',
    'BUSD',
    'TUSD',
    'GUSD',
    'FRAX',
    'LUSD',
]);

function detectIdentifierType(id) {
    if (!id || typeof id !== 'string') return null;
    const s = id.trim();
    if (ETH_ADDR_RE.test(s)) return 'address';
    if (ENS_RE.test(s.toLowerCase())) return 'ens';
    if (TICKER_RE.test(s.toUpperCase())) return 'ticker';
    return null;
}

async function resolveEns(name) {
    const res = await fetch(
        `${ENS_API}/${encodeURIComponent(name.toLowerCase())}`,
        {
            signal: AbortSignal.timeout(8000),
        },
    );
    if (!res.ok)
        throw Object.assign(new Error(`ENS lookup failed (${res.status})`), {
            status: 502,
        });
    const data = await res.json();
    const addr = data.address || data.Address || data.addr;
    if (!addr || !ETH_ADDR_RE.test(addr)) {
        throw Object.assign(
            new Error(`ENS name ${name} did not resolve to an address`),
            { status: 404 },
        );
    }
    return addr;
}

async function getEthBalance(address) {
    const body = JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1,
    });
    const res = await fetch(ETH_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(8000),
    });
    if (!res.ok)
        throw Object.assign(new Error(`ETH RPC failed (${res.status})`), {
            status: 502,
        });
    const data = await res.json();
    if (data.error)
        throw Object.assign(new Error(`ETH RPC error: ${data.error.message}`), {
            status: 502,
        });
    // Result is hex wei
    const wei = BigInt(data.result);
    return Number(wei) / 1e18;
}

async function getEthUsdPrice() {
    // Use Yahoo Finance (already in the app's price pipeline)
    const res = await fetch(
        'https://query1.finance.yahoo.com/v8/finance/chart/ETH-USD?interval=1d&range=1d',
        { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok)
        throw Object.assign(
            new Error(`ETH price fetch failed (${res.status})`),
            { status: 502 },
        );
    const data = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (!price)
        throw Object.assign(new Error('Could not parse ETH price from Yahoo'), {
            status: 502,
        });
    return price;
}

async function getTickerUsdPrice(ticker) {
    if (STABLECOINS.has(ticker.toUpperCase())) return 1.0;
    // Map common crypto tickers to Yahoo Finance symbols
    const yahooSym = `${ticker.toUpperCase()}-USD`;
    const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1d`,
        { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok)
        throw Object.assign(
            new Error(`Price fetch for ${ticker} failed (${res.status})`),
            { status: 502 },
        );
    const data = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (!price)
        throw Object.assign(new Error(`No price data for ${ticker}`), {
            status: 404,
        });
    return price;
}

// Main entry: resolves identifier → { usdValue, resolvedAddress, ethBalance, price, quantity, source }
async function resolveCryptoValue(identifier, quantity) {
    const type = detectIdentifierType(identifier);
    if (!type) {
        throw Object.assign(
            new Error(
                `Unrecognized identifier "${identifier}". Use a coin ticker (ETH, BTC), ENS name (you.eth), or 0x address.`,
            ),
            { status: 400 },
        );
    }

    if (type === 'ticker') {
        const price = await getTickerUsdPrice(identifier.toUpperCase());
        const qty = quantity || 0;
        return {
            usdValue: price * qty,
            price,
            quantity: qty,
            ticker: identifier.toUpperCase(),
            source: STABLECOINS.has(identifier.toUpperCase())
                ? 'stablecoin-peg'
                : 'yahoo-finance',
        };
    }

    // address or ens
    let address = identifier;
    if (type === 'ens') {
        address = await resolveEns(identifier);
    }
    const ethBalance = await getEthBalance(address);
    const ethPrice = await getEthUsdPrice();
    return {
        usdValue: ethBalance * ethPrice,
        resolvedAddress: address,
        ethBalance,
        price: ethPrice,
        ticker: 'ETH',
        source: 'cloudflare-eth-rpc + yahoo-finance',
    };
}

module.exports = { detectIdentifierType, resolveCryptoValue };
