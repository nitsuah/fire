import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import * as ebay from '../../app/lib/ebay-connector.js';

function clearEnv() {
    delete process.env.EBAY_CLIENT_ID;
    delete process.env.EBAY_CLIENT_SECRET;
    delete process.env.EBAY_REFRESH_TOKEN;
    delete process.env.EBAY_ENVIRONMENT;
}

function setEnv(env) {
    clearEnv();
    for (const [k, v] of Object.entries(env)) {
        if (v === undefined || v === '') delete process.env[k];
        else process.env[k] = v;
    }
}

describe('ebay-connector', () => {
    let originalEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        setEnv({
            EBAY_CLIENT_ID: 'test-client-id',
            EBAY_CLIENT_SECRET: 'test-client-secret',
            EBAY_REFRESH_TOKEN: 'test-refresh-token',
            EBAY_ENVIRONMENT: 'sandbox',
        });
    });

    afterEach(() => {
        setEnv(originalEnv);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    describe('getEnv', () => {
        it('returns env vars when set', () => {
            const env = ebay.getEnv();
            expect(env.clientId).toBe('test-client-id');
            expect(env.clientSecret).toBe('test-client-secret');
            expect(env.refreshToken).toBe('test-refresh-token');
            expect(env.environment).toBe('sandbox');
        });

        it('defaults environment to sandbox', () => {
            setEnv({ EBAY_CLIENT_ID: 'id', EBAY_CLIENT_SECRET: 'secret' });
            const env = ebay.getEnv();
            expect(env.environment).toBe('sandbox');
        });
    });

    describe('isConfigured', () => {
        it('returns true when client id and secret are set', () => {
            expect(ebay.isConfigured()).toBe(true);
        });

        it('returns false when client id is missing', () => {
            setEnv({ EBAY_CLIENT_SECRET: 'secret' });
            expect(ebay.isConfigured()).toBe(false);
        });

        it('returns false when client secret is missing', () => {
            setEnv({ EBAY_CLIENT_ID: 'id' });
            expect(ebay.isConfigured()).toBe(false);
        });
    });

    describe('buildAuthorizationUrl', () => {
        it('builds correct sandbox auth URL', () => {
            const url = ebay.buildAuthorizationUrl(
                'http://localhost:3001/callback',
                'test-state',
            );
            expect(url).toContain(
                'https://auth.sandbox.ebay.com/oauth2/authorize',
            );
            expect(url).toContain('client_id=test-client-id');
            expect(url).toContain(
                'redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fcallback',
            );
            expect(url).toContain('state=test-state');
            expect(url).toContain('response_type=code');
        });

        it('builds correct production auth URL when env is production', () => {
            setEnv({
                EBAY_CLIENT_ID: 'id',
                EBAY_CLIENT_SECRET: 'secret',
                EBAY_ENVIRONMENT: 'production',
            });
            const url = ebay.buildAuthorizationUrl(
                'http://localhost:3001/callback',
                'state',
            );
            expect(url).toContain('https://auth.ebay.com/oauth2/authorize');
        });
    });

    describe('exchangeCodeForTokens', () => {
        it('exchanges code for tokens successfully', async () => {
            const mockTokens = {
                access_token: 'at',
                refresh_token: 'rt',
                expires_in: 7200,
            };
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue({
                    ok: true,
                    json: async () => mockTokens,
                }),
            );

            const tokens = await ebay.exchangeCodeForTokens(
                'auth-code',
                'http://localhost:3001/callback',
            );
            expect(tokens).toEqual(mockTokens);
        });

        it('throws on token exchange failure', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue({
                    ok: false,
                    status: 400,
                    text: async () => 'invalid_grant',
                }),
            );

            await expect(
                ebay.exchangeCodeForTokens(
                    'bad-code',
                    'http://localhost/callback',
                ),
            ).rejects.toThrow(
                'eBay token exchange failed (400): invalid_grant',
            );
        });
    });

    describe('refreshAccessToken', () => {
        it('refreshes token successfully', async () => {
            const mockTokens = {
                access_token: 'new-at',
                refresh_token: 'new-rt',
                expires_in: 7200,
            };
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue({
                    ok: true,
                    json: async () => mockTokens,
                }),
            );

            const tokens = await ebay.refreshAccessToken('old-refresh-token');
            expect(tokens).toEqual(mockTokens);
        });

        it('throws on refresh failure', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue({
                    ok: false,
                    status: 401,
                    text: async () => 'invalid_refresh_token',
                }),
            );

            await expect(
                ebay.refreshAccessToken('bad-refresh-token'),
            ).rejects.toThrow(
                'eBay token refresh failed (401): invalid_refresh_token',
            );
        });
    });

    describe('fetchCompletedOrders', () => {
        it('fetches completed orders successfully', async () => {
            const mockOrders = {
                orders: [
                    {
                        orderId: '123',
                        creationDate: '2024-01-15T10:30:00Z',
                        pricingSummary: {
                            total: { value: '100.00' },
                            fee: { value: '10.00' },
                        },
                        lineItems: [{ title: 'Test Item' }],
                    },
                ],
            };
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue({
                    ok: true,
                    json: async () => mockOrders,
                }),
            );

            const orders = await ebay.fetchCompletedOrders('access-token');
            expect(orders).toEqual(mockOrders);
        });

        it('handles 401 error with status attached', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue({
                    ok: false,
                    status: 401,
                    text: async () => 'Unauthorized',
                }),
            );

            await expect(
                ebay.fetchCompletedOrders('bad-token'),
            ).rejects.toMatchObject({
                status: 401,
                message: expect.stringContaining('eBay Order API failed (401)'),
            });
        });
    });

    describe('ordersToLedgerEntries', () => {
        it('converts orders to ledger entries correctly', () => {
            const orders = {
                orders: [
                    {
                        orderId: '123',
                        creationDate: '2024-01-15T10:30:00Z',
                        pricingSummary: {
                            total: { value: '100.00' },
                            fee: { value: '12.50' },
                        },
                        lineItems: [{ title: 'Test Item' }],
                    },
                    {
                        orderId: '456',
                        creationDate: '2024-01-16T14:00:00Z',
                        pricingSummary: {
                            total: { value: '50.00' },
                            fee: { value: '5.00' },
                        },
                        lineItems: [{ title: 'Another Item' }],
                    },
                ],
            };

            const entries = ebay.ordersToLedgerEntries(orders);
            expect(entries).toHaveLength(2);
            expect(entries[0]).toMatchObject({
                id: 'ebay-123',
                platform: 'eBay',
                date: '2024-01-15',
                description: 'Test Item',
                gross: 100.0,
                fees: 12.5,
                net: 87.5,
                orderId: '123',
            });
            expect(entries[1].net).toBe(45.0);
        });

        it('handles missing line items', () => {
            const orders = {
                orders: [
                    {
                        orderId: '789',
                        creationDate: '2024-01-17T00:00:00Z',
                        pricingSummary: {
                            total: { value: '25.00' },
                            fee: { value: '2.50' },
                        },
                        lineItems: [],
                    },
                ],
            };
            const entries = ebay.ordersToLedgerEntries(orders);
            expect(entries[0].description).toBe('eBay sale');
        });

        it('handles missing orders array', () => {
            const entries = ebay.ordersToLedgerEntries({});
            expect(entries).toEqual([]);
        });

        it('handles malformed pricing values', () => {
            const orders = {
                orders: [
                    {
                        orderId: '999',
                        creationDate: '2024-01-18T00:00:00Z',
                        pricingSummary: {
                            total: { value: 'invalid' },
                            fee: { value: 'also-invalid' },
                        },
                        lineItems: [{ title: 'Item' }],
                    },
                ],
            };
            const entries = ebay.ordersToLedgerEntries(orders);
            expect(entries[0].gross).toBe(0);
            expect(entries[0].fees).toBe(0);
            expect(entries[0].net).toBe(0);
        });
    });

    describe('computeMarketplaceDeletionChallengeResponse', () => {
        it('matches a hand-computed sha256(challengeCode+verificationToken+endpoint)', () => {
            const challengeCode = 'abc123';
            const verificationToken = 'my-verification-token';
            const endpoint = 'https://example.com/ebay/deletion';
            const expected = crypto
                .createHash('sha256')
                .update(challengeCode + verificationToken + endpoint)
                .digest('hex');
            expect(
                ebay.computeMarketplaceDeletionChallengeResponse(
                    challengeCode,
                    verificationToken,
                    endpoint,
                ),
            ).toBe(expected);
        });

        it('is deterministic for the same inputs', () => {
            const a = ebay.computeMarketplaceDeletionChallengeResponse(
                'x',
                'y',
                'z',
            );
            const b = ebay.computeMarketplaceDeletionChallengeResponse(
                'x',
                'y',
                'z',
            );
            expect(a).toBe(b);
            expect(a).toMatch(/^[0-9a-f]{64}$/);
        });

        it('changes when any input changes', () => {
            const base = ebay.computeMarketplaceDeletionChallengeResponse(
                'code',
                'token',
                'https://example.com/endpoint',
            );
            expect(
                ebay.computeMarketplaceDeletionChallengeResponse(
                    'different-code',
                    'token',
                    'https://example.com/endpoint',
                ),
            ).not.toBe(base);
            expect(
                ebay.computeMarketplaceDeletionChallengeResponse(
                    'code',
                    'different-token',
                    'https://example.com/endpoint',
                ),
            ).not.toBe(base);
            expect(
                ebay.computeMarketplaceDeletionChallengeResponse(
                    'code',
                    'token',
                    'https://example.com/different-endpoint',
                ),
            ).not.toBe(base);
        });
    });

    describe('verifyNotificationSignature', () => {
        const keys = crypto.generateKeyPairSync('ec', {
            namedCurve: 'prime256v1',
        });
        const pem = keys.publicKey
            .export({ type: 'spki', format: 'pem' })
            .replace(/\n/g, '');
        const body = Buffer.from('{"metadata":{"topic":"X"}}');
        const header = (overrides = {}) =>
            Buffer.from(
                JSON.stringify({
                    alg: 'ecdsa',
                    kid: 'kid-1',
                    signature: crypto
                        .sign('sha1', body, keys.privateKey)
                        .toString('base64'),
                    digest: 'sha1',
                    ...overrides,
                }),
            ).toString('base64');

        function stubFetch(
            keyResponse = { algorithm: 'ECDSA', digest: 'SHA1', key: pem },
        ) {
            const fetchMock = vi.fn(async (url) =>
                String(url).includes('/oauth2/token')
                    ? new Response(
                          JSON.stringify({
                              access_token: 't',
                              expires_in: 7200,
                          }),
                      )
                    : new Response(JSON.stringify(keyResponse)),
            );
            vi.stubGlobal('fetch', fetchMock);
            return fetchMock;
        }

        beforeEach(() => ebay.resetNotificationKeyCache());

        it('accepts a valid signature and caches the app token and key', async () => {
            const fetchMock = stubFetch();
            expect(
                await ebay.verifyNotificationSignature(body, header()),
            ).toEqual({ valid: true });
            expect(
                await ebay.verifyNotificationSignature(body, header()),
            ).toEqual({ valid: true });
            expect(fetchMock).toHaveBeenCalledTimes(2);
            const [keyUrl, keyInit] = fetchMock.mock.calls[1];
            expect(keyUrl).toBe(
                'https://api.sandbox.ebay.com/commerce/notification/v1/public_key/kid-1',
            );
            expect(keyInit.headers.Authorization).toBe('Bearer t');
        });

        it.each([
            ['empty body', Buffer.alloc(0), header()],
            ['non-buffer body', undefined, header()],
            ['missing header', body, undefined],
            ['non-JSON header', body, 'garbage'],
            ['header without kid', body, header({ kid: '' })],
            ['unsupported alg', body, header({ alg: 'RSA' })],
            ['unsupported digest', body, header({ digest: 'MD5' })],
        ])('rejects %s without fetching a key', async (_label, raw, hdr) => {
            const fetchMock = stubFetch();
            const result = await ebay.verifyNotificationSignature(raw, hdr);
            expect(result.valid).toBe(false);
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('rejects when the key digest disagrees with the header', async () => {
            stubFetch({ algorithm: 'ECDSA', digest: 'SHA256', key: pem });
            const result = await ebay.verifyNotificationSignature(
                body,
                header(),
            );
            expect(result).toEqual({
                valid: false,
                reason: 'key/algorithm mismatch',
            });
        });

        it('rejects an undecodable signature value', async () => {
            stubFetch();
            const result = await ebay.verifyNotificationSignature(
                body,
                header({ signature: 'AAAA' }),
            );
            expect(result).toEqual({
                valid: false,
                reason: 'signature mismatch',
            });
        });

        it('throws when the application token request fails', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn(async () => new Response('nope', { status: 401 })),
            );
            await expect(
                ebay.verifyNotificationSignature(body, header()),
            ).rejects.toThrow(/application token request failed \(401\)/);
        });
    });
});
