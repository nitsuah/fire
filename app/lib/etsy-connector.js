'use strict';

// Etsy connector: Open API v3 OAuth 2.0 (authorization code + PKCE) and a
// read-only pull of the shop's paid receipts, mapped into Side Gig Ledger
// rows. Scopes are transactions_r (receipts) and shops_r (which shop).
// https://developer.etsy.com/documentation/essentials/authentication
//
// Shared by the Express routes (app/routes/etsy.js, which keep the tokens
// in the encrypted token store like eBay) and the Netlify Function
// (netlify/functions/etsy.mjs, which hands them to the browser sealed with
// SYNC_MASTER_KEY). Every outbound call takes an injectable fetch so tests
// never reach Etsy.

const crypto = require('crypto');
const { encrypt, decrypt } = require('./crypto-utils');

const AUTH_URL = 'https://www.etsy.com/oauth/connect';
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
const API_BASE = 'https://openapi.etsy.com/v3/application';
const SCOPE = 'transactions_r shops_r';
const CALLBACK_PATH = '/api/sync/etsy/callback';
const REQUEST_TIMEOUT_MS = 15 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;
// Refresh a little early so a token can't expire mid-sync.
const EXPIRY_SKEW_MS = 60 * 1000;
const PAGE_LIMIT = 100;
// 10 pages = 1,000 receipts per sync; later syncs only look back from the
// last sync, so this caps the first pull of a very large shop.
const MAX_PAGES = 10;
// Etsy's published US fee schedule, used to estimate each receipt's fees
// (receipts carry no fee data; the exact figures, incl. Etsy Ads and
// Offsite Ads, are on the shop's monthly statement).
const ETSY_FEES = {
    listing: 0.2,
    transactionRate: 0.065,
    processingRate: 0.03,
    processingFixed: 0.25,
};

function connectorError(message, code, status) {
    return Object.assign(new Error(message), { code, status });
}

function getEnv() {
    return {
        clientId: process.env.ETSY_CLIENT_ID || '',
        sharedSecret: process.env.ETSY_SHARED_SECRET || '',
        redirectUri: process.env.ETSY_REDIRECT_URI || '',
    };
}

// The keystring is a public client id (PKCE, no client secret in the token
// exchange). SYNC_MASTER_KEY is needed to seal the PKCE cookie and tokens.
function isConfigured() {
    return (
        Boolean(getEnv().clientId) &&
        /^[0-9a-f]{64}$/i.test(process.env.SYNC_MASTER_KEY || '')
    );
}

function redirectUriFor(origin) {
    return getEnv().redirectUri || `${origin}${CALLBACK_PATH}`;
}

// Etsy accepts the keystring alone, or "keystring:shared_secret" when the
// app has a shared secret (newer apps are required to send it).
function apiKeyHeader() {
    const { clientId, sharedSecret } = getEnv();
    return sharedSecret ? `${clientId}:${sharedSecret}` : clientId;
}

function createPkce() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');
    return { verifier, challenge };
}

function buildAuthorizationUrl({ redirectUri, state, challenge }) {
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
        response_type: 'code',
        client_id: getEnv().clientId,
        redirect_uri: redirectUri,
        scope: SCOPE,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
    }).toString();
    return url.toString();
}

function statesMatch(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (!a || a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// The PKCE verifier + CSRF state ride in a short-lived HttpOnly cookie,
// sealed so the browser can't read or forge them.
function sealPending({ state, verifier, redirectUri }) {
    return encodeURIComponent(
        encrypt(
            JSON.stringify({
                state,
                verifier,
                redirectUri,
                exp: Date.now() + PENDING_TTL_MS,
            }),
        ),
    );
}

function unsealPending(value) {
    if (!value) return null;
    try {
        const pending = JSON.parse(decrypt(decodeURIComponent(value)));
        if (!pending || !(pending.exp > Date.now())) return null;
        return pending;
    } catch {
        return null;
    }
}

function sealTokens(tokens) {
    return encrypt(JSON.stringify(tokens));
}

function unsealTokens(blob) {
    try {
        const tokens = JSON.parse(decrypt(String(blob)));
        if (!tokens?.access_token) throw new Error('no access token');
        return tokens;
    } catch {
        throw connectorError(
            'Stored Etsy connection is unreadable. Reconnect Etsy.',
            'etsy_token_invalid',
            401,
        );
    }
}

async function readJson(res) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : {};
    } catch {
        return { raw: text.slice(0, 200) };
    }
}

// Etsy access tokens are "<user_id>.<token>"; the prefix names the user.
function userIdFromToken(accessToken) {
    const prefix = String(accessToken || '').split('.')[0];
    return /^\d+$/.test(prefix) ? prefix : null;
}

