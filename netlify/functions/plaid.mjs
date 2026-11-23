import crypto from '../../app/lib/node-crypto.js';
import plaidStatus from '../../app/lib/plaid-status.js';
import plaid from '../../app/lib/plaid-service.js';
import grant from '../../app/lib/grant-cookie.js';
import { withCookies } from '../lib/http.mjs';

// Hosted adapter: the Plaid operations live in app/lib/plaid-service.js
// (shared with the Express routes in app/routes/plaid.js). This function
// only decides where things are kept: the Items' access tokens are sealed
// (AES-256-GCM under SYNC_MASTER_KEY) into an HttpOnly grant cookie, and the
// synced rows go back to the browser, which owns its state on this deploy.

const { reauthRequired } = plaidStatus;

const PLAID_TOKEN_VERSION = 1;
// Rolling expiry: every response re-seals the token, so this only locks out
// a browser that has been idle for the whole window.
const PLAID_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
// The sealed token lives in HttpOnly cookies scoped to the Plaid routes
// (app/lib/grant-cookie.js); the browser keeps only the `cookie` marker.
const GRANT = 'plaid_grant';
const GRANT_PATH = '/api/sync/plaid';

function json(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
        },
    });
}

// Returns why hosted Plaid cannot run, or null when it is fully configured.
// Checked before any Plaid call so a missing key never strands a linked Item.
function configError() {
    if (!plaid.plaidConfigured())
        return 'PLAID_CLIENT_ID and PLAID_SECRET are required.';
    if (!/^[0-9a-f]{64}$/i.test(process.env.SYNC_MASTER_KEY || ''))
        return 'SYNC_MASTER_KEY must be 64 hex characters.';
    if (!process.env.PLAID_HOSTED_ACCESS_KEY && plaid.plaidEnv() !== 'sandbox')
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

// The sealed token: the grant cookie, or a token a browser from before the
// cookie move still sends (body or x-fire-plaid-token). A bare marker with no
// cookie means the grant is gone (cleared or expired): the browser should drop it.
function tokenFromRequest(req, body) {
    const legacy =
        body?.plaidToken || req.headers.get('x-fire-plaid-token') || '';
    const picked = grant.pickGrant(req.headers.get('cookie'), GRANT, legacy, {
        raw: true,
    });
    if (!picked.sealed && legacy === grant.GRANT_MARKER)
        throw invalidTokenError();
    return picked.sealed || '';
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

async function exchange(req) {
    const body = await req.json().catch(() => ({}));
    if (!body.public_token)
        return json(400, { error: 'public_token is required.' });
    if (!plaid.isValidPublicToken(body.public_token))
        return json(400, { error: 'A valid public_token is required.' });
    // An unreadable saved token must not block linking: start a fresh item
    // list instead of consuming (and losing) the one-time public_token.
    let current = { items: [] };
    let warning = null;
    let prior = '';
    try {
        prior = tokenFromRequest(req, body);
    } catch (err) {
        if (err.code !== 'INVALID_TOKEN') throw err;
    }
    if (prior) {
        try {
            current = unseal(prior);
        } catch (err) {
            if (err.code !== 'INVALID_TOKEN') throw err;
            warning =
                'Your previous Plaid connection could not be read and was replaced. Re-link any other institutions.';
        }
    }
    const item = await plaid.exchangePublicToken(body.public_token);
    return json(200, {
        status: 'success',
        message: 'Plaid connection encrypted for this browser.',
        itemId: item.itemId,
        plaidToken: seal({
            ...current,
            items: plaid.upsertItem(current.items, item),
        }),
        warning,
    });
}

async function transactions(token) {
    const result = await plaid.syncTransactions(token.items);
    if (result.allFailed) {
        // The sealed token is the only store on this deploy, so the failure
        // outcome reaches status by riding along with this error (#293).
        throw Object.assign(
            new Error(
                'All Plaid transaction fetches failed. Existing data preserved.',
            ),
            {
                status: 502,
                failedItems: result.failedItems,
                plaidToken: seal({
                    ...token,
                    items: result.items,
                    transactionsLastSync: result.outcome,
                }),
            },
        );
    }
    const syncedAt = result.outcome.at;
    // Only what the response needs: result.items carries access tokens.
    return {
        transactions: result.transactions,
        failedItems: result.failedItems,
        syncedAt,
        warning: plaid.partialWarning(result.failedItems),
        plaidToken: seal({
            ...token,
            items: result.items,
            transactionsLastSyncedAt: syncedAt,
            transactionsLastSync: result.outcome,
        }),
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

// Every response that carries a sealed token stores it in the grant cookie and
// hands the browser only the marker; a dead token clears the cookie.
export default async function handler(req) {
    const res = await route(req);
    const secure = new URL(req.url).protocol === 'https:';
    let body;
    try {
        body = await res.clone().json();
    } catch {
        return res;
    }
    if (res.status === 401 && body?.code === 'INVALID_TOKEN')
        return withCookies(
            res,
            grant.clearGrantCookies(GRANT, GRANT_PATH, { secure }),
        );
    const sealed = body?.plaidToken;
    if (typeof sealed !== 'string' || !sealed || sealed === grant.GRANT_MARKER)
        return res;
    let cookies;
    try {
        cookies = grant.grantCookies(GRANT, GRANT_PATH, sealed, {
            secure,
            raw: true,
        });
    } catch (err) {
        console.error('[Netlify Plaid] cannot store token:', err.message);
        return json(500, { error: 'Hosted Plaid request failed.' });
    }
    return withCookies(
        json(res.status, { ...body, plaidToken: grant.GRANT_MARKER }),
        cookies,
    );
}

async function route(req) {
    try {
        const url = new URL(req.url);
        const path = routePath(url.pathname);
        const method = req.method || 'GET';
        const origin = req.headers.get('origin');
        if (origin && origin !== url.origin) {
            return json(403, { error: 'Origin not allowed.' });
        }
        const misconfigured = configError();
        if (misconfigured) {
            console.error('[Netlify Plaid] not configured:', misconfigured);
            // Status is the one endpoint that must still answer: a deploy
            // with no credentials has to read as "not configured", not as
            // an error or as an ordinary "not linked" (#293).
            if (path === '/sync/plaid/status' && method === 'GET') {
                return json(200, {
                    connected: false,
                    configured: false,
                    itemCount: 0,
                    lastTransactionsSync: null,
                    lastSync: null,
                    reauthRequired: false,
                    syncEnabled: true,
                    hosted: true,
                });
            }
            return json(503, { error: 'Hosted Plaid is not configured.' });
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
            return json(200, { linkToken: await plaid.createLinkToken() });
        }
        if (path === '/sync/plaid/exchange' && method === 'POST') {
            return await exchange(req);
        }
        if (path === '/sync/plaid/status' && method === 'GET') {
            const rawToken = tokenFromRequest(req, {});
            if (!rawToken) {
                return json(200, {
                    connected: false,
                    configured: true,
                    itemCount: 0,
                    lastTransactionsSync: null,
                    lastSync: null,
                    reauthRequired: false,
                    syncEnabled: true,
                    hosted: true,
                });
            }
            const token = await requireToken(req, {});
            return json(200, {
                connected: true,
                configured: true,
                itemCount: token.items.length,
                lastTransactionsSync: token.transactionsLastSyncedAt || null,
                lastSync: token.transactionsLastSync || null,
                // The grant is dead: say so instead of reporting a healthy
                // "Connected" that can never sync again (#293).
                reauthRequired: reauthRequired(token.items),
                syncEnabled: true,
                hosted: true,
                plaidToken: seal(token),
            });
        }
        if (path === '/sync/plaid/accounts' && method === 'POST') {
            const token = await requireToken(req, await readBody(req));
            const result = await plaid.fetchAccounts(token.items);
            return json(200, {
                status: 'success',
                accountCount: result.accounts.length,
                accounts: result.accounts,
                syncedItemIds: result.syncedItemIds,
                failedItems: result.failedItems,
                warning: plaid.partialWarning(result.failedItems),
                plaidToken: seal(token),
            });
        }
        if (path === '/sync/plaid/positions' && method === 'POST') {
            const token = await requireToken(req, await readBody(req));
            const result = await plaid.fetchPositions(token.items);
            return json(200, {
                status: 'success',
                positionCount: result.positions.length,
                positions: result.positions,
                syncedItemIds: result.syncedItemIds,
                failedItems: result.failedItems,
                warning: plaid.partialWarning(result.failedItems),
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
            // The hosted deploy keeps this setting in the browser; the
            // function only validates and echoes it, like the Express route.
            const body = await req.json().catch(() => ({}));
            if (typeof body.enabled !== 'boolean')
                return json(400, { error: 'enabled (boolean) is required.' });
            return json(200, { enabled: body.enabled, hosted: true });
        }
        return json(404, { error: 'Hosted Plaid endpoint not found.' });
    } catch (err) {
        // A deliberate error can carry a sealed token (plaidToken): log only
        // its status, code and generic message, never the object.
        if (err.status)
            console.error(
                `[Netlify Plaid] request failed: ${err.status} ${err.code || ''} ${err.message}`,
            );
        else console.error('[Netlify Plaid] request failed:', err);
        // Only errors raised deliberately (with a status) carry a message
        // meant for the browser; anything else stays in the function log.
        if (!err.status)
            return json(500, { error: 'Hosted Plaid request failed.' });
        return json(err.status, {
            error: err.message,
            ...(err.code ? { code: err.code } : {}),
            ...(err.failedItems ? { failedItems: err.failedItems } : {}),
            ...(err.plaidToken ? { plaidToken: err.plaidToken } : {}),
        });
    }
}
