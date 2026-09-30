import crypto from 'node:crypto';
import { parsePlaidTransactions } from '../../app/lib/finance-parsing.js';

const PLAID_TOKEN_VERSION = 1;
// Rolling expiry: every response re-seals the token, so this only locks out
// a browser that has been idle for the whole window.
const PLAID_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

function json(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
        },
    });
}

function plaidEnv() {
    return (process.env.PLAID_ENV || 'sandbox').toLowerCase();
}

// Returns why hosted Plaid cannot run, or null when it is fully configured.
// Checked before any Plaid call so a missing key never strands a linked Item.
function configError() {
    if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET)
        return 'PLAID_CLIENT_ID and PLAID_SECRET are required.';
    if (!/^[0-9a-f]{64}$/i.test(process.env.SYNC_MASTER_KEY || ''))
        return 'SYNC_MASTER_KEY must be 64 hex characters.';
    if (!process.env.PLAID_HOSTED_ACCESS_KEY && plaidEnv() !== 'sandbox')
        return 'PLAID_HOSTED_ACCESS_KEY is required outside the Plaid sandbox.';
    return null;
}

// The hosted site is public, so without an owner key anyone could link
// Items (billed per Item) under this deployment's Plaid credentials.
function hasAccess(req) {
    const expected = process.env.PLAID_HOSTED_ACCESS_KEY;
    if (!expected) return true;
    const given = req.headers.get('x-fire-plaid-access') || '';
    const digest = (value) =>
        crypto.createHash('sha256').update(value).digest();
    return crypto.timingSafeEqual(digest(given), digest(expected));
}

const createLinkRate = new Map();
const CREATE_LINK_LIMIT = 10;
const CREATE_LINK_WINDOW_MS = 60 * 1000;

function checkCreateLinkRateLimit(req) {
    const key =
        req.headers.get('x-nf-client-connection-ip') ||
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        'unknown';
    const now = Date.now();
    for (const [ip, entry] of createLinkRate) {
        if (now - entry.startedAt >= CREATE_LINK_WINDOW_MS)
            createLinkRate.delete(ip);
    }
    const entry = createLinkRate.get(key);
    if (!entry) {
        createLinkRate.set(key, { startedAt: now, count: 1 });
        return true;
    }
    entry.count += 1;
    return entry.count <= CREATE_LINK_LIMIT;
}

function plaidBase() {
    const env = plaidEnv();
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
    return crypto
        .createHash('sha256')
        .update(process.env.SYNC_MASTER_KEY)
        .digest();
}

function invalidTokenError() {
    return Object.assign(
        new Error(
            'Saved Plaid connection is invalid or expired. Link your account again.',
        ),
        { code: 'INVALID_TOKEN', status: 401 },
    );
}

function seal(payload) {
    const withExpiry = {
        ...payload,
        exp: Math.floor(Date.now() / 1000) + PLAID_TOKEN_TTL_SECONDS,
    };
    const iv = crypto.randomBytes(GCM_IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv, {
        authTagLength: GCM_TAG_BYTES,
    });
    const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(withExpiry), 'utf8'),
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
    const key = encryptionKey();
    try {
        const [version, ivText, tagText, dataText, ...rest] = String(
            value || '',
        ).split('.');
        if (Number(version) !== PLAID_TOKEN_VERSION || !dataText || rest.length)
            throw new Error('malformed token');
        const iv = Buffer.from(ivText, 'base64url');
        const tag = Buffer.from(tagText, 'base64url');
        if (iv.length !== GCM_IV_BYTES || tag.length !== GCM_TAG_BYTES)
            throw new Error('bad IV or auth tag length');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, {
            authTagLength: GCM_TAG_BYTES,
        });
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(dataText, 'base64url')),
            decipher.final(),
        ]).toString('utf8');
        const payload = JSON.parse(plaintext);
        if (
            !Number.isFinite(payload.exp) ||
            payload.exp <= Math.floor(Date.now() / 1000)
        ) {
            throw new Error('expired');
        }
        return payload;
    } catch (err) {
        console.warn('[Netlify Plaid] rejected hosted token:', err.message);
        throw invalidTokenError();
    }
}

function tokenFromRequest(req, body) {
    return body?.plaidToken || req.headers.get('x-fire-plaid-token') || '';
}

