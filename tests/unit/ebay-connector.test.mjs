import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
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
});
