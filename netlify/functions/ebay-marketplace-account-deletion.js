'use strict';

// eBay Marketplace Account Deletion endpoint for the browser-only Netlify
// deploy. Public URL (via the netlify.toml rewrite):
//   /api/sync/ebay/marketplace-account-deletion
// Same logic as the Express route (app/lib/ebay-handlers.js). This deploy
// keeps no eBay user data server-side (connected users hold only an
// encrypted token blob in their own browser), so a notification is
// validated and acknowledged with nothing to purge.

const {
    handleDeletionChallenge,
    handleDeletionNotification,
} = require('../../app/lib/ebay-handlers');
const {
    json,
    methodNotAllowed,
    missingEnv,
    rawBody,
    header,
} = require('../lib/http');

const REQUIRED_ENV = [
    'EBAY_VERIFICATION_TOKEN',
    'EBAY_NOTIFICATION_ENDPOINT_URL',
];

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
        return methodNotAllowed('GET, POST');
    }
    const missing = missingEnv(REQUIRED_ENV);
    if (missing.length) {
        console.error(
            `[eBay] Marketplace deletion endpoint misconfigured: ${missing.join(', ')} not set.`,
        );
        return json(500, { error: 'Endpoint not configured.' });
    }
    if (event.httpMethod === 'GET') {
        const { status, body } = handleDeletionChallenge({
            challengeCode: event.queryStringParameters?.challenge_code,
            verificationToken: process.env.EBAY_VERIFICATION_TOKEN,
            endpoint: process.env.EBAY_NOTIFICATION_ENDPOINT_URL,
        });
        return json(status, body);
    }
    const raw = rawBody(event);
    let parsed;
    try {
        parsed = JSON.parse(raw.toString('utf8'));
    } catch {
        return json(400, { error: 'Invalid JSON.' });
    }
    const { status, body } = await handleDeletionNotification({
        rawBody: raw,
        signatureHeader: header(event, 'x-ebay-signature'),
        body: parsed,
        allowUnsigned: true,
    });
    return json(status, body);
};