function normalizeTokenResponse(body, previous = {}) {
    if (!body.access_token) {
        throw connectorError(
            'Etsy returned no access token.',
            'exchange_failed',
            502,
        );
    }
    const expiresIn = Number(body.expires_in);
    return {
        access_token: body.access_token,
        refresh_token: body.refresh_token || previous.refresh_token || null,
        expires_at: Number.isFinite(expiresIn)
            ? Date.now() + expiresIn * 1000
            : null,
        user_id: userIdFromToken(body.access_token) || previous.user_id || null,
        shop_id: previous.shop_id || null,
        shop_name: previous.shop_name || null,
        connected_at: previous.connected_at || new Date().toISOString(),
    };
}

async function tokenRequest(params, fetchImpl) {
    const res = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await readJson(res);
    if (!res.ok) {
        const revoked = body.error === 'invalid_grant';
        throw connectorError(
            revoked
                ? 'Etsy access was revoked or has expired. Reconnect Etsy to sync again.'
                : `Etsy token request failed (HTTP ${res.status}).`,
            revoked ? 'etsy_revoked' : 'token_request_failed',
            revoked ? 401 : 502,
        );
    }
    return body;
}

async function exchangeCode(
    { code, verifier, redirectUri },
    fetchImpl = fetch,
) {
    const body = await tokenRequest(
        {
            grant_type: 'authorization_code',
            client_id: getEnv().clientId,
            redirect_uri: redirectUri,
            code,
            code_verifier: verifier,
        },
        fetchImpl,
    );
    return normalizeTokenResponse(body);
}

async function refreshTokens(tokens, fetchImpl = fetch) {
    if (!tokens.refresh_token) {
        throw connectorError(
            'Etsy connection has no refresh token. Reconnect Etsy.',
            'etsy_revoked',
            401,
        );
    }
    const body = await tokenRequest(
        {
            grant_type: 'refresh_token',
            client_id: getEnv().clientId,
            refresh_token: tokens.refresh_token,
        },
        fetchImpl,
    );
    return normalizeTokenResponse(body, tokens);
}

