import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import etsy from '../../app/lib/etsy-connector.js';
import handlers from '../../app/lib/etsy-handlers.js';

// Etsy Open API v3 connector. Every Etsy call goes through an injected
// fetch mock; nothing here reaches Etsy.
const ENV = {
    ETSY_CLIENT_ID: 'testkeystring',
    // Test-only 64-hex-char key, not a real secret.
    SYNC_MASTER_KEY: '33'.repeat(32),
};
const saved = {};

beforeEach(() => {
    for (const k of [
        ...Object.keys(ENV),
        'ETSY_SHARED_SECRET',
        'ETSY_REDIRECT_URI',
    ]) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
    Object.assign(process.env, ENV);
});

afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    vi.restoreAllMocks();
});

const usd = (cents) => ({ amount: cents, divisor: 100, currency_code: 'USD' });

const receipt = (overrides = {}) => ({
    receipt_id: 1001,
    status: 'Completed',
    is_paid: true,
    create_timestamp: Date.parse('2026-05-04T15:00:00Z') / 1000,
    grandtotal: usd(5480), // 40 item + 10 shipping + 4.80 tax
    total_tax_cost: usd(480),
    total_vat_cost: usd(0),
    refunds: [],
    transactions: [{ title: 'Hand-thrown mug', quantity: 1 }],
    ...overrides,
});

const jsonRes = (status, body) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

describe('configuration and OAuth URL', () => {
    it('needs the keystring and a 64-hex SYNC_MASTER_KEY', () => {
        expect(etsy.isConfigured()).toBe(true);
        process.env.SYNC_MASTER_KEY = 'short';
        expect(etsy.isConfigured()).toBe(false);
        process.env.SYNC_MASTER_KEY = ENV.SYNC_MASTER_KEY;
        delete process.env.ETSY_CLIENT_ID;
        expect(etsy.isConfigured()).toBe(false);
    });

    it('builds a PKCE S256 authorize URL with read-only scopes', () => {
        const { verifier, challenge } = etsy.createPkce();
        expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
        const url = new URL(
            etsy.buildAuthorizationUrl({
                redirectUri: 'https://x.test/api/sync/etsy/callback',
                state: 'abc',
                challenge,
            }),
        );
        expect(url.origin + url.pathname).toBe(
            'https://www.etsy.com/oauth/connect',
        );
        expect(url.searchParams.get('scope')).toBe('transactions_r shops_r');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('code_challenge')).toBe(challenge);
        expect(url.searchParams.get('client_id')).toBe('testkeystring');
    });

    it('seals the pending state and rejects tampered or expired cookies', () => {
        const sealed = etsy.sealPending({
            state: 's',
            verifier: 'v',
            redirectUri: 'r',
        });
        expect(etsy.unsealPending(sealed)).toMatchObject({
            state: 's',
            verifier: 'v',
        });
        expect(etsy.unsealPending(`${sealed}00`)).toBeNull();
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
        expect(etsy.unsealPending(sealed)).toBeNull();
    });
});

describe('receiptToLedgerEntry', () => {
    it('maps a paid receipt with a stable id and estimated fees', () => {
        const e = etsy.receiptToLedgerEntry(receipt());
        // revenue excludes the sales tax Etsy remits
        expect(e).toMatchObject({
            id: 'etsy-1001',
            etsyReceiptId: '1001',
            date: '2026-05-04',
            desc: 'Hand-thrown mug',
            category: 'Etsy',
            revenue: 50,
            feesEstimated: true,
        });
        // 0.20 listing + 6.5% of 50 + (3% of 54.80 + 0.25) = 0.20+3.25+1.894
        expect(e.expenses).toBe(5.34);
        expect(e.net).toBe(44.66);
        expect(e.basisType).toBeUndefined();
    });

    it('subtracts partial refunds and skips canceled/unpaid receipts', () => {
        const partial = etsy.receiptToLedgerEntry(
            receipt({
                status: 'Partially Refunded',
                refunds: [{ amount: usd(1000) }],
            }),
        );
        expect(partial.revenue).toBe(40);
        expect(
            etsy.receiptToLedgerEntry(receipt({ status: 'Canceled' })),
        ).toBeNull();
        expect(
            etsy.receiptToLedgerEntry(receipt({ status: 'Fully Refunded' })),
        ).toBeNull();
        expect(
            etsy.receiptToLedgerEntry(receipt({ is_paid: false })),
        ).toBeNull();
        expect(etsy.receiptToLedgerEntry({})).toBeNull();
    });

    it('names multi-item orders and charges listing fees per item', () => {
        const e = etsy.receiptToLedgerEntry(
            receipt({
                transactions: [
                    { title: 'Mug', quantity: 2 },
                    { title: 'Bowl', quantity: 1 },
                ],
            }),
        );
        expect(e.desc).toBe('Mug (+1 more)');
        expect(e.qty).toBe(3);
    });

    it('recognises API-synced rows only', () => {
        expect(
            etsy.isApiSyncedEtsyEntry({ id: 'etsy-1', etsyReceiptId: '1' }),
        ).toBe(true);
        expect(
            etsy.isApiSyncedEtsyEntry({
                id: '1700000000000',
                category: 'Etsy',
            }),
        ).toBe(false);
    });
});

