import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
    completionUrl,
    denyUrl,
    describeRequest,
    hasFireData,
    pendingFromHash,
} from '../../app/lib/mcp-connect-core.mjs';

const enc = (obj) =>
    `${Buffer.from(JSON.stringify(obj)).toString('base64url')}.sig`;
const payload = {
    client_name: 'Claude',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    state: 'st-1',
    scope: ['summary', 'accounts', 'transactions', 'bogus'],
    exp: 1,
};

describe('consent page core', () => {
    it('reads only the #/mcp-connect fragment', () => {
        expect(pendingFromHash('#/mcp-connect?req=abc.def')).toBe('abc.def');
        for (const h of [
            '',
            '#/other?req=a.b',
            '#/mcp-connect?req=',
            '#/mcp-connect?req=a b',
            '#/mcp-connect?req=a&x=1',
        ]) {
            expect(pendingFromHash(h)).toBeNull();
        }
    });

    it('describes the request: unverified name, redirect host, known groups only, transactions unticked', () => {
        const info = describeRequest(enc(payload));
        expect(info.clientName).toBe('Claude');
        expect(info.redirectHost).toBe('claude.ai');
        expect(info.groups.map((g) => g.id)).toEqual([
            'summary',
            'accounts',
            'transactions',
        ]);
        const ticked = Object.fromEntries(
            info.groups.map((g) => [g.id, g.checked]),
        );
        expect(ticked).toEqual({
            summary: true,
            accounts: true,
            transactions: false,
        });
    });

    it('rejects non-web redirect schemes and non-string scope ids', () => {
        expect(
            describeRequest(enc({ ...payload, redirect_uri: 'myapp://cb' })),
        ).toBeNull();
        expect(
            describeRequest(
                enc({ ...payload, redirect_uri: 'javascript:alert(1)' }),
            ),
        ).toBeNull();
        const info = describeRequest(
            enc({ ...payload, scope: [['transactions'], 'summary'] }),
        );
        expect(info.groups.map((g) => g.id)).toEqual(['summary']);
    });

    it('returns null for unreadable, scope-less or malformed requests', () => {
        expect(describeRequest('not-base64.sig')).toBeNull();
        expect(
            describeRequest(enc({ ...payload, scope: ['bogus'] })),
        ).toBeNull();
        expect(
            describeRequest(enc({ ...payload, redirect_uri: 'nope' })),
        ).toBeNull();
    });

    it('deny redirects with access_denied and the client state', () => {
        const url = new URL(denyUrl(describeRequest(enc(payload))));
        expect(url.origin + url.pathname).toBe(
            'https://claude.ai/api/mcp/auth_callback',
        );
        expect(url.searchParams.get('error')).toBe('access_denied');
        expect(url.searchParams.get('state')).toBe('st-1');
    });

    it('the completion ticket is the SHA-256 of the pending value, never the value', async () => {
        const url = await completionUrl(
            'https://fire.example',
            'a'.repeat(32),
            'pending.value',
        );
        const u = new URL(url);
        expect(u.pathname).toBe('/authorize/complete');
        expect(u.searchParams.get('sid')).toBe('a'.repeat(32));
        const expected = Buffer.from(
            await crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode('pending.value'),
            ),
        ).toString('base64url');
        expect(u.searchParams.get('t')).toBe(expected);
        expect(url).not.toContain('pending.value');
    });

    it('detects whether the profile has fire data', () => {
        const store = (v) => ({ getItem: () => v });
        expect(hasFireData(store(null))).toBe(false);
        expect(hasFireData(store('{}'))).toBe(false);
        expect(hasFireData(store('not json'))).toBe(false);
        expect(hasFireData(store('{"customAccounts":[]}'))).toBe(true);
    });
});

describe('page wiring and CSP (#514)', () => {
    const read = (p) =>
        fs.readFileSync(new URL(`../../app/${p}`, import.meta.url), 'utf8');

    it('adds only the relay host to connect-src and no new script source', () => {
        const csp = read('_headers')
            .split('\n')
            .find((l) => l.includes('Content-Security-Policy'));
        expect(csp).toContain('wss://relay.fire.nitsuah.io');
        const script = /script-src ([^;]+);/.exec(csp)[1];
        expect(script).toBe("'self' https://cdn.jsdelivr.net");
        expect(csp).not.toContain('unsafe-');
    });

    it('the page module uses text nodes only', () => {
        const src = read('lib/mcp-connect.js');
        expect(src).not.toMatch(
            /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/,
        );
        expect(src).not.toMatch(/\bon(?:click|change)\s*=/i);
    });

    it('the module is loaded as a native module script', () => {
        expect(read('index.html')).toContain(
            '<script type="module" src="lib/mcp-connect.js"></script>',
        );
    });
});