async function apiGet(path, accessToken, fetchImpl) {
    const res = await fetchImpl(`${API_BASE}${path}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'x-api-key': apiKeyHeader(),
            Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await readJson(res);
    if (!res.ok) {
        throw connectorError(
            `Etsy API ${path.split('?')[0]} failed (HTTP ${res.status}).`,
            res.status === 401 ? 'unauthorized' : 'etsy_api_failed',
            res.status,
        );
    }
    return body;
}

// {amount: 1234, divisor: 100} -> 12.34
function money(m) {
    if (!m || typeof m !== 'object') return 0;
    const amount = Number(m.amount);
    const divisor = Number(m.divisor) || 100;
    return Number.isFinite(amount) ? amount / divisor : 0;
}

const round2 = (n) => Math.round(n * 100) / 100;

function receiptDate(receipt) {
    const ts = Number(receipt.create_timestamp ?? receipt.created_timestamp);
    return Number.isFinite(ts) && ts > 0
        ? new Date(ts * 1000).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
}

// Ids of ledger rows the receipts sync created (exactly `etsy-<receiptId>`),
// as opposed to manual or calculator-logged Etsy sales.
function isApiSyncedEtsyEntry(entry) {
    return (
        Boolean(entry?.etsyReceiptId) &&
        entry.id === `etsy-${entry.etsyReceiptId}`
    );
}

const SKIPPED_STATUSES = new Set(['canceled', 'cancelled', 'fully refunded']);

// One ledger row per paid receipt. Revenue is what the buyer paid minus the
// sales tax/VAT Etsy collects and remits (not your income) and any partial
// refund. Fees are estimated from Etsy's fee schedule and flagged.
// basisType is left unset for the user to tag.
function receiptToLedgerEntry(receipt) {
    const receiptId = receipt?.receipt_id;
    if (!receiptId) return null;
    if (receipt.is_paid === false) return null;
    const status = String(receipt.status || '').toLowerCase();
    if (SKIPPED_STATUSES.has(status)) return null;

    const grandtotal = money(receipt.grandtotal);
    const tax = money(receipt.total_tax_cost) + money(receipt.total_vat_cost);
    const refunded = (receipt.refunds || []).reduce(
        (sum, r) => sum + money(r.amount),
        0,
    );
    const revenue = round2(Math.max(0, grandtotal - tax - refunded));
    const transactions = receipt.transactions || [];
    const quantity =
        transactions.reduce((n, t) => n + (Number(t.quantity) || 1), 0) || 1;
    const fees = round2(
        ETSY_FEES.listing * quantity +
            revenue * ETSY_FEES.transactionRate +
            (grandtotal > 0
                ? grandtotal * ETSY_FEES.processingRate +
                  ETSY_FEES.processingFixed
                : 0),
    );
    const title = transactions[0]?.title || `Etsy order ${receiptId}`;
    const more =
        transactions.length > 1 ? ` (+${transactions.length - 1} more)` : '';
    return {
        id: `etsy-${receiptId}`,
        date: receiptDate(receipt),
        desc: `${title}${more}`,
        category: 'Etsy',
        revenue,
        expenses: fees,
        net: round2(revenue - fees),
        qty: quantity,
        etsyReceiptId: String(receiptId),
        feesEstimated: true,
    };
}

function receiptsToLedgerEntries(receipts) {
    return (receipts || []).map(receiptToLedgerEntry).filter(Boolean);
}

function needsRefresh(tokens) {
    return Boolean(
        tokens.expires_at && tokens.expires_at - EXPIRY_SKEW_MS <= Date.now(),
    );
}

// Pulls paid receipts (optionally only those created at/after `since`, an
// ISO date) and maps them to ledger entries. Refreshes the access token
// when it's expired or rejected once. Returns {entries, tokens, changed,
// truncated, resumeFrom}.
// Throws code 'etsy_revoked' (status 401) when the grant is dead.
async function syncReceipts(tokens, { since } = {}, fetchImpl = fetch) {
    let current = { ...tokens };
    let refreshed = false;
    const refresh = async () => {
        current = await refreshTokens(current, fetchImpl);
        refreshed = true;
    };
    if (needsRefresh(current)) await refresh();

    const call = async (path) => {
        try {
            return await apiGet(path, current.access_token, fetchImpl);
        } catch (err) {
            if (err.status !== 401 || refreshed) throw err;
            await refresh();
            return apiGet(path, current.access_token, fetchImpl);
        }
    };

    try {
        if (!current.shop_id) {
            const me = await call('/users/me');
            if (!me.shop_id) {
                throw connectorError(
                    'This Etsy account has no shop to sync.',
                    'etsy_no_shop',
                    404,
                );
            }
            current.shop_id = String(me.shop_id);
            current.user_id = String(me.user_id || current.user_id || '');
        }
        const minCreated = since ? Math.floor(Date.parse(since) / 1000) : NaN;
        // Oldest first, so a sync that stops at MAX_PAGES can resume from
        // the newest receipt it saw instead of skipping the rest.
        const receipts = [];
        let truncated = false;
        for (let page = 0; page < MAX_PAGES; page++) {
            const params = new URLSearchParams({
                limit: String(PAGE_LIMIT),
                offset: String(page * PAGE_LIMIT),
                was_paid: 'true',
                sort_on: 'created',
                sort_order: 'asc',
            });
            if (Number.isFinite(minCreated))
                params.set('min_created', String(minCreated));
            const body = await call(
                `/shops/${encodeURIComponent(current.shop_id)}/receipts?${params}`,
            );
            const results = body.results || [];
            receipts.push(...results);
            if (results.length < PAGE_LIMIT) break;
            if (page === MAX_PAGES - 1) truncated = true;
        }
        const newest = Math.max(
            0,
            ...receipts.map(
                (r) => Number(r.create_timestamp ?? r.created_timestamp) || 0,
            ),
        );
        return {
            entries: receiptsToLedgerEntries(receipts),
            // More receipts remain: the next sync must start at `resumeFrom`
            // (not at "last sync − lookback"), or the rest are never read.
            truncated,
            resumeFrom:
                truncated && newest
                    ? new Date(newest * 1000).toISOString()
                    : null,
            tokens: current,
            // True when the caller must persist `tokens` (refreshed, or the
            // shop id was looked up for the first time).
            changed: refreshed || current.shop_id !== tokens.shop_id,
        };
    } catch (err) {
        // A token refreshed before the failure must still be kept: Etsy
        // rotates refresh tokens, so the caller's old copy is now dead.
        if (refreshed) err.tokens = current;
        throw err;
    }
}

module.exports = {
    SCOPE,
    ETSY_FEES,
    getEnv,
    isConfigured,
    redirectUriFor,
    createPkce,
    buildAuthorizationUrl,
    statesMatch,
    sealPending,
    unsealPending,
    sealTokens,
    unsealTokens,
    exchangeCode,
    refreshTokens,
    receiptToLedgerEntry,
    receiptsToLedgerEntries,
    syncReceipts,
    isApiSyncedEtsyEntry,
};
