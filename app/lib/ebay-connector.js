'use strict';

const crypto = require('crypto');

const EBAY_SANDBOX_BASE = 'https://api.sandbox.ebay.com';
const EBAY_PROD_BASE = 'https://api.ebay.com';
const EBAY_SANDBOX_AUTH = 'https://auth.sandbox.ebay.com';
const EBAY_PROD_AUTH = 'https://auth.ebay.com';
const EBAY_SCOPE =
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly';

function getEnv() {
    return {
        clientId: process.env.EBAY_CLIENT_ID || '',
        clientSecret: process.env.EBAY_CLIENT_SECRET || '',
        refreshToken: process.env.EBAY_REFRESH_TOKEN || '',
        environment: (process.env.EBAY_ENVIRONMENT || 'sandbox').toLowerCase(),
    };
}

function isConfigured() {
    const { clientId, clientSecret } = getEnv();
    return Boolean(clientId && clientSecret);
}

function getBaseUrls() {
    const { environment } = getEnv();
    if (environment === 'production') {
        return { api: EBAY_PROD_BASE, auth: EBAY_PROD_AUTH };
    }
    return { api: EBAY_SANDBOX_BASE, auth: EBAY_SANDBOX_AUTH };
}

function buildAuthorizationUrl(redirectUri, state) {
    const { clientId } = getEnv();
    const { auth } = getBaseUrls();
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: EBAY_SCOPE,
        state,
    });
    return `${auth}/oauth2/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(code, redirectUri) {
    const { clientId, clientSecret } = getEnv();
    const { api } = getBaseUrls();
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
        'base64',
    );
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
    });
    const res = await fetch(`${api}/identity/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${credentials}`,
        },
        body: body.toString(),
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`eBay token exchange failed (${res.status}): ${text}`);
    }
    return res.json();
}

async function refreshAccessToken(storedRefreshToken) {
    const { clientId, clientSecret } = getEnv();
    const { api } = getBaseUrls();
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
        'base64',
    );
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: storedRefreshToken,
        scope: EBAY_SCOPE,
    });
    const res = await fetch(`${api}/identity/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${credentials}`,
        },
        body: body.toString(),
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`eBay token refresh failed (${res.status}): ${text}`);
    }
    return res.json();
}

async function fetchCompletedOrders(
    accessToken,
    { limit = 50, offset = 0 } = {},
) {
    const { api } = getBaseUrls();
    const params = new URLSearchParams({
        filter: 'orderfulfillmentstatus:{FULFILLED}',
        limit: String(limit),
        offset: String(offset),
    });
    const res = await fetch(`${api}/sell/fulfillment/v1/order?${params}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
        const text = await res.text();
        const err = new Error(`eBay Order API failed (${res.status}): ${text}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

function ordersToLedgerEntries(orders) {
    const entries = [];
    const toAmount = (raw) => {
        const parsed = parseFloat(raw);
        return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
    };
    for (const order of orders?.orders || []) {
        const orderId = order.orderId;
        if (!orderId) continue;
        const saleDate =
            order.creationDate?.split('T')[0] ||
            new Date().toISOString().split('T')[0];
        const gross = toAmount(order.pricingSummary?.total?.value);
        const fees = toAmount(order.pricingSummary?.fee?.value);
        const net = Math.round((gross - fees) * 100) / 100;
        const title = order.lineItems?.[0]?.title || 'eBay sale';
        entries.push({
            id: `ebay-${orderId}`,
            platform: 'eBay',
            date: saleDate,
            description: title,
            gross,
            fees,
            net,
            orderId,
        });
    }
    return entries;
}

// eBay's Marketplace Account Deletion challenge-response handshake: eBay
// calls back with a `challenge_code` and expects
// sha256(challengeCode + verificationToken + notificationEndpoint) hex-
// encoded, proving this endpoint knows the same verification token
// registered in the eBay Developer Portal for it.
// https://developer.ebay.com/marketplace-account-deletion
function computeMarketplaceDeletionChallengeResponse(
    challengeCode,
    verificationToken,
    endpoint,
) {
    return crypto
        .createHash('sha256')
        .update(challengeCode + verificationToken + endpoint)
        .digest('hex');
}

// ─── Notification signature verification ─────────────────────────────────────
// eBay signs every Notification API push (incl. Marketplace Account
// Deletion) with an `X-EBAY-SIGNATURE` header: base64-encoded JSON
// {alg, kid, signature, digest}. The public key for `kid` comes from
// GET /commerce/notification/v1/public_key/{kid}, which needs an
// application (client-credentials) access token. Keys are cached per kid,
// matching eBay's own event-notification SDKs (1h TTL).
// https://developer.ebay.com/api-docs/commerce/notification/resources/public_key/methods/getPublicKey
const APP_SCOPE = 'https://api.ebay.com/oauth/api_scope';
const PUBLIC_KEY_TTL_MS = 60 * 60 * 1000;
const SUPPORTED_SIGNATURE_ALGS = new Set(['ECDSA']);
const SUPPORTED_DIGESTS = { SHA1: 'sha1', SHA256: 'sha256' };

// Both caches hold {promise, expiresAt} entries stored *before* the request
// resolves, so concurrent cold-cache notifications share one outbound call.
// A pending entry never expires; on success its expiresAt is set, on
// failure it's evicted only if it's still the current entry (a reset or a
// newer request may have replaced it).
let appTokenEntry = null;
const publicKeyCache = new Map();

function resetNotificationKeyCache() {
    appTokenEntry = null;
    publicKeyCache.clear();
}

function getApplicationAccessToken() {
    if (appTokenEntry && appTokenEntry.expiresAt > Date.now()) {
        return appTokenEntry.promise;
    }
    const entry = { promise: null, expiresAt: Infinity };
    entry.promise = requestApplicationAccessToken().then(
        ({ token, ttlMs }) => {
            entry.expiresAt = Date.now() + ttlMs;
            return token;
        },
        (err) => {
            if (appTokenEntry === entry) appTokenEntry = null;
            throw err;
        },
    );
    appTokenEntry = entry;
    return entry.promise;
}

async function requestApplicationAccessToken() {
    const { clientId, clientSecret } = getEnv();
    const { api } = getBaseUrls();
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
        'base64',
    );
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        scope: APP_SCOPE,
    });
    const res = await fetch(`${api}/identity/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${credentials}`,
        },
        body: body.toString(),
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(
            `eBay application token request failed (${res.status}): ${text}`,
        );
    }
    const json = await res.json();
    // Refresh a minute early so a token never expires mid-request.
    const ttlMs = Math.max(0, (Number(json.expires_in) || 0) - 60) * 1000;
    return { token: json.access_token, ttlMs };
}

// eBay returns the PEM on a single line ("-----BEGIN PUBLIC KEY-----MFkw...");
// decode the base64 body as DER/SPKI instead of relying on PEM line wrapping.
function parseEbayPublicKey(pem) {
    const b64 = String(pem)
        .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '')
        .replace(/\s+/g, '');
    return crypto.createPublicKey({
        key: Buffer.from(b64, 'base64'),
        format: 'der',
        type: 'spki',
    });
}

// Resolves to {key, algorithm, digest}, or null when eBay doesn't know the
// kid (404). Any other failure throws, so callers can distinguish "forged
// notification" (4xx) from "we couldn't check right now" (5xx → eBay retries).
function fetchNotificationPublicKey(kid) {
    const cached = publicKeyCache.get(kid);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;

    const entry = { promise: null, expiresAt: Infinity };
    const evict = () => {
        if (publicKeyCache.get(kid) === entry) publicKeyCache.delete(kid);
    };
    entry.promise = requestNotificationPublicKey(kid).then(
        (value) => {
            // Don't cache unknown kids; only real keys get the TTL.
            if (value) entry.expiresAt = Date.now() + PUBLIC_KEY_TTL_MS;
            else evict();
            return value;
        },
        (err) => {
            evict();
            throw err;
        },
    );
    publicKeyCache.set(kid, entry);
    return entry.promise;
}

async function requestNotificationPublicKey(kid) {
    const token = await getApplicationAccessToken();
    const { api } = getBaseUrls();
    const res = await fetch(
        `${api}/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`,
        {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15000),
        },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
        const text = await res.text();
        throw new Error(
            `eBay public key lookup failed (${res.status}): ${text}`,
        );
    }
    const json = await res.json();
    return {
        key: parseEbayPublicKey(json.key),
        algorithm: String(json.algorithm || '').toUpperCase(),
        digest: String(json.digest || '').toUpperCase(),
    };
}

function decodeSignatureHeader(header) {
    if (!header || typeof header !== 'string') return null;
    try {
        const parsed = JSON.parse(
            Buffer.from(header, 'base64').toString('utf8'),
        );
        if (
            !parsed ||
            typeof parsed.kid !== 'string' ||
            !parsed.kid ||
            typeof parsed.signature !== 'string' ||
            !parsed.signature
        ) {
            return null;
        }
        return {
            alg: String(parsed.alg || '').toUpperCase(),
            kid: parsed.kid,
            signature: parsed.signature,
            digest: String(parsed.digest || '').toUpperCase(),
        };
    } catch {
        return null;
    }
}

// Verifies an eBay notification's X-EBAY-SIGNATURE over the exact raw
// request bytes. eBay's own SDKs verify over JSON.stringify(parsed body)
// instead, so when `parsedBody` is given and the raw bytes don't verify,
// its compact re-serialization is tried too (only if it differs). Returns {valid: true} or {valid: false, reason}; throws
// only when the key couldn't be fetched for reasons other than an unknown
// kid (network/5xx/auth), which the caller should surface as a 5xx.
async function verifyNotificationSignature(
    rawBody,
    signatureHeader,
    parsedBody,
) {
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
        return { valid: false, reason: 'missing body' };
    }
    const sig = decodeSignatureHeader(signatureHeader);
    if (!sig)
        return {
            valid: false,
            reason: 'missing or malformed signature header',
        };
    if (!SUPPORTED_SIGNATURE_ALGS.has(sig.alg)) {
        return { valid: false, reason: 'unsupported signature algorithm' };
    }
    const hash = SUPPORTED_DIGESTS[sig.digest];
    if (!hash) return { valid: false, reason: 'unsupported digest' };

    const publicKey = await fetchNotificationPublicKey(sig.kid);
    if (!publicKey) return { valid: false, reason: 'unknown key id' };
    if (
        publicKey.algorithm !== sig.alg ||
        (publicKey.digest && publicKey.digest !== sig.digest)
    ) {
        return { valid: false, reason: 'key/algorithm mismatch' };
    }

    const signature = Buffer.from(sig.signature, 'base64');
    const verifies = (bytes) => {
        try {
            return crypto.verify(hash, bytes, publicKey.key, signature);
        } catch {
            return false;
        }
    };
    let ok = verifies(rawBody);
    if (!ok && parsedBody !== undefined) {
        const canonical = Buffer.from(JSON.stringify(parsedBody));
        ok = !canonical.equals(rawBody) && verifies(canonical);
    }
    return ok
        ? { valid: true }
        : { valid: false, reason: 'signature mismatch' };
}

module.exports = {
    getEnv,
    isConfigured,
    buildAuthorizationUrl,
    exchangeCodeForTokens,
    refreshAccessToken,
    fetchCompletedOrders,
    ordersToLedgerEntries,
    computeMarketplaceDeletionChallengeResponse,
    verifyNotificationSignature,
    resetNotificationKeyCache,
};