describe('syncReceipts', () => {
    const tokens = {
        access_token: '12345.old',
        refresh_token: 'refresh-old',
        expires_at: Date.now() + 3600_000,
    };

    it('looks up the shop, pages receipts and sends the API key header', async () => {
        process.env.ETSY_SHARED_SECRET = 'shh';
        const calls = [];
        const fetchMock = vi.fn(async (url, init) => {
            calls.push({ url: String(url), init });
            if (String(url).endsWith('/users/me'))
                return jsonRes(200, { user_id: 12345, shop_id: 777 });
            const offset = new URL(url).searchParams.get('offset');
            if (offset === '0')
                return jsonRes(200, {
                    count: 101,
                    results: Array.from({ length: 100 }, (_, i) =>
                        receipt({ receipt_id: 5000 + i }),
                    ),
                });
            return jsonRes(200, {
                count: 101,
                results: [receipt({ receipt_id: 9999 })],
            });
        });
        const result = await etsy.syncReceipts(
            tokens,
            { since: '2026-05-01T00:00:00Z' },
            fetchMock,
        );
        expect(result.entries).toHaveLength(101);
        expect(result.tokens.shop_id).toBe('777');
        expect(result.changed).toBe(true);
        const receiptsUrl = new URL(calls[1].url);
        expect(receiptsUrl.pathname).toBe('/v3/application/shops/777/receipts');
        expect(receiptsUrl.searchParams.get('was_paid')).toBe('true');
        expect(receiptsUrl.searchParams.get('min_created')).toBe(
            String(Date.parse('2026-05-01T00:00:00Z') / 1000),
        );
        expect(calls[1].init.headers['x-api-key']).toBe('testkeystring:shh');
        expect(calls[1].init.headers.Authorization).toBe('Bearer 12345.old');
    });

    it('refreshes once on a 401 and returns the rotated tokens', async () => {
        let receiptsCalls = 0;
        const fetchMock = vi.fn(async (url, init) => {
            if (String(url).includes('/oauth/token')) {
                const body = new URLSearchParams(init.body);
                expect(body.get('grant_type')).toBe('refresh_token');
                expect(body.get('refresh_token')).toBe('refresh-old');
                return jsonRes(200, {
                    access_token: '12345.new',
                    refresh_token: 'refresh-new',
                    expires_in: 3600,
                });
            }
            receiptsCalls++;
            if (receiptsCalls === 1)
                return jsonRes(401, { error: 'invalid_token' });
            return jsonRes(200, { results: [receipt()] });
        });
        const result = await etsy.syncReceipts(
            { ...tokens, shop_id: '777' },
            {},
            fetchMock,
        );
        expect(result.changed).toBe(true);
        expect(result.tokens).toMatchObject({
            access_token: '12345.new',
            refresh_token: 'refresh-new',
            shop_id: '777',
        });
        expect(result.entries).toHaveLength(1);
    });

    it('refreshes up front when the access token has expired', async () => {
        const fetchMock = vi.fn(async (url) =>
            String(url).includes('/oauth/token')
                ? jsonRes(200, {
                      access_token: '1.n',
                      refresh_token: 'r2',
                      expires_in: 3600,
                  })
                : jsonRes(200, { results: [] }),
        );
        const result = await etsy.syncReceipts(
            { ...tokens, shop_id: '777', expires_at: Date.now() - 1 },
            {},
            fetchMock,
        );
        expect(String(fetchMock.mock.calls[0][0])).toContain('/oauth/token');
        expect(result.tokens.refresh_token).toBe('r2');
    });

    it('throws etsy_revoked when the refresh token is rejected', async () => {
        const fetchMock = vi.fn(async (url) =>
            String(url).includes('/oauth/token')
                ? jsonRes(400, { error: 'invalid_grant' })
                : jsonRes(401, {}),
        );
        await expect(
            etsy.syncReceipts({ ...tokens, shop_id: '777' }, {}, fetchMock),
        ).rejects.toMatchObject({ code: 'etsy_revoked', status: 401 });
        expect(
            handlers.syncErrorResult({ code: 'etsy_revoked', status: 401 }),
        ).toMatchObject({ status: 401, body: { code: 'etsy_revoked' } });
    });

    it('attaches refreshed tokens to a later failure', async () => {
        const fetchMock = vi.fn(async (url) =>
            String(url).includes('/oauth/token')
                ? jsonRes(200, {
                      access_token: '1.n',
                      refresh_token: 'r2',
                      expires_in: 3600,
                  })
                : jsonRes(500, {}),
        );
        const err = await etsy
            .syncReceipts(
                { ...tokens, shop_id: '777', expires_at: Date.now() - 1 },
                {},
                fetchMock,
            )
            .catch((e) => e);
        expect(err.tokens.refresh_token).toBe('r2');
        expect(handlers.syncErrorResult(err).status).toBe(502);
    });
});