async function plaidPost(path, body) {
    let res;
    try {
        res = await fetch(`${plaidBase()}${path}`, {
            method: 'POST',
            headers: plaidHeaders(),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000),
        });
    } catch (err) {
        const timedOut = err.name === 'TimeoutError';
        throw Object.assign(
            new Error(
                timedOut
                    ? 'Plaid did not respond in time.'
                    : 'Could not reach Plaid.',
            ),
            { status: timedOut ? 504 : 502 },
        );
    }
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
            { status: 502, plaidErrorCode: data.error_code || null },
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

// Logs the cause server-side and keeps only a sanitized code for the client.
function recordItemFailure(failures, itemId, err) {
    console.error(
        `[Netlify Plaid] item ${itemId} failed:`,
        err.plaidErrorCode || '',
        err.message,
    );
    failures.push({
        itemId,
        code: err.plaidErrorCode || err.code || 'REQUEST_FAILED',
    });
}

function partialWarning(failures) {
    if (!failures.length) return null;
    const relink = failures.some((f) => f.code === 'ITEM_LOGIN_REQUIRED')
        ? ' Re-link the affected institution to resume syncing it.'
        : '';
    return `${failures.length} item(s) failed; partial data returned.${relink}`;
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
    // An unreadable saved token must not block linking: start a fresh item
    // list instead of consuming (and losing) the one-time public_token.
    let current = { items: [] };
    let warning = null;
    if (body.plaidToken) {
        try {
            current = unseal(body.plaidToken);
        } catch (err) {
            if (err.code !== 'INVALID_TOKEN') throw err;
            warning =
                'Your previous Plaid connection could not be read and was replaced. Re-link any other institutions.';
        }
    }
    const data = await plaidPost('/item/public_token/exchange', {
        public_token: body.public_token,
    });
    const items = Array.isArray(current.items) ? current.items : [];
    const idx = items.findIndex((item) => item.itemId === data.item_id);
    const nextItem = { itemId: data.item_id, accessToken: data.access_token };
    if (idx >= 0) items[idx] = { ...items[idx], ...nextItem };
    else items.push(nextItem);
    return json(200, {
        status: 'success',
        message: 'Plaid connection encrypted for this browser.',
        itemId: data.item_id,
        plaidToken: seal({ ...current, items }),
        warning,
    });
}

async function accounts(token) {
    const accounts = [];
    const failedItems = [];
    const syncedItemIds = [];
    for (const item of token.items) {
        try {
            const data = await plaidPost('/accounts/balance/get', {
                access_token: item.accessToken,
            });
            const itemAccounts = (data.accounts || []).map((acc) => ({
                id: `plaid-${acc.account_id}`,
                plaidItemId: item.itemId,
                name: acc.name,
                type:
                    acc.type === 'depository'
                        ? 'Cash'
                        : acc.type === 'investment'
                          ? 'Brokerage'
                          : 'Other',
                value: acc.balances?.current ?? 0,
                source: 'plaid',
            }));
            accounts.push(...itemAccounts);
            syncedItemIds.push(item.itemId);
        } catch (err) {
            recordItemFailure(failedItems, item.itemId, err);
        }
    }
    if (failedItems.length && !syncedItemIds.length) {
        throw Object.assign(
            new Error(
                'All Plaid account fetches failed. Existing data preserved.',
            ),
            { status: 502, failedItems },
        );
    }
    return {
        accounts,
        syncedItemIds,
        failedItems,
        warning: partialWarning(failedItems),
    };
}

async function positions(token) {
    const positions = [];
    const failedItems = [];
    const syncedItemIds = [];
    for (const item of token.items) {
        try {
            const data = await plaidPost('/investments/holdings/get', {
                access_token: item.accessToken,
            });
            const itemPositions = (data.holdings || []).map((holding) => {
                const security = data.securities?.find(
                    (s) => s.security_id === holding.security_id,
                );
                return {
                    symbol: security?.ticker_symbol || holding.security_id,
                    plaidItemId: item.itemId,
                    description: security?.name || '',
                    quantity: holding.quantity,
                    value: holding.institution_value,
                    costBasis: holding.cost_basis,
                    source: 'plaid',
                };
            });
            positions.push(...itemPositions);
            syncedItemIds.push(item.itemId);
        } catch (err) {
            recordItemFailure(failedItems, item.itemId, err);
        }
    }
    if (failedItems.length && !syncedItemIds.length) {
        throw Object.assign(
            new Error(
                'All Plaid position fetches failed. Existing data preserved.',
            ),
            { status: 502, failedItems },
        );
    }
    return {
        positions,
        syncedItemIds,
        failedItems,
        warning: partialWarning(failedItems),
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
            if (hasMore) {
                recordItemFailure(
                    failedItems,
                    item.itemId,
                    Object.assign(
                        new Error(
                            'Transaction pagination exceeded the safety limit.',
                        ),
                        { code: 'PAGINATION_LIMIT' },
                    ),
                );
                itemFailed = true;
            }
        } catch (err) {
            recordItemFailure(failedItems, item.itemId, err);
            itemFailed = true;
        }

        if (itemFailed) {
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
            { status: 502, failedItems },
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
        failedItems,
        warning: partialWarning(failedItems),
        syncedAt,
    };
}

