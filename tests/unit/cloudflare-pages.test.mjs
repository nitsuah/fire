// The Cloudflare Pages deploy must answer every public API URL exactly like
// the Netlify deploy: same paths, same handlers. These tests read the
// [[redirects]] straight out of netlify.toml so the two can't drift.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    HANDLERS,
    applyEnv,
    dispatch,
    resolveRoute,
} from '../../cloudflare/router.mjs';
import { onRequest } from '../../functions/api/[[path]].js';

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
);
const toml = readFileSync(path.join(root, 'netlify.toml'), 'utf8');

// [{ from, fn }] for each [[redirects]] block.
const redirects = [
    ...toml.matchAll(/\[\[redirects\]\]([\s\S]*?)(?=\n\[|\s*$)/g),
].map(([, block]) => ({
    from: block.match(/from\s*=\s*"([^"]+)"/)[1],
    fn: block.match(/to\s*=\s*"\/\.netlify\/functions\/([^/"]+)/)[1],
}));

const ENV_KEYS = ['EBAY_VERIFICATION_TOKEN', 'EBAY_NOTIFICATION_ENDPOINT_URL'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

describe('Cloudflare Pages router', () => {
    it('covers every netlify.toml redirect', () => {
        expect(redirects.length).toBeGreaterThanOrEqual(10);
        for (const { from, fn } of redirects) {
            const sample = from.replace('/*', '/sample');
            expect(resolveRoute(sample), from).toBe(fn);
            expect(HANDLERS[fn], fn).toBeTypeOf('function');
        }
    });

    it('routes the bare Drive backup path and trailing slashes', () => {
        expect(resolveRoute('/api/backup/drive')).toBe('gdrive-backup');
        expect(resolveRoute('/api/sync/ebay/callback/')).toBe('ebay-callback');
        expect(resolveRoute('/api/sync/ebay/unknown')).toBe('fire-api');
        expect(resolveRoute('/index.html')).toBeNull();
    });

    it('copies string env bindings into process.env', () => {
        applyEnv({ EBAY_VERIFICATION_TOKEN: 'x'.repeat(40), SOME_BINDING: {} });
        expect(process.env.EBAY_VERIFICATION_TOKEN).toBe('x'.repeat(40));
        expect(process.env.SOME_BINDING).toBeUndefined();
    });

    it('answers the eBay deletion challenge with the same hash', async () => {
        const env = {
            EBAY_VERIFICATION_TOKEN: 'verification-token-for-tests-0123456789',
            EBAY_NOTIFICATION_ENDPOINT_URL:
                'https://fire.nitsuah.io/api/sync/ebay/marketplace-account-deletion',
        };
        const res = await onRequest({
            request: new Request(
                'https://fire.nitsuah.io/api/sync/ebay/marketplace-account-deletion?challenge_code=abc123',
            ),
            env,
            next: () => new Response('static'),
        });
        expect(res.status).toBe(200);
        const expected = createHash('sha256')
            .update('abc123')
            .update(env.EBAY_VERIFICATION_TOKEN)
            .update(env.EBAY_NOTIFICATION_ENDPOINT_URL)
            .digest('hex');
        expect(await res.json()).toEqual({ challengeResponse: expected });
    });

    it('acknowledges a deletion notification POST', async () => {
        const res = await dispatch(
            new Request(
                'https://fire.nitsuah.io/api/sync/ebay/marketplace-account-deletion',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' },
                        notification: {
                            notificationId: 'n1',
                            data: {
                                username: 'u',
                                userId: 'i',
                                eiasToken: 't',
                            },
                        },
                    }),
                },
            ),
            {
                EBAY_VERIFICATION_TOKEN:
                    'verification-token-for-tests-0123456789',
                EBAY_NOTIFICATION_ENDPOINT_URL: 'https://fire.nitsuah.io/x',
            },
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'acknowledged' });
    });

    it('falls through to static files outside /api', async () => {
        const res = await onRequest({
            request: new Request('https://fire.nitsuah.io/'),
            env: {},
            next: () => new Response('static'),
        });
        expect(await res.text()).toBe('static');
    });
});
