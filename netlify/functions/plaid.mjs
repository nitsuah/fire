import crypto from 'node:crypto';
import { parsePlaidTransactions } from '../../app/lib/finance-parsing.js';

const PLAID_TOKEN_VERSION = 1;

function json(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
        },
    });
}

function plaidConfigured() {
    return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

function plaidBase() {
    const env = (process.env.PLAID_ENV || 'sandbox').toLowerCase();
    if (env === 'production') return 'https://production.plaid.com';
    if (env === 'development') return 'https://development.plaid.com';
    return 'https://sandbox.plaid.com';
}

function plaidHeaders() {
    return {
        'Content-Type': 'application/json',
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
    };
}

function encryptionKey() {
    const master = process.env.SYNC_MASTER_KEY;
    if (!master)
        throw new Error('SYNC_MASTER_KEY is required for hosted Plaid.');
    return crypto.createHash('sha256').update(master).digest();
}

function seal(payload) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(payload), 'utf8'),
        cipher.final(),
    ]);
    return [
        PLAID_TOKEN_VERSION,
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        ciphertext.toString('base64url'),
    ].join('.');
}

function unseal(value) {
    try {
        const [version, ivText, tagText, dataText] = String(value || '').split(
            '.',
        );
        if (
            Number(version) !== PLAID_TOKEN_VERSION ||
            !ivText ||
            !tagText ||
            !dataText
        ) {
            throw new Error('Invalid hosted Plaid token.');
        }
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            encryptionKey(),
            Buffer.from(ivText, 'base64url'),
        );
        decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(dataText, 'base64url')),
            decipher.final(),
        ]).toString('utf8');
        return JSON.parse(plaintext);
    } catch {
        throw Object.assign(
            new Error('Invalid or expired hosted Plaid token.'),
            {
            code: 'INVALID_TOKEN',
            },
        );
    }
}

function tokenFromRequest(req, body) {
    return body?.plaidToken || req.headers.get('x-fire-plaid-token') || '';
}

