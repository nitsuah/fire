'use strict';

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
    const { clientId, environment } = getEnv();
    const { auth } = getBaseUrls();
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: EBAY_SCOPE,
        state,
    });
    const path =
        environment === 'production'
            ? '/oauth2/authorize'
            : '/oauth2/authorize';
    return `${auth}${path}?${params.toString()}`;
}

async function exchangeCodeForTokens(code, redirectUri) {
    const { clientId, clientSecret } = getEnv();
    const { auth } = getBaseUrls();
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
        'base64',
    );
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
    });
    const res = await fetch(`${auth}/identity/v1/oauth2/token`, {
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
    const { auth } = getBaseUrls();
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
        'base64',
    );
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: storedRefreshToken,
        scope: EBAY_SCOPE,
    });
    const res = await fetch(`${auth}/identity/v1/oauth2/token`, {
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
        throw new Error(`eBay Order API failed (${res.status}): ${text}`);
    }
    return res.json();
}

function ordersToLedgerEntries(orders) {
    const entries = [];
    for (const order of orders?.orders || []) {
        const orderId = order.orderId;
        const saleDate =
            order.creationDate?.split('T')[0] ||
            new Date().toISOString().split('T')[0];
        const gross = parseFloat(order.pricingSummary?.total?.value || '0');
        const fees = parseFloat(order.pricingSummary?.fee?.value || '0');
        const net = gross - fees;
        const title = order.lineItems?.[0]?.title || 'eBay sale';
        entries.push({
            id: `ebay-${orderId}`,
            platform: 'eBay',
            date: saleDate,
            description: title,
            gross: Math.round(gross * 100) / 100,
            fees: Math.round(fees * 100) / 100,
            net: Math.round(net * 100) / 100,
            orderId,
        });
    }
    return entries;
}

module.exports = {
    isConfigured,
    buildAuthorizationUrl,
    exchangeCodeForTokens,
    refreshAccessToken,
    fetchCompletedOrders,
    ordersToLedgerEntries,
};
