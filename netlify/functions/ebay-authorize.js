'use strict';

// Starts eBay OAuth for the browser-only deploy
// (GET /api/sync/ebay/authorize). The CSRF `state` rides in a short-lived
// HttpOnly cookie instead of a server session, since Functions are
// stateless; ebay-callback compares the two.

const crypto = require('crypto');
const { buildAuthorizationUrl } = require('../../app/lib/ebay-connector');
const { json, redirect, methodNotAllowed, missingEnv } = require('../lib/http');

const OAUTH_ENV = [
    'EBAY_CLIENT_ID',
    'EBAY_CLIENT_SECRET',
    'EBAY_REDIRECT_URI',
    'SYNC_MASTER_KEY',
];

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') return methodNotAllowed('GET');
    const missing = missingEnv(OAUTH_ENV);
    if (missing.length) {
        console.error(
            `[eBay] OAuth not configured: ${missing.join(', ')} not set.`,
        );
        return json(503, { error: 'eBay connection is not configured.' });
    }
    const state = crypto.randomBytes(16).toString('hex');
    return redirect(
        buildAuthorizationUrl(process.env.EBAY_REDIRECT_URI, state),
        {
            'Set-Cookie': `ebay_oauth_state=${state}; Path=/api/sync/ebay; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        },
    );
};

exports.OAUTH_ENV = OAUTH_ENV;
