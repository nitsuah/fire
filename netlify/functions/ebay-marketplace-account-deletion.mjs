// eBay Marketplace Account Deletion endpoint for the browser-only Netlify
// deploy. Public URL (via the netlify.toml rewrite):
//   /api/sync/ebay/marketplace-account-deletion
// Same logic as the Express route (app/lib/ebay-handlers.js). This deploy
// keeps no eBay user data server-side (connected users hold only an
// encrypted token blob in their own browser), so a notification is
// validated and acknowledged with nothing to purge.

import ebayHandlers from '../../app/lib/ebay-handlers.js';
import { json, methodNotAllowed, missingEnv } from '../lib/http.mjs';

const { handleDeletionChallenge, handleDeletionNotification } = ebayHandlers;

const REQUIRED_ENV = [
    'EBAY_VERIFICATION_TOKEN',
    'EBAY_NOTIFICATION_ENDPOINT_URL',
];

export default async function handler(req) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return methodNotAllowed('GET, POST');
    }
    const missing = missingEnv(REQUIRED_ENV);
    if (missing.length) {
        console.error(
            `[eBay] Marketplace deletion endpoint misconfigured: ${missing.join(', ')} not set.`,
        );
        return json(500, { error: 'Endpoint not configured.' });
    }
    if (req.method === 'GET') {
        const { status, body } = handleDeletionChallenge({
            challengeCode:
                new URL(req.url).searchParams.get('challenge_code') ||
                undefined,
            verificationToken: process.env.EBAY_VERIFICATION_TOKEN,
            endpoint: process.env.EBAY_NOTIFICATION_ENDPOINT_URL,
        });
        return json(status, body);
    }
    // Exact raw bytes: eBay's signature is over the body as sent.
    const raw = Buffer.from(await req.arrayBuffer());
    let parsed;
    try {
        parsed = JSON.parse(raw.toString('utf8'));
    } catch {
        return json(400, { error: 'Invalid JSON.' });
    }
    const { status, body } = await handleDeletionNotification({
        rawBody: raw,
        signatureHeader: req.headers.get('x-ebay-signature') || undefined,
        body: parsed,
        allowUnsigned: true,
    });
    return json(status, body);
}
