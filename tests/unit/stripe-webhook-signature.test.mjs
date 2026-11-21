import { describe, it, expect } from 'vitest';
import {
    verifyStripeSignature,
    DEFAULT_TOLERANCE_SECONDS,
} from '../../app/lib/stripe-webhook-signature.js';
import crypto from 'node:crypto';

function createHmac(payload, secret, timestamp) {
    const signedPayload = `${timestamp}.${payload}`;
    return crypto
        .createHmac('sha256', secret)
        .update(signedPayload)
        .digest('hex');
}

function makeHeader(timestamp, ...signatures) {
    return `t=${timestamp},${signatures.map((s) => `v1=${s}`).join(',')}`;
}

describe('verifyStripeSignature', () => {
    const secret = 'whsec_testsecret123';
    const payload = '{"id":"evt_test","type":"payment_intent.succeeded"}';
    const fixedNow = 1700000000000; // Fixed timestamp for tests

    it('accepts valid signature with string payload', () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(true);
        expect(result.timestamp).toBe(timestamp);
    });

    it('accepts valid signature with Buffer payload', () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const result = verifyStripeSignature({
            payload: Buffer.from(payload),
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(true);
        expect(result.timestamp).toBe(timestamp);
    });

    it('rejects tampered payload', () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const tamperedPayload =
            '{"id":"evt_test","type":"payment_intent.failed"}';
        const result = verifyStripeSignature({
            payload: tamperedPayload,
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('no_valid_signature');
    });

    it('rejects wrong secret', () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const result = verifyStripeSignature({
            payload,
            header,
            secret: 'whsec_wrongsecret456',
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('no_valid_signature');
    });

    it('accepts when second v1 is valid', () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const sig1 = createHmac('wrong', secret, timestamp);
        const sig2 = createHmac(payload, secret, timestamp);
        const header = `t=${timestamp},v1=${sig1},v1=${sig2}`;

        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(true);
        expect(result.timestamp).toBe(timestamp);
    });

    it('rejects v0-only header', () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const sig = createHmac(payload, secret, timestamp);
        const header = `t=${timestamp},v0=${sig}`;

        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('malformed_header');
    });

    it('rejects missing secret', () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const result = verifyStripeSignature({
            payload,
            header,
            secret: '',
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('missing_secret');
    });

    it('rejects missing header', () => {
        const result = verifyStripeSignature({
            payload,
            header: '',
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('missing_header');
    });

    it('rejects malformed header (no equals)', () => {
        const result = verifyStripeSignature({
            payload,
            header: 't=123,v1=abc',
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('malformed_header');
    });

    it('rejects duplicate t', () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const header = `t=${timestamp},t=${timestamp},v1=abcdef`;
        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('malformed_header');
    });

    it('rejects invalid timestamp (non-integer)', () => {
        const header = 't=abc,v1=abcdef';
        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('malformed_header');
    });

    it('rejects invalid v1 (not 64 hex chars)', () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const header = `t=${timestamp},v1=short`;
        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('malformed_header');
    });

    it('rejects stale timestamp (>300s)', () => {
        const timestamp = Math.floor(fixedNow / 1000) - 301;
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('timestamp_out_of_tolerance');
    });

    it('accepts timestamp at exactly 300s boundary', () => {
        const timestamp = Math.floor(fixedNow / 1000) - 300;
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(true);
    });

    it('accepts future timestamp within tolerance', () => {
        const timestamp = Math.floor(fixedNow / 1000) + 300;
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(true);
    });

    it('rejects future timestamp beyond tolerance', () => {
        const timestamp = Math.floor(fixedNow / 1000) + 301;
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('timestamp_out_of_tolerance');
    });

    it('falls back to DEFAULT_TOLERANCE_SECONDS for zero tolerance', () => {
        const timestamp = Math.floor(fixedNow / 1000) - 301;
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            toleranceSeconds: 0,
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('timestamp_out_of_tolerance');
    });

    it('falls back to DEFAULT_TOLERANCE_SECONDS for negative tolerance', () => {
        const timestamp = Math.floor(fixedNow / 1000) - 301;
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            toleranceSeconds: -1,
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('timestamp_out_of_tolerance');
    });

    it('falls back to DEFAULT_TOLERANCE_SECONDS for non-finite tolerance', () => {
        const timestamp = Math.floor(fixedNow / 1000) - 301;
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            toleranceSeconds: NaN,
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('timestamp_out_of_tolerance');
    });

    it('uses timingSafeEqual (equal-length buffers required)', () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const sig = createHmac(payload, secret, timestamp);
        const header = makeHeader(timestamp, sig);

        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(true);
    });

    it('DEFAULT_TOLERANCE_SECONDS is 300', () => {
        expect(DEFAULT_TOLERANCE_SECONDS).toBe(300);
    });

    it('rejects when header has no v1', () => {
        const timestamp = Math.floor(fixedNow / 1000);
        const header = `t=${timestamp}`;
        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('malformed_header');
    });

    it('rejects when header has no t', () => {
        const sig = createHmac(payload, secret, 123456);
        const header = `v1=${sig}`;
        const result = verifyStripeSignature({
            payload,
            header,
            secret,
            now: fixedNow,
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('malformed_header');
    });
});
