/* global module, require, Buffer */
'use strict';

const crypto = require('node:crypto');

const DEFAULT_TOLERANCE_SECONDS = 300;

function verifyStripeSignature({
    payload,
    header,
    secret,
    toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
    now = Date.now(),
}) {
    if (typeof secret !== 'string' || secret.length === 0) {
        return { ok: false, code: 'missing_secret' };
    }

    if (typeof header !== 'string' || header.length === 0) {
        return { ok: false, code: 'missing_header' };
    }

    const parts = header.split(',');
    let timestamp = null;
    const signatures = [];

    for (const part of parts) {
        const eqIndex = part.indexOf('=');
        if (eqIndex === -1) {
            return { ok: false, code: 'malformed_header' };
        }
        const key = part.slice(0, eqIndex);
        const value = part.slice(eqIndex + 1);

        if (key === 't') {
            if (timestamp !== null) {
                return { ok: false, code: 'malformed_header' };
            }
            const parsed = parseInt(value, 10);
            if (!Number.isInteger(parsed) || parsed < 0) {
                return { ok: false, code: 'malformed_header' };
            }
            timestamp = parsed;
        } else if (key === 'v1') {
            if (value.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(value)) {
                return { ok: false, code: 'malformed_header' };
            }
            signatures.push(value);
        }
    }

    if (timestamp === null || signatures.length === 0) {
        return { ok: false, code: 'malformed_header' };
    }

    const payloadStr =
        typeof payload === 'string' ? payload : payload.toString();
    const signedPayload = `${timestamp}.${payloadStr}`;
    const hmac = crypto.createHmac('sha256', secret);
    const expectedSig = hmac.update(signedPayload).digest('hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');

    let match = false;
    for (const sig of signatures) {
        const actualBuf = Buffer.from(sig, 'hex');
        if (
            actualBuf.length === expectedBuf.length &&
            crypto.timingSafeEqual(actualBuf, expectedBuf)
        ) {
            match = true;
            break;
        }
    }

    if (!match) {
        return { ok: false, code: 'no_valid_signature' };
    }

    const tolerance =
        typeof toleranceSeconds === 'number' &&
        Number.isFinite(toleranceSeconds) &&
        toleranceSeconds > 0
            ? toleranceSeconds
            : DEFAULT_TOLERANCE_SECONDS;

    const nowSeconds = Math.floor(now / 1000);
    if (Math.abs(nowSeconds - timestamp) > tolerance) {
        return { ok: false, code: 'timestamp_out_of_tolerance' };
    }

    return { ok: true, timestamp };
}

module.exports = { verifyStripeSignature, DEFAULT_TOLERANCE_SECONDS };
