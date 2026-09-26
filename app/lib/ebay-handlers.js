'use strict';

// Transport-agnostic eBay handlers shared by the Express routes
// (app/routes/sync.js, self-hosted) and the Netlify Functions
// (netlify/functions/*, browser-only deploy). Each returns
// {status, body} (plus extra fields where noted) and never touches
// req/res, so both runtimes wrap the same logic.

const {
    isConfigured,
    refreshAccessToken,
    fetchCompletedOrders,
    ordersToLedgerEntries,
    computeMarketplaceDeletionChallengeResponse,
    verifyNotificationSignature,
} = require('./ebay-connector');

// eBay's Verification Token rule: 32-80 chars of [A-Za-z0-9_-].
const VERIFICATION_TOKEN_RE = /^[A-Za-z0-9_-]{32,80}$/;

// GET leg of Marketplace Account Deletion: the challenge-response
// handshake. Missing config is a 5xx (not a hash of an empty token) so a
// misconfigured deploy fails eBay's validation loudly.
function handleDeletionChallenge({
    challengeCode,
    verificationToken,
    endpoint,
    missingConfigStatus = 500,
}) {
    if (!verificationToken || !endpoint) {
        const missing = [
            !verificationToken && 'EBAY_VERIFICATION_TOKEN',
            !endpoint && 'EBAY_NOTIFICATION_ENDPOINT_URL',
        ]
            .filter(Boolean)
            .join(', ');
        console.error(
            `[eBay] Marketplace deletion challenge refused: ${missing} not configured.`,
        );
        return {
            status: missingConfigStatus,
            body: { error: `${missing} is not configured.` },
        };
    }
    if (!VERIFICATION_TOKEN_RE.test(verificationToken)) {
        console.error(
            '[eBay] Marketplace deletion challenge refused: EBAY_VERIFICATION_TOKEN must be 32-80 chars of [A-Za-z0-9_-].',
        );
        return {
            status: missingConfigStatus,
            body: { error: 'EBAY_VERIFICATION_TOKEN is invalid.' },
        };
    }
    if (!challengeCode || typeof challengeCode !== 'string') {
        return { status: 400, body: { error: 'Missing challenge_code.' } };
    }
    return {
        status: 200,
        body: {
            challengeResponse: computeMarketplaceDeletionChallengeResponse(
                challengeCode,
                verificationToken,
                endpoint,
            ),
        },
    };
}

// POST leg: a MARKETPLACE_ACCOUNT_DELETION notification. The signature is
// checked first whenever app credentials exist. `purge` is the runtime's
// cleanup (Express: delete stored tokens + disable sync) and must throw on
// failure so eBay retries. With no purge (browser-only deploy: the server
// holds no eBay user data) `allowUnsigned` lets an unverifiable
// notification be acked: nothing is deleted, so a forged one is harmless.
// Logs carry only topic/notificationId — never username/userId/eiasToken.
async function handleDeletionNotification({
    rawBody,
    signatureHeader,
    body,
    purge,
    allowUnsigned = false,
}) {
    if (isConfigured()) {
        let verification;
        try {
            verification = await verifyNotificationSignature(
                rawBody,
                signatureHeader,
                body,
            );
        } catch (err) {
            console.error(
                '[eBay] Notification signature check failed:',
                err.message,
            );
            return {
                status: 503,
                body: { error: 'Signature verification unavailable.' },
            };
        }
        if (!verification.valid) {
            console.warn(
                `[eBay] Rejected account deletion notification: ${verification.reason}.`,
            );
            return { status: 412, body: { error: 'Invalid eBay signature.' } };
        }
    } else if (!allowUnsigned) {
        return {
            status: 503,
            body: {
                error: 'eBay not configured. Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.',
            },
        };
    }
    const topic = body?.metadata?.topic;
    const notification = body?.notification;
    if (topic !== 'MARKETPLACE_ACCOUNT_DELETION' || !notification) {
        return {
            status: 400,
            body: { error: 'Malformed account deletion notification.' },
        };
    }
    const id = notification.notificationId || 'unknown';
    if (purge) {
        console.log(
            `[eBay] ${topic} received (notificationId=${id}). Purging locally stored eBay tokens and disabling sync.`,
        );
        try {
            await purge();
        } catch (err) {
            console.error('[eBay] Account deletion cleanup failed:', err);
            return { status: 500, body: { error: 'Cleanup failed.' } };
        }
    } else {
        console.log(
            `[eBay] ${topic} received (notificationId=${id}). No server-side eBay data to purge.`,
        );
    }
    return { status: 200, body: { status: 'acknowledged' } };
}

// A refresh-token rejection means the user revoked access or closed their
// eBay account: the stored grant is dead and must be discarded.
function isRevokedGrantError(err) {
    return (
        (err?.status === 400 || err?.status === 401) &&
        /invalid_grant/i.test(err?.body || err?.message || '')
    );
}

// Fetches completed orders with `tokens`, refreshing once on 401/403.
// Returns {entries, tokens, refreshed}. Throws an error with
// code 'ebay_revoked' when the refresh token itself is rejected.
async function syncOrders(tokens) {
    let current = tokens;
    let refreshed = false;
    let orders;
    try {
        orders = await fetchCompletedOrders(current.access_token);
    } catch (err) {
        if (err.status !== 401 && err.status !== 403) throw err;
        try {
            current = {
                ...current,
                ...(await refreshAccessToken(current.refresh_token)),
            };
        } catch (refreshErr) {
            if (isRevokedGrantError(refreshErr)) {
                const revoked = new Error(
                    'eBay authorization was revoked or the eBay account was closed. Reconnect eBay to sync again.',
                );
                revoked.code = 'ebay_revoked';
                throw revoked;
            }
            throw refreshErr;
        }
        refreshed = true;
        orders = await fetchCompletedOrders(current.access_token);
    }
    return {
        entries: ordersToLedgerEntries(orders),
        tokens: current,
        refreshed,
    };
}

module.exports = {
    handleDeletionChallenge,
    handleDeletionNotification,
    isRevokedGrantError,
    syncOrders,
};