// Netlify may hand the function either the original /api/sync/plaid/<x>
// URL or the rewritten /.netlify/functions/plaid/<x> one.
function routePath(pathname) {
    const fnPrefix = '/.netlify/functions/plaid';
    if (pathname.startsWith(fnPrefix))
        return `/sync/plaid${pathname.slice(fnPrefix.length)}`;
    return pathname.replace(/^\/api/, '') || '/';
}

async function readBody(req) {
    return req
        .clone()
        .json()
        .catch(() => ({}));
}

export default async function handler(req) {
    try {
        const misconfigured = configError();
        if (misconfigured) {
            console.error('[Netlify Plaid] not configured:', misconfigured);
            return json(503, { error: 'Hosted Plaid is not configured.' });
        }
        const url = new URL(req.url);
        const path = routePath(url.pathname);
        const method = req.method || 'GET';
        const origin = req.headers.get('origin');
        if (origin && origin !== url.origin) {
            return json(403, { error: 'Origin not allowed.' });
        }
        if (!hasAccess(req)) {
            return json(401, {
                error: 'Hosted Plaid access key required.',
                code: 'ACCESS_KEY_REQUIRED',
            });
        }

        if (path === '/sync/plaid/create-link-token' && method === 'POST') {
            if (!checkCreateLinkRateLimit(req)) {
                return json(429, {
                    error: 'Too many Plaid link-token requests. Slow down.',
                });
            }
            return await createLinkToken();
        }
        if (path === '/sync/plaid/exchange' && method === 'POST') {
            return await exchange(req);
        }
        if (path === '/sync/plaid/status' && method === 'GET') {
            const rawToken = tokenFromRequest(req, {});
            if (!rawToken) {
                return json(200, {
                    connected: false,
                    itemCount: 0,
                    lastTransactionsSync: null,
                    syncEnabled: true,
                    hosted: true,
                });
            }
            const token = await requireToken(req, {});
            return json(200, {
                connected: true,
                itemCount: token.items.length,
                lastTransactionsSync: token.transactionsLastSyncedAt || null,
                syncEnabled: true,
                hosted: true,
                plaidToken: seal(token),
            });
        }
        if (path === '/sync/plaid/accounts' && method === 'POST') {
            const token = await requireToken(req, await readBody(req));
            const result = await accounts(token);
            return json(200, {
                status: 'success',
                accountCount: result.accounts.length,
                accounts: result.accounts,
                syncedItemIds: result.syncedItemIds,
                failedItems: result.failedItems,
                warning: result.warning,
                plaidToken: seal(token),
            });
        }
        if (path === '/sync/plaid/positions' && method === 'POST') {
            const token = await requireToken(req, await readBody(req));
            const result = await positions(token);
            return json(200, {
                status: 'success',
                positionCount: result.positions.length,
                positions: result.positions,
                syncedItemIds: result.syncedItemIds,
                failedItems: result.failedItems,
                warning: result.warning,
                plaidToken: seal(token),
            });
        }
        if (path === '/sync/plaid/transactions' && method === 'POST') {
            const token = await requireToken(req, await readBody(req));
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
                failedItems: result.failedItems,
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
        // Only errors raised deliberately (with a status) carry a message
        // meant for the browser; anything else stays in the function log.
        if (!err.status)
            return json(500, { error: 'Hosted Plaid request failed.' });
        return json(err.status, {
            error: err.message,
            ...(err.code ? { code: err.code } : {}),
            ...(err.failedItems ? { failedItems: err.failedItems } : {}),
        });
    }
}
