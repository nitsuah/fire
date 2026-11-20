import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import etsyHandler from '../../netlify/functions/etsy.mjs';
import ebayAuthorize from '../../netlify/functions/ebay-authorize.mjs';
import ebayCallback from '../../netlify/functions/ebay-callback.mjs';
import gdriveHandler from '../../netlify/functions/gdrive-backup.mjs';
import oauthNonce from '../../app/lib/oauth-nonce.js';

const NONCE = 'ab'.repeat(16);
const OTHER = 'cd'.repeat(16);
const HOST = 'https://lifefire.netlify.app';
const ENV = {
    ETSY_CLIENT_ID: 'testkeystring',
    EBAY_CLIENT_ID: 'id',
    EBAY_CLIENT_SECRET: 'secret',
    EBAY_REDIRECT_URI: 'Test_RuName-test',
    GDRIVE_CLIENT_ID: 'gid',
    GDRIVE_CLIENT_SECRET: 'gsecret',
    // Test-only 64-hex-char key, not a real secret.
    SYNC_MASTER_KEY: '66'.repeat(32),
};
const saved = {};
for (const k of Object.keys(ENV)) saved[k] = process.env[k];
Object.assign(process.env, ENV);

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const tokenFetch = () =>
    vi.stubGlobal(
        'fetch',
        vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        access_token: 'at',
                        refresh_token: 'rt',
                        expires_in: 3600,
                    }),
                    { headers: { 'Content-Type': 'application/json' } },
                ),
        ),
    );

describe('oauth-nonce helper', () => {
    it('accepts only 32 lowercase hex characters', () => {
        expect(oauthNonce.cleanNonce(NONCE)).toBe(NONCE);
        expect(oauthNonce.cleanNonce('1')).toBe('');
        expect(oauthNonce.cleanNonce(`${NONCE}&x=1`)).toBe('');
        expect(oauthNonce.cleanNonce(undefined)).toBe('');
        expect(oauthNonce.nonceSuffix(NONCE)).toBe(`&n=${NONCE}`);
        expect(oauthNonce.nonceSuffix('bad')).toBe('');
    });
});

describe('server echoes the per-attempt nonce in the result fragment', () => {
    it('etsy', async () => {
        const auth = await etsyHandler(
            new Request(`${HOST}/api/sync/etsy/authorize?n=${NONCE}`),
        );
        const state = new URL(auth.headers.get('location')).searchParams.get(
            'state',
        );
        const cookie = auth.headers.get('set-cookie').split(';')[0];
        tokenFetch();
        const res = await etsyHandler(
            new Request(
                `${HOST}/api/sync/etsy/callback?code=c&state=${state}`,
                { headers: { cookie } },
            ),
        );
        expect(res.headers.get('location')).toMatch(
            new RegExp(`^/#etsy-connected=[^&]+&n=${NONCE}$`),
        );
    });

    it('etsy without a nonce yields no nonce', async () => {
        const auth = await etsyHandler(
            new Request(`${HOST}/api/sync/etsy/authorize?n=1`),
        );
        const cookie = auth.headers.get('set-cookie').split(';')[0];
        const res = await etsyHandler(
            new Request(`${HOST}/api/sync/etsy/callback?code=c&state=bad`, {
                headers: { cookie },
            }),
        );
        expect(res.headers.get('location')).toBe('/#etsy-error=invalid_state');
    });

    it('ebay', async () => {
        const auth = await ebayAuthorize(
            new Request(`${HOST}/api/sync/ebay/authorize?n=${NONCE}`),
        );
        const state = new URL(auth.headers.get('Location')).searchParams.get(
            'state',
        );
        const cookie = auth.headers.get('Set-Cookie').split(';')[0];
        expect(cookie).toBe(`ebay_oauth_state=${state}.${NONCE}`);
        tokenFetch();
        const ok = await ebayCallback(
            new Request(`${HOST}/api/sync/ebay/callback?code=c&state=${state}`, {
                headers: { cookie },
            }),
        );
        expect(ok.headers.get('Location')).toMatch(
            new RegExp(`^/#ebay-connected=[^&]+&n=${NONCE}$`),
        );
        const bad = await ebayCallback(
            new Request(`${HOST}/api/sync/ebay/callback?code=c&state=zz`, {
                headers: { cookie },
            }),
        );
        expect(bad.headers.get('Location')).toBe(
            `/#ebay-error=invalid_state&n=${NONCE}`,
        );
    });

    it('google drive', async () => {
        const auth = await gdriveHandler(
            new Request(`${HOST}/api/backup/drive/authorize?n=${NONCE}`),
        );
        const state = new URL(auth.headers.get('location')).searchParams.get(
            'state',
        );
        const cookie = auth.headers.get('set-cookie').split(';')[0];
        const res = await gdriveHandler(
            new Request(
                `${HOST}/api/backup/drive/callback?error=access_denied&state=${state}`,
                { headers: { cookie } },
            ),
        );
        expect(res.headers.get('location')).toBe(
            `/#gdrive-error=access_denied&n=${NONCE}`,
        );
    });
});

describe('browser helpers bind a result to the attempt that started it', () => {
    function ctx(hash, stored) {
        const store = new Map(stored ? [['k', stored]] : []);
        const context = vm.createContext({
            crypto: globalThis.crypto,
            sessionStorage: {
                getItem: (k) => (store.has(k) ? store.get(k) : null),
                setItem: (k, v) => store.set(k, v),
                removeItem: (k) => store.delete(k),
            },
            window: {
                location: {
                    hash,
                    pathname: '/',
                    search: '',
                    assign: vi.fn(),
                },
            },
            history: { replaceState: vi.fn() },
        });
        vm.runInContext(
            fs.readFileSync(
                new URL('../../app/lib/html-utils.js', import.meta.url),
                'utf8',
            ),
            context,
        );
        return { context, store };
    }

    it('starts a flow with a fresh random nonce', () => {
        const { context, store } = ctx('');
        expect(context.oauthStartFlow('k', '/api/x/authorize')).toBe(true);
        const nonce = store.get('k');
        expect(nonce).toMatch(/^[0-9a-f]{32}$/);
        expect(context.window.location.assign).toHaveBeenCalledWith(
            `/api/x/authorize?n=${nonce}`,
        );
    });

    it('accepts a matching nonce and consumes it', () => {
        const { context, store } = ctx(`#etsy-connected=blob%3D&n=${NONCE}`, NONCE);
        expect(context.oauthTakeResult('etsy', 'k')).toEqual({
            ok: true,
            kind: 'connected',
            value: 'blob=',
        });
        expect(store.has('k')).toBe(false);
        expect(context.history.replaceState).toHaveBeenCalled();
    });

    it('rejects a different nonce, a missing nonce, and the old constant marker', () => {
        for (const [hash, stored] of [
            [`#etsy-connected=blob&n=${OTHER}`, NONCE],
            ['#etsy-connected=blob', NONCE],
            [`#etsy-connected=blob&n=${NONCE}`, undefined],
            [`#etsy-connected=blob&n=${NONCE}`, '1'],
        ]) {
            const { context } = ctx(hash, stored);
            expect(context.oauthTakeResult('etsy', 'k')).toEqual({ ok: false });
        }
    });

    it('ignores unrelated fragments', () => {
        const { context } = ctx('#something');
        expect(context.oauthTakeResult('etsy', 'k')).toBeNull();
    });
});
