/**
 * Bridge Protocol Test - runs test vectors from bridge-protocol.vectors.json
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Import all functions from bridge-protocol.mjs
const bridge = await import('../../app/bridge-protocol.mjs');

const PROTOCOL_VERSION = bridge.PROTOCOL_VERSION;
const FrameType = bridge.FrameType;
const Limits = bridge.Limits;
const SIGNING_PREFIX = bridge.SIGNING_PREFIX;

const {
    validateFrame,
    buildProveSigningString,
    verifyProveSigningString,
    checkCallSeq,
    checkCallDeadline,
    checkResultSize,
    generateId,
    generateNonce,
    createHello,
    createChallenge,
    createProve,
    createReady,
    createCall,
    createResult,
    createEnd,
} = bridge;

const vectorsPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    'bridge-protocol.vectors.json',
);
const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));

describe('Bridge Protocol - Constants', () => {
    it('exports PROTOCOL_VERSION = 1', () => {
        expect(PROTOCOL_VERSION).toBe(1);
    });

    it('exports all FrameType values', () => {
        expect(FrameType.HELLO).toBe('HELLO');
        expect(FrameType.CHALLENGE).toBe('CHALLENGE');
        expect(FrameType.PROVE).toBe('PROVE');
        expect(FrameType.READY).toBe('READY');
        expect(FrameType.CALL).toBe('CALL');
        expect(FrameType.RESULT).toBe('RESULT');
        expect(FrameType.END).toBe('END');
    });

    it('exports Limits with correct defaults', () => {
        expect(Limits.MAX_RESULT_BYTES).toBe(256 * 1024);
        expect(Limits.MAX_CALLS_IN_FLIGHT).toBe(4);
        expect(Limits.CALL_DEADLINE_MS).toBe(15_000);
        expect(Limits.RATE_LIMIT_CALLS_PER_MIN).toBe(30);
        expect(Limits.NONCE_EXPIRY_MS).toBe(10_000);
        expect(Limits.RECONNECT_GRACE_MS).toBe(30_000);
        expect(Limits.IDLE_TIMEOUT_MS).toBe(10 * 60 * 1000);
        expect(Limits.SESSION_MAX_MS).toBe(60 * 60 * 1000);
    });

    it('exports SIGNING_PREFIX', () => {
        expect(SIGNING_PREFIX).toBe('fire-bridge/v1');
    });
});

describe('Bridge Protocol - Frame Validation', () => {
    for (const vector of vectors.validFrames) {
        it(`valid: ${vector.name}`, () => {
            const result = validateFrame(vector.frame);
            expect(result).toEqual(vector.expect);
        });
    }

    for (const vector of vectors.invalidFrames) {
        it(`invalid: ${vector.name}`, () => {
            const result = validateFrame(vector.frame);
            expect(result.ok).toBe(false);
            const escapedError = vector.expect.error.replace(
                /[.*+?^${}()|[\]\\]/g,
                '\\$&',
            );
            expect(result.error).toMatch(new RegExp(escapedError));
        });
    }
});

describe('Bridge Protocol - Protocol Checks', () => {
    it('checkCallSeq: replayed seq rejected', () => {
        expect(checkCallSeq({ seq: 1 }, 1)).toEqual({
            ok: false,
            error: 'Replayed or out-of-order seq: 1 <= 1',
        });
    });

    it('checkCallSeq: out of order seq rejected', () => {
        expect(checkCallSeq({ seq: 2 }, 5)).toEqual({
            ok: false,
            error: 'Replayed or out-of-order seq: 2 <= 5',
        });
    });

    it('checkCallSeq: valid next seq', () => {
        expect(checkCallSeq({ seq: 3 }, 2)).toEqual({ ok: true });
    });

    it('checkCallDeadline: expired deadline rejected', () => {
        expect(checkCallDeadline({ deadline: 1000 }, 2000)).toEqual({
            ok: false,
            error: 'Call deadline passed: 1000 <= 2000',
        });
    });

    it('checkCallDeadline: valid deadline', () => {
        expect(checkCallDeadline({ deadline: 2000 }, 1000)).toEqual({
            ok: true,
        });
    });

    it('checkResultSize: oversized result rejected', () => {
        // Create an actual oversized frame
        const oversizedFrame = {
            v: 1,
            type: 'RESULT',
            sid: 's1',
            id: '0123456789abcdef0123456789abcdef',
            ok: true,
            content: { x: 'a'.repeat(300000) },
        };
        const result = checkResultSize(oversizedFrame);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('Result too large');
    });

    it('checkResultSize: valid size', () => {
        expect(
            checkResultSize({
                v: 1,
                type: 'RESULT',
                sid: 's1',
                id: '0123456789abcdef0123456789abcdef',
                ok: true,
                content: { x: 'small' },
            }).ok,
        ).toBe(true);
    });
});

describe('Bridge Protocol - PROVE Signing', () => {
    it('buildProveSigningString: basic', () => {
        const result = buildProveSigningString(
            'https://relay.example.com',
            'session-123',
            '0123456789abcdef0123456789abcdef',
            ['accounts', 'net_worth'],
            1732000000000,
        );
        expect(result).toBe(
            'fire-bridge/v1\u0000https://relay.example.com\u0000session-123\u00000123456789abcdef0123456789abcdef\u0000accounts,net_worth\u00001732000000000',
        );
    });

    it('buildProveSigningString: empty scope', () => {
        const result = buildProveSigningString(
            'https://relay.example.com',
            'session-123',
            '0123456789abcdef0123456789abcdef',
            [],
            1732000000000,
        );
        expect(result).toBe(
            'fire-bridge/v1\u0000https://relay.example.com\u0000session-123\u00000123456789abcdef0123456789abcdef\u0000\u00001732000000000',
        );
    });

    it('buildProveSigningString: scope sorted', () => {
        const result = buildProveSigningString(
            'https://relay.example.com',
            'session-123',
            '0123456789abcdef0123456789abcdef',
            ['net_worth', 'accounts'],
            1732000000000,
        );
        expect(result).toBe(
            'fire-bridge/v1\u0000https://relay.example.com\u0000session-123\u00000123456789abcdef0123456789abcdef\u0000accounts,net_worth\u00001732000000000',
        );
    });

    it('verifyProveSigningString: matches', () => {
        const result = verifyProveSigningString(
            'fire-bridge/v1\u0000https://relay.example.com\u0000session-123\u00000123456789abcdef0123456789abcdef\u0000accounts,net_worth\u00001732000000000',
            'https://relay.example.com',
            'session-123',
            '0123456789abcdef0123456789abcdef',
            ['accounts', 'net_worth'],
            1732000000000,
        );
        expect(result).toBe(true);
    });

    it('verifyProveSigningString: tampered relayOrigin', () => {
        const result = verifyProveSigningString(
            'fire-bridge/v1\u0000https://evil.example.com\u0000session-123\u00000123456789abcdef0123456789abcdef\u0000accounts,net_worth\u00001732000000000',
            'https://relay.example.com',
            'session-123',
            '0123456789abcdef0123456789abcdef',
            ['accounts', 'net_worth'],
            1732000000000,
        );
        expect(result).toBe(false);
    });

    it('verifyProveSigningString: tampered sid', () => {
        const result = verifyProveSigningString(
            'fire-bridge/v1\u0000https://relay.example.com\u0000session-456\u00000123456789abcdef0123456789abcdef\u0000accounts,net_worth\u00001732000000000',
            'https://relay.example.com',
            'session-123',
            '0123456789abcdef0123456789abcdef',
            ['accounts', 'net_worth'],
            1732000000000,
        );
        expect(result).toBe(false);
    });

    it('verifyProveSigningString: tampered nonce', () => {
        const result = verifyProveSigningString(
            'fire-bridge/v1\u0000https://relay.example.com\u0000session-123\u0000fedcba9876543210fedcba9876543210\u0000accounts,net_worth\u00001732000000000',
            'https://relay.example.com',
            'session-123',
            '0123456789abcdef0123456789abcdef',
            ['accounts', 'net_worth'],
            1732000000000,
        );
        expect(result).toBe(false);
    });

    it('verifyProveSigningString: tampered scope', () => {
        const result = verifyProveSigningString(
            'fire-bridge/v1\u0000https://relay.example.com\u0000session-123\u00000123456789abcdef0123456789abcdef\u0000accounts,transactions\u00001732000000000',
            'https://relay.example.com',
            'session-123',
            '0123456789abcdef0123456789abcdef',
            ['accounts', 'net_worth'],
            1732000000000,
        );
        expect(result).toBe(false);
    });

    it('verifyProveSigningString: tampered expiresAt', () => {
        const result = verifyProveSigningString(
            'fire-bridge/v1\u0000https://relay.example.com\u0000session-123\u00000123456789abcdef0123456789abcdef\u0000accounts,net_worth\u00001732000000001',
            'https://relay.example.com',
            'session-123',
            '0123456789abcdef0123456789abcdef',
            ['accounts', 'net_worth'],
            1732000000000,
        );
        expect(result).toBe(false);
    });
});

describe('Bridge Protocol - Frame Creation', () => {
    it('createHello', () => {
        const result = createHello(
            { kty: 'EC', crv: 'P-256' },
            'auth-token',
            ['accounts'],
            1732000000000,
        );
        expect(result).toEqual({
            v: 1,
            type: 'HELLO',
            sid: '',
            pub: { kty: 'EC', crv: 'P-256' },
            pendingAuth: 'auth-token',
            scope: ['accounts'],
            expiresAt: 1732000000000,
        });
    });

    it('createChallenge', () => {
        const result = createChallenge(
            's1',
            '0123456789abcdef0123456789abcdef',
            123,
        );
        expect(result).toEqual({
            v: 1,
            type: 'CHALLENGE',
            sid: 's1',
            nonce: '0123456789abcdef0123456789abcdef',
            exp: 123,
        });
    });

    it('createProve', () => {
        const result = createProve('s1', 'sig-value');
        expect(result).toEqual({
            v: 1,
            type: 'PROVE',
            sid: 's1',
            sig: 'sig-value',
        });
    });

    it('createReady', () => {
        const result = createReady('s1', 123, 600000, ['accounts']);
        expect(result).toEqual({
            v: 1,
            type: 'READY',
            sid: 's1',
            expiresAt: 123,
            idleTimeout: 600000,
            scope: ['accounts'],
        });
    });

    it('createCall', () => {
        const result = createCall(
            's1',
            1,
            '0123456789abcdef0123456789abcdef',
            123,
            'get_net_worth',
            {},
        );
        expect(result).toEqual({
            v: 1,
            type: 'CALL',
            sid: 's1',
            seq: 1,
            id: '0123456789abcdef0123456789abcdef',
            deadline: 123,
            tool: 'get_net_worth',
            args: {},
        });
    });

    it('createResult success', () => {
        const result = createResult(
            's1',
            '0123456789abcdef0123456789abcdef',
            true,
            { total: 100 },
        );
        expect(result).toEqual({
            v: 1,
            type: 'RESULT',
            sid: 's1',
            id: '0123456789abcdef0123456789abcdef',
            ok: true,
            content: { total: 100 },
        });
    });

    it('createResult error', () => {
        const result = createResult(
            's1',
            '0123456789abcdef0123456789abcdef',
            false,
            'Tool not found',
        );
        expect(result).toEqual({
            v: 1,
            type: 'RESULT',
            sid: 's1',
            id: '0123456789abcdef0123456789abcdef',
            ok: false,
            error: 'Tool not found',
        });
    });

    it('createEnd', () => {
        const result = createEnd('s1', 'user_disconnect');
        expect(result).toEqual({
            v: 1,
            type: 'END',
            sid: 's1',
            reason: 'user_disconnect',
        });
    });
});

describe('Bridge Protocol - ID Generation', () => {
    it('generateId produces 32-char hex', () => {
        const id = generateId();
        expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generateNonce produces 32-char hex', () => {
        const nonce = generateNonce();
        expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generateId produces unique values over 100 runs', () => {
        const values = new Set();
        for (let i = 0; i < 100; i++) {
            const id = generateId();
            expect(id).toMatch(/^[0-9a-f]{32}$/);
            expect(values.has(id)).toBe(false);
            values.add(id);
        }
    });
});

describe('Bridge Protocol - Edge Cases', () => {
    it('validateFrame rejects null', () => {
        expect(validateFrame(null).ok).toBe(false);
    });

    it('validateFrame rejects primitive', () => {
        expect(validateFrame('string').ok).toBe(false);
        expect(validateFrame(123).ok).toBe(false);
    });

    it('validateFrame rejects array', () => {
        expect(validateFrame([]).ok).toBe(false);
    });

    it('checkCallSeq handles large sequence numbers', () => {
        expect(
            checkCallSeq(
                { seq: Number.MAX_SAFE_INTEGER },
                Number.MAX_SAFE_INTEGER - 1,
            ).ok,
        ).toBe(true);
        expect(checkCallSeq({ seq: 1 }, Number.MAX_SAFE_INTEGER).ok).toBe(
            false,
        );
    });

    it('checkCallDeadline handles boundary', () => {
        const now = 1000;
        expect(checkCallDeadline({ deadline: 1000 }, now).ok).toBe(false);
        expect(checkCallDeadline({ deadline: 1001 }, now).ok).toBe(true);
    });

    it('buildProveSigningString rejects scope entries with commas (ambiguous encoding)', () => {
        // ['a,b'] and ['a', 'b'] would otherwise sign the same string.
        expect(() =>
            buildProveSigningString(
                'https://relay.example.com',
                'session-123',
                '0123456789abcdef0123456789abcdef',
                ['scope,with,commas'],
                1732000000000,
            ),
        ).toThrow(TypeError);
    });

    it('buildProveSigningString rejects NUL in any field and does not mutate scope', () => {
        expect(() =>
            buildProveSigningString('https://r', 'sid\u0000x', 'n', ['a'], 1),
        ).toThrow(TypeError);
        const scope = ['zeta', 'alpha'];
        buildProveSigningString('https://r', 'sid', 'n', scope, 1);
        expect(scope).toEqual(['zeta', 'alpha']);
    });

    it('checkResultSize measures byte length', () => {
        const frame = {
            v: 1,
            type: 'RESULT',
            sid: 's1',
            id: '0123456789abcdef0123456789abcdef',
            ok: true,
            content: { data: 'x'.repeat(100) },
        };
        const result = checkResultSize(frame);
        expect(result.ok).toBe(true);
        expect(result.bytes).toBeGreaterThan(0);
    });
});

describe('Bridge Protocol - PROVE signature (verifyProve)', () => {
    const { verifyProve, validatePublicJwk, checkChallengeFresh } = bridge;
    const ctx = {
        relayOrigin: 'https://relay.example',
        sid: 's1',
        nonce: '0123456789abcdef0123456789abcdef',
        scope: ['net_worth', 'accounts'],
        expiresAt: 1732000000000,
    };

    async function keyPair() {
        const kp = await globalThis.crypto.subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' },
            true,
            ['sign', 'verify'],
        );
        const pub = await globalThis.crypto.subtle.exportKey(
            'jwk',
            kp.publicKey,
        );
        return { privateKey: kp.privateKey, pub };
    }

    async function sign(privateKey, c = ctx) {
        const msg = new TextEncoder().encode(
            buildProveSigningString(
                c.relayOrigin,
                c.sid,
                c.nonce,
                c.scope,
                c.expiresAt,
            ),
        );
        const sig = new Uint8Array(
            await globalThis.crypto.subtle.sign(
                { name: 'ECDSA', hash: 'SHA-256' },
                privateKey,
                msg,
            ),
        );
        return Buffer.from(sig).toString('base64url');
    }

    it('accepts a signature by the HELLO key over the expected values', async () => {
        const { privateKey, pub } = await keyPair();
        expect(await verifyProve(await sign(privateKey), pub, ctx)).toBe(true);
    });

    it('rejects a bad signature', async () => {
        const { privateKey, pub } = await keyPair();
        const sig = await sign(privateKey);
        const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
        expect(await verifyProve(flipped, pub, ctx)).toBe(false);
        expect(await verifyProve('not base64url!', pub, ctx)).toBe(false);
    });

    it('rejects a signature by a different key', async () => {
        const a = await keyPair();
        const b = await keyPair();
        expect(await verifyProve(await sign(a.privateKey), b.pub, ctx)).toBe(
            false,
        );
    });

    it('rejects scope or expiresAt tampered after signing', async () => {
        const { privateKey, pub } = await keyPair();
        const sig = await sign(privateKey);
        expect(
            await verifyProve(sig, pub, {
                ...ctx,
                scope: [...ctx.scope, 'transactions'],
            }),
        ).toBe(false);
        expect(
            await verifyProve(sig, pub, {
                ...ctx,
                expiresAt: ctx.expiresAt + 1,
            }),
        ).toBe(false);
        expect(
            await verifyProve(sig, pub, { ...ctx, nonce: 'f'.repeat(32) }),
        ).toBe(false);
    });

    it('returns false (never throws) for a malformed key', async () => {
        const { privateKey } = await keyPair();
        const sig = await sign(privateKey);
        expect(
            await verifyProve(
                sig,
                { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' },
                ctx,
            ),
        ).toBe(false);
        expect(await verifyProve(sig, null, ctx)).toBe(false);
    });

    it('validatePublicJwk requires a public EC P-256 key', async () => {
        const { pub } = await keyPair();
        expect(validatePublicJwk(pub).ok).toBe(true);
        expect(validatePublicJwk({ kty: 'RSA', n: 'x', e: 'AQAB' }).ok).toBe(
            false,
        );
        expect(
            validatePublicJwk({ kty: 'EC', crv: 'P-384', x: 'a', y: 'b' }).ok,
        ).toBe(false);
        expect(validatePublicJwk({ kty: 'EC', crv: 'P-256', x: 'a' }).ok).toBe(
            false,
        );
        expect(validatePublicJwk({ ...pub, d: 'secret' }).ok).toBe(false);
        expect(
            validateFrame({ v: 1, type: 'HELLO', sid: 's1', pub: {} }).ok,
        ).toBe(false);
    });

    it('checkChallengeFresh rejects an expired challenge', () => {
        const now = 1_000_000;
        expect(checkChallengeFresh({ exp: now + 1 }, now).ok).toBe(true);
        expect(checkChallengeFresh({ exp: now }, now).ok).toBe(false);
        expect(checkChallengeFresh({ exp: now - 5 }, now).ok).toBe(false);
    });

    it('READY rejects a zero or negative idleTimeout', () => {
        const base = {
            v: 1,
            type: 'READY',
            sid: 's1',
            expiresAt: 1,
            scope: [],
        };
        expect(validateFrame({ ...base, idleTimeout: 0 }).ok).toBe(false);
        expect(validateFrame({ ...base, idleTimeout: -1 }).ok).toBe(false);
        expect(validateFrame({ ...base, idleTimeout: 1000 }).ok).toBe(true);
    });
});
