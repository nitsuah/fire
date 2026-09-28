import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    resolveMetalValue,
    METAL_PAYOUT_PCT,
} = require('../../app/lib/metals-prices.js');
const { isEnsName, resolveEnsAddress } =
    require('../../app/lib/ens-resolver.js');
const { aggregateEvmWalletValue } =
    require('../../app/lib/ens-wallet-lookup.js');
const { loadChains, refreshWalletBalance } =
    require('../../app/lib/web3-prices.js');

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
        const address = await resolveEnsAddress(name);
        const evmChains = loadChains().filter((c) => c.addressFormat === 'evm');
        const { chains, totalUsdValue } = await aggregateEvmWalletValue(
            address,
            evmChains,
            refreshWalletBalance,
        );
        return json(200, {
            name,
            address: `...${address.slice(-8)}`,
            totalUsdValue,
            chains,
        });
    } catch (err) {
        if (err?.code === 'NOT_FOUND') return json(404, { error: err.message });
        if (err?.code === 'INVALID_NAME')
            return json(400, { error: err.message });
        console.error('[Netlify API] ENS lookup failed:', err);
        return json(502, {
            error: 'ENS lookup failed. Please try again shortly.',
        });
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

        const ensMatch = path.match(/^\/wallets\/ens\/([^/]+)$/);
        if (ensMatch && method === 'GET') {
            return await handleEns(decodeURIComponent(ensMatch[1]));
        }

        if (path === '/sync/plaid/status' && method === 'GET') {
            return json(200, {
                connected: false,
                itemCount: 0,
                syncEnabled: true,
                hosted: true,
                message:
                    'Plaid account persistence is not enabled for the browser-only deployment yet.',
            });
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
