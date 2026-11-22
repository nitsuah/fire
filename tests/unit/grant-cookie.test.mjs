import { describe, it, expect, beforeAll } from 'vitest';
import grant from '../../app/lib/grant-cookie.js';

// Test-only 64-hex-char key, not a real secret.
process.env.SYNC_MASTER_KEY = '77'.repeat(32);
let encrypt;
let decrypt;
beforeAll(async () => {
    ({ encrypt, decrypt } = (
        await import('../../app/lib/crypto-utils.js')
    ).default);
});

// What a browser sends back: the live cookies from a list of Set-Cookie values.
const jar = (setCookies) =>
    setCookies
        .filter((c) => !/Max-Age=0/.test(c))
        .map((c) => c.split(';')[0])
        .join('; ');

describe('grant-cookie', () => {
    it('round-trips a sealed grant through HttpOnly, Strict, path-scoped cookies', () => {
        const sealed = encrypt(
            JSON.stringify({ access_token: 'a', refresh_token: 'r' }),
        );
        const set = grant.grantCookies('t_grant', '/api/sync/t', sealed);
        expect(set).toHaveLength(grant.MAX_CHUNKS);
        expect(set[0]).toMatch(
            /^t_grant\.0=[A-Za-z0-9_.-]+; Path=\/api\/sync\/t; HttpOnly; SameSite=Strict; Max-Age=34560000; Secure$/,
        );
        // The value is not the hex blob the page used to hold.
        expect(set[0]).not.toContain(sealed.split(':')[2].slice(0, 16));
        const back = grant.readGrant(jar(set), 't_grant');
        expect(back).toBe(sealed);
        expect(JSON.parse(decrypt(back)).refresh_token).toBe('r');
    });

    it('splits a large (eBay-sized) grant across chunks and reassembles it', () => {
        const big = {
            access_token: 'v^1.1#' + 'x'.repeat(5000),
            refresh_token: 'y'.repeat(800),
        };
        const sealed = encrypt(JSON.stringify(big));
        const set = grant.grantCookies('ebay_grant', '/api/sync/ebay', sealed);
        const live = set.filter((c) => !/Max-Age=0/.test(c));
        expect(live.length).toBeGreaterThan(1);
        for (const c of live) expect(c.split(';')[0].length).toBeLessThan(4000);
        const header = `other=1; ${jar(set)}; ebay_oauth_state=abc`;
        expect(
            JSON.parse(decrypt(grant.readGrant(header, 'ebay_grant'))),
        ).toEqual(big);
    });

    it('expires unused chunk slots so a shorter grant leaves no stale tail', () => {
        const set = grant.grantCookies('g', '/p', encrypt('short'));
        expect(set.slice(1).every((c) => /^g\.\d=; .*Max-Age=0/.test(c))).toBe(
            true,
        );
    });

    it('refuses a grant too large for the chunk budget', () => {
        const huge = encrypt('z'.repeat(20000));
        expect(() => grant.grantCookies('g', '/p', huge)).toThrow(/too large/);
    });

    it('refuses anything that is not a sealed blob', () => {
        expect(() => grant.grantCookies('g', '/p', 'cookie')).toThrow();
        expect(() => grant.grantCookies('g', '/p', 'a:b:<script>')).toThrow();
    });

    it('reads nothing from a missing or malformed cookie', () => {
        expect(grant.readGrant('', 'g')).toBeNull();
        expect(grant.readGrant('g.0=not base64!', 'g')).toBeNull();
        expect(grant.readGrant('g.1=abc', 'g')).toBeNull();
    });

    it('omits Secure only when asked (plain-http self-hosted installs)', () => {
        const [first] = grant.grantCookies('g', '/p', encrypt('x'), {
            secure: false,
        });
        expect(first).not.toMatch(/Secure/);
        expect(first).toMatch(/HttpOnly/);
        expect(grant.clearGrantCookies('g', '/p', { secure: false })[0]).toBe(
            'g.0=; Path=/p; HttpOnly; SameSite=Strict; Max-Age=0',
        );
    });

    describe('pickGrant', () => {
        const sealed = () => encrypt('{"a":1}');
        const cookieFor = (s) => jar(grant.grantCookies('g', '/p', s));

        it('prefers the cookie and ignores the marker', () => {
            const s = sealed();
            expect(grant.pickGrant(cookieFor(s), 'g', 'cookie')).toEqual({
                sealed: s,
                adopted: false,
            });
        });

        it('adopts a legacy blob when there is no cookie', () => {
            const s = sealed();
            expect(grant.pickGrant('', 'g', s)).toEqual({
                sealed: s,
                adopted: true,
            });
        });

        it('still flags a legacy blob sent alongside a cookie, so the client drops it', () => {
            const fromCookie = sealed();
            const stale = sealed();
            expect(grant.pickGrant(cookieFor(fromCookie), 'g', stale)).toEqual({
                sealed: fromCookie,
                adopted: true,
            });
        });

        it('has nothing when neither is present', () => {
            expect(grant.pickGrant('', 'g', 'cookie')).toEqual({
                sealed: null,
                adopted: false,
            });
            expect(grant.pickGrant(undefined, 'g', undefined)).toEqual({
                sealed: null,
                adopted: false,
            });
        });
    });
});