describe('handlers', () => {
    it('authorize sets a sealed, path-scoped cookie and redirects to Etsy', () => {
        const result = handlers.authorize({ origin: 'https://x.test' });
        expect(result.redirect).toMatch(
            /^https:\/\/www\.etsy\.com\/oauth\/connect\?/,
        );
        expect(new URL(result.redirect).searchParams.get('redirect_uri')).toBe(
            'https://x.test/api/sync/etsy/callback',
        );
        expect(result.cookie).toMatch(
            /^etsy_oauth=.+; Path=\/api\/sync\/etsy; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/,
        );
    });

    it('authorize falls back to an error fragment when unconfigured', () => {
        delete process.env.ETSY_CLIENT_ID;
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(handlers.authorize({ origin: 'https://x.test' })).toEqual({
            redirect: '/#etsy-error=not_configured',
        });
    });

    it('callback rejects a state mismatch without calling Etsy', async () => {
        const fetchMock = vi.fn();
        const result = await handlers.callback(
            {
                params: new URLSearchParams('code=c&state=wrong'),
                cookieValue: etsy.sealPending({
                    state: 'right',
                    verifier: 'v',
                    redirectUri: 'r',
                }),
                origin: 'https://x.test',
                store: vi.fn(),
            },
            fetchMock,
        );
        expect(result.redirect).toBe('/#etsy-error=invalid_state');
        expect(result.cookie).toContain('Max-Age=0');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('callback exchanges the code with the PKCE verifier and stores the tokens', async () => {
        const fetchMock = vi.fn(async (url, init) => {
            const body = new URLSearchParams(init.body);
            expect(body.get('grant_type')).toBe('authorization_code');
            expect(body.get('code_verifier')).toBe('the-verifier');
            expect(body.get('redirect_uri')).toBe(
                'https://x.test/api/sync/etsy/callback',
            );
            return jsonRes(200, {
                access_token: '4242.tok',
                refresh_token: 'rt',
                expires_in: 3600,
            });
        });
        const store = vi.fn(async () => 'stored');
        const result = await handlers.callback(
            {
                params: new URLSearchParams('code=c&state=s1'),
                cookieValue: etsy.sealPending({
                    state: 's1',
                    verifier: 'the-verifier',
                    redirectUri: 'https://x.test/api/sync/etsy/callback',
                }),
                origin: 'https://x.test',
                store,
            },
            fetchMock,
        );
        expect(result.redirect).toBe('/#etsy-connected=stored');
        expect(store.mock.calls[0][0]).toMatchObject({
            access_token: '4242.tok',
            refresh_token: 'rt',
            user_id: '4242',
        });
    });

    it('callback passes a denial through as an error fragment', async () => {
        const result = await handlers.callback({
            params: new URLSearchParams('error=access_denied&state=s1'),
            cookieValue: etsy.sealPending({
                state: 's1',
                verifier: 'v',
                redirectUri: 'r',
            }),
            origin: 'https://x.test',
            store: vi.fn(),
        });
        expect(result.redirect).toBe('/#etsy-error=access_denied');
    });
});