async function plaidPost(path, body) {
    const res = await fetch(`${plaidBase()}${path}`, {
        method: 'POST',
        headers: plaidHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw Object.assign(
            new Error(
                `Plaid returned a non-JSON response (HTTP ${res.status}).`,
            ),
            { status: 502 },
        );
    }
    if (!res.ok) {
        throw Object.assign(
            new Error(
                data.error_message ||
                    data.display_message ||
                    `Plaid request failed (HTTP ${res.status}).`,
            ),
            { status: 502 },
        );
    }
    return data;
}

async function requireToken(req, body) {
    const raw = tokenFromRequest(req, body);
    if (!raw)
        throw Object.assign(
            new Error('No hosted Plaid connection. Link an account first.'),
            { status: 401 },
        );
    const token = unseal(raw);
    if (!Array.isArray(token.items) || token.items.length === 0) {
        throw Object.assign(
            new Error('No hosted Plaid connection. Link an account first.'),
            { status: 401 },
        );
    }
    return token;
}

async function createLinkToken() {
    const data = await plaidPost('/link/token/create', {
        user: { client_user_id: 'fire-tracker-user' },
        client_name: 'fire',
        products: ['investments'],
        country_codes: ['US'],
        language: 'en',
    });
    return json(200, { linkToken: data.link_token });
}

async function exchange(req) {
    const body = await req.json().catch(() => ({}));
    if (!body.public_token)
        return json(400, { error: 'public_token is required.' });
    const data = await plaidPost('/item/public_token/exchange', {
        public_token: body.public_token,
    });
    const current = body.plaidToken ? unseal(body.plaidToken) : { items: [] };
    const items = Array.isArray(current.items) ? current.items : [];
    const idx = items.findIndex((item) => item.itemId === data.item_id);
    const nextItem = { itemId: data.item_id, accessToken: data.access_token };
    if (idx >= 0) items[idx] = { ...items[idx], ...nextItem };
    else items.push(nextItem);
    return json(200, {
        status: 'success',
        message: 'Plaid connection encrypted for this browser.',
        itemId: data.item_id,
        plaidToken: seal({ items }),
    });
}

async function accounts(token) {
    const accounts = [];
    const failedItems = [];
    for (const item of token.items) {
        try {
            const data = await plaidPost('/accounts/balance/get', {
                access_token: item.accessToken,
            });
            for (const acc of data.accounts || []) {
                accounts.push({
                    id: `plaid-${acc.account_id}`,
                    name: acc.name,
                    type:
                        acc.type === 'depository'
                            ? 'Cash'
                            : acc.type === 'investment'
                              ? 'Brokerage'
                              : 'Other',
                    value: acc.balances?.current ?? 0,
                    source: 'plaid',
                });
            }
        } catch (err) {
            failedItems.push(err.message);
        }
    }
    if (failedItems.length && !accounts.length) {
        throw Object.assign(
            new Error(
                'All Plaid account fetches failed. Existing data preserved.',
            ),
            { status: 502 },
        );
    }
    return {
        accounts,
        warning: failedItems.length
            ? `${failedItems.length} item(s) failed; partial data returned.`
            : null,
    };
}

async function positions(token) {
    const positions = [];
    const failedItems = [];
    for (const item of token.items) {
        try {
            const data = await plaidPost('/investments/holdings/get', {
                access_token: item.accessToken,
            });
            for (const holding of data.holdings || []) {
                const security = data.securities?.find(
                    (s) => s.security_id === holding.security_id,
                );
                positions.push({
                    symbol: security?.ticker_symbol || holding.security_id,
                    description: security?.name || '',
                    quantity: holding.quantity,
                    value: holding.institution_value,
                    costBasis: holding.cost_basis,
                    source: 'plaid',
                });
            }
        } catch (err) {
            failedItems.push(err.message);
        }
    }
    if (failedItems.length && !positions.length) {
        throw Object.assign(
            new Error(
                'All Plaid position fetches failed. Existing data preserved.',
            ),
            { status: 502 },
        );
    }
    return {
        positions,
        warning: failedItems.length
            ? `${failedItems.length} item(s) failed; partial data returned.`
            : null,
    };
}

async function transactions(token) {
    const allAdded = [];
    const allModified = [];
    const allRemovedIds = [];
    const updatedItems = [];
    const failedItems = [];
    let successfulItemCount = 0;

    for (const item of token.items) {
        const itemAdded = [];
        const itemModified = [];
        const itemRemovedIds = [];
        const originalCursor = item.transactionsCursor || undefined;
        let cursor = originalCursor;
        let hasMore = true;
        let itemFailed = false;

        try {
            for (let page = 0; hasMore && page < 20; page++) {
                const data = await plaidPost('/transactions/sync', {
                    access_token: item.accessToken,
                    cursor,
                    count: 500,
                });
                itemAdded.push(...(data.added || []));
                itemModified.push(...(data.modified || []));
                itemRemovedIds.push(
                    ...(data.removed || []).map(
                        (removed) => removed.transaction_id,
                    ),
                );
                cursor = data.next_cursor || cursor;
                hasMore = Boolean(data.has_more);
            }
            if (hasMore) itemFailed = true;
        } catch (err) {
            failedItems.push(err.message);
            itemFailed = true;
        }

        if (itemFailed) {
            if (!failedItems.length)
                failedItems.push(
                    'Transaction pagination exceeded the safety limit.',
                );
            updatedItems.push(item);
        } else {
            allAdded.push(...itemAdded);
            allModified.push(...itemModified);
            allRemovedIds.push(...itemRemovedIds);
            updatedItems.push({ ...item, transactionsCursor: cursor });
            successfulItemCount++;
        }
    }

    if (failedItems.length && successfulItemCount === 0) {
        throw Object.assign(
            new Error(
                'All Plaid transaction fetches failed. Existing data preserved.',
            ),
            { status: 502 },
        );
    }

    const parsedAdded = parsePlaidTransactions(allAdded);
    const parsedModified = parsePlaidTransactions(allModified);
    const parsedModifiedIds = new Set(parsedModified.map((txn) => txn.id));
    const droppedModifiedIds = allModified
        .map((txn) => `plaid-${txn.transaction_id}`)
        .filter((id) => !parsedModifiedIds.has(id));
    const removedIds = [
        ...allRemovedIds.map((id) => `plaid-${id}`),
        ...droppedModifiedIds,
    ];

    const syncedAt = new Date().toISOString();
    return {
        plaidToken: seal({
            ...token,
            items: updatedItems,
            transactionsLastSyncedAt: syncedAt,
        }),
        transactions: {
            added: parsedAdded,
            modified: parsedModified,
            removedIds,
        },
        warning: failedItems.length
            ? `${failedItems.length} item(s) failed; partial data returned.`
            : null,
        syncedAt,
    };
}

export default async function handler(req) {
    try {
        if (!plaidConfigured())
            return json(503, { error: 'Plaid not configured.' });
        const url = new URL(req.url);
        const path =
            url.pathname
                .replace('/.netlify/functions/plaid', '')
                .replace(/^\/api/, '') || '/';
        const method = req.method || 'GET';

        if (path === '/sync/plaid/create-link-token' && method === 'POST') {
            return await createLinkToken();
        }
        if (path === '/sync/plaid/exchange' && method === 'POST') {
            return await exchange(req);
        }
        if (path === '/sync/plaid/status' && method === 'GET') {
            const token = await requireToken(req, {});
            return json(200, {
                connected: true,
                itemCount: token.items.length,
                lastTransactionsSync: token.transactionsLastSyncedAt || null,
                syncEnabled: true,
                hosted: true,
            });
        }
        if (path === '/sync/plaid/accounts' && method === 'POST') {
            const token = await requireToken(
                req,
                await req
                    .clone()
                    .json()
                    .catch(() => ({})),
            );
            const result = await accounts(token);
            return json(200, {
                status: 'success',
                accountCount: result.accounts.length,
                accounts: result.accounts,
                warning: result.warning,
            });
        }
        if (path === '/sync/plaid/positions' && method === 'POST') {
            const token = await requireToken(
                req,
                await req
                    .clone()
                    .json()
                    .catch(() => ({})),
            );
            const result = await positions(token);
            return json(200, {
                status: 'success',
                positionCount: result.positions.length,
                positions: result.positions,
                warning: result.warning,
            });
        }
        if (path === '/sync/plaid/transactions' && method === 'POST') {
            const body = await req
                .clone()
                .json()
                .catch(() => ({}));
            const token = await requireToken(req, body);
            const result = await transactions(token);
            return json(200, {
                status: 'success',
                fetched:
                    result.transactions.added.length +
                    result.transactions.modified.length,
                added: result.transactions.added.length,
                modified: result.transactions.modified.length,
                removed: result.transactions.removedIds.length,
                transactions: result.transactions,
                plaidToken: result.plaidToken,
                syncedAt: result.syncedAt,
                warning: result.warning,
            });
        }
        if (path === '/sync/plaid/toggle' && method === 'POST') {
            const body = await req.json().catch(() => ({}));
            return json(200, { enabled: body.enabled !== false, hosted: true });
        }
        return json(404, { error: 'Hosted Plaid endpoint not found.' });
    } catch (err) {
        console.error('[Netlify Plaid] request failed:', err);
        return json(err.status || 500, {
            error: err.message || 'Hosted Plaid request failed.',
        });
    }
}
