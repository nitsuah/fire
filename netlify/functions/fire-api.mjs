import {
    resolveMetalValue,
    METAL_PAYOUT_PCT,
} from '../../app/lib/metals-prices.js';
// Not ens-resolver.js: it needs `ethers`, which Netlify's function bundle
// doesn't ship, and a failed import took down every route here (metals
// included). crypto-balance resolves ENS over HTTPS with no dependencies.
import cryptoBalance from '../../app/lib/crypto-balance.js';
import multichain from '../../app/lib/multichain-balance.js';
// Keyless per-symbol Yahoo chart reads, the same fallback the self-hosted
// route uses — the v7 quote API needs a crumb this deploy can't hold.
import pricesProvider from '../../app/lib/prices-provider.js';

const { detectIdentifierType, resolveCryptoValue, resolveEns } = cryptoBalance;
const { fetchYahooChart } = pricesProvider;
const isEnsName = (name) => detectIdentifierType(name) === 'ens';

function json(statusCode, body) {
    return new Response(JSON.stringify(body), {
        status: statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
        },
    });
}

function routePath(raw) {
    const marker = '/.netlify/functions/fire-api';
    const idx = raw.indexOf(marker);
    if (idx !== -1) return raw.slice(idx + marker.length) || '/';
    const apiIdx = raw.indexOf('/api/');
    return apiIdx !== -1 ? raw.slice(apiIdx + 4) : raw;
}

async function handleMetals(url) {
    const metal = url.searchParams.get('metal');
    const metals = metal ? [metal.toLowerCase()] : ['gold', 'silver'];
    const results = {};
    for (const type of metals) {
        if (type !== 'gold' && type !== 'silver') continue;
        try {
            const result = await resolveMetalValue(type, 1);
            results[type] = {
                price: result.pricePerOz,
                pricePerOz: result.pricePerOz,
                payoutPct: METAL_PAYOUT_PCT[type],
                meltPrice: result.pricePerOz * METAL_PAYOUT_PCT[type],
                source: result.source,
                cached: false,
            };
        } catch (err) {
            results[type] = {
                error: err.message || 'Metal price lookup failed',
            };
        }
    }
    return json(200, results);
}

async function handleEns(name) {
    if (!isEnsName(name)) {
        return json(400, {
            error: 'Provide a valid .eth ENS name, e.g. vitalik.eth',
        });
    }

    try {
        const address = await resolveEns(name);
        const result = await multichain.getMultichainValue(address);
        return json(200, {
            name,
            address: `...${address.slice(-8)}`,
            totalUsdValue: result.usdValue,
            partial: result.partial,
            chains: result.chains,
        });
    } catch (err) {
        if (err?.code === 'NOT_FOUND' || err?.status === 404)
            return json(404, { error: err.message });
        if (err?.code === 'INVALID_NAME')
            return json(400, { error: err.message });
        console.error('[Netlify API] ENS lookup failed:', err);
        return json(502, {
            error: 'ENS lookup failed. Please try again shortly.',
        });
    }
}

// Hosted twin of POST /api/accounts/:id/refresh-crypto. The browser owns
// the account here, so it sends the identifier/quantity and saves the
// result itself.
async function handleRefreshCrypto(req) {
    let body;
    try {
        body = JSON.parse((await req.text()) || '{}');
    } catch {
        return json(400, { error: 'Body must be JSON.' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json(400, { error: 'Body must be a JSON object.' });
    }
    const identifier =
        typeof body.identifier === 'string' ? body.identifier.trim() : '';
    if (!identifier) {
        return json(400, {
            error: 'Set a coin ticker, ENS name, or 0x address first.',
        });
    }
    try {
        return json(200, await resolveCryptoValue(identifier, body.quantity));
    } catch (err) {
        const status = err?.status || 502;
        if (status >= 500)
            console.error('[Netlify API] Crypto refresh failed:', err);
        return json(status, {
            error:
                status >= 500 && !err?.status
                    ? 'Crypto price lookup failed. Please try again shortly.'
                    : err.message,
        });
    }
}

async function handlePrices(url) {
    const raw = url.searchParams.get('symbols');
    if (!raw) return json(200, {});
    const symbols = [
        ...new Set(
            raw
                .split(',')
                .map((s) => s.trim().replace(/\*+$/g, ''))
                .filter(
                    (s) =>
                        s.length > 0 &&
                        !/^\d/.test(s) &&
                        !['SPAXX', 'FDRXX', 'FCASH', 'FDIC'].includes(
                            s.toUpperCase(),
                        ),
                ),
        ),
    ].slice(0, 60); // bound the fan-out on a public endpoint
    if (!symbols.length) return json(200, {});
    try {
        return json(200, await fetchYahooChart(symbols));
    } catch (err) {
        console.error('[Netlify API] Price lookup failed:', err.message);
        // Empty, not an error: the client keeps the last good prices it
        // already stored and shows them as stale.
        return json(200, {});
    }
}

export default async function handler(req) {
    try {
        const url = new URL(req.url);
        const path = routePath(url.pathname);
        const method = req.method || 'GET';

        if (path === '/metals' && method === 'GET') {
            return await handleMetals(url);
        }

        // Without this the hosted deploy's every price refresh 404'd, so
        // quotes stayed pinned at whatever the last import wrote (#218).
        if (path === '/prices' && method === 'GET') {
            return await handlePrices(url);
        }

        if (path === '/accounts/refresh-crypto' && method === 'POST') {
            return await handleRefreshCrypto(req);
        }

        const ensMatch = path.match(/^\/wallets\/ens\/([^/]+)$/);
        if (ensMatch && method === 'GET') {
            return await handleEns(decodeURIComponent(ensMatch[1]));
        }

        return json(404, {
            error: 'This API endpoint is not available in the hosted browser deployment.',
            path: `/api${path.startsWith('/') ? path : `/${path}`}`,
        });
    } catch (err) {
        console.error('[Netlify API] Unhandled error:', err);
        return json(500, { error: 'Hosted API request failed.' });
    }
}
