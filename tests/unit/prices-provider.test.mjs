import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    fetchPrices,
    fetchYahooChart,
    getProvider,
} = require('../../app/lib/prices-provider.js');
const { pricesCache } = require('../../app/lib/yahoo-prices.js');

const ENV_KEYS = ['PRICE_PROVIDER', 'ALPHA_VANTAGE_API_KEY', 'POLYGON_API_KEY'];
const json = (body, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => body,
});

// Route a mocked fetch by URL substring; unmatched URLs throw so a stray
// live call can never succeed.
function mockFetch(routes) {
    const fn = vi.fn(async (url) => {
        const key = Object.keys(routes).find((k) => String(url).includes(k));
        if (!key) throw new Error(`unexpected fetch: ${url}`);
        const r = routes[key];
        return typeof r === 'function' ? r(String(url)) : r;
    });
    vi.stubGlobal('fetch', fn);
    return fn;
}

const yahooQuote = (...pairs) =>
    json({
        quoteResponse: {
            result: pairs.map(([symbol, regularMarketPrice]) => ({
                symbol,
                regularMarketPrice,
            })),
        },
    });

beforeEach(() => {
    ENV_KEYS.forEach((k) => delete process.env[k]);
    pricesCache.crumb = 'crumb';
    pricesCache.cookie = 'A1=x';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    ENV_KEYS.forEach((k) => delete process.env[k]);
    pricesCache.crumb = '';
    pricesCache.cookie = '';
});

describe('getProvider', () => {
    it('defaults to yahoo with no keys', () => {
        expect(getProvider()).toBe('yahoo');
    });

    it('prefers Alpha Vantage, then Polygon, when keys are set', () => {
        process.env.POLYGON_API_KEY = 'p';
        expect(getProvider()).toBe('polygon');
        process.env.ALPHA_VANTAGE_API_KEY = 'a';
        expect(getProvider()).toBe('alphavantage');
    });

    it('PRICE_PROVIDER overrides keys and is lowercased', () => {
        process.env.ALPHA_VANTAGE_API_KEY = 'a';
        process.env.PRICE_PROVIDER = 'POLYGON';
        expect(getProvider()).toBe('polygon');
    });
});

describe('fetchPrices', () => {
    it('returns {} for empty or missing symbols without fetching', async () => {
        const f = mockFetch({});
        expect(await fetchPrices([])).toEqual({});
        expect(await fetchPrices(null)).toEqual({});
        expect(f).not.toHaveBeenCalled();
    });

    describe('Alpha Vantage', () => {
        beforeEach(() => {
            process.env.ALPHA_VANTAGE_API_KEY = 'test-av';
        });

        it('parses GLOBAL_QUOTE prices per symbol', async () => {
            const f = mockFetch({
                alphavantage: (url) =>
                    json({
                        'Global Quote': {
                            '05. price': url.includes('symbol=AAPL')
                                ? '190.50'
                                : '410.25',
                        },
                    }),
            });
            const out = await fetchPrices(['AAPL', 'MSFT']);
            expect(out).toEqual({ AAPL: 190.5, MSFT: 410.25 });
            expect(f).toHaveBeenCalledTimes(2);
            expect(f.mock.calls[0][0]).toContain('function=GLOBAL_QUOTE');
            expect(f.mock.calls[0][0]).toContain('apikey=test-av');
        });

        it('url-encodes symbols', async () => {
            const f = mockFetch({
                alphavantage: json({ 'Global Quote': { '05. price': '1' } }),
            });
            await fetchPrices(['BRK.B', 'A&B']);
            expect(f.mock.calls[1][0]).toContain('symbol=A%26B');
        });

        it('falls back to Yahoo for empty-quote (rate-limit note) responses', async () => {
            mockFetch({
                alphavantage: json({
                    Note: 'Thank you for using Alpha Vantage! rate limit',
                }),
                'v7/finance/quote': yahooQuote(['AAPL', 188]),
            });
            expect(await fetchPrices(['AAPL'])).toEqual({ AAPL: 188 });
        });

        it('falls back to Yahoo on HTTP 429 and keeps provider results', async () => {
            mockFetch({
                alphavantage: (url) =>
                    url.includes('symbol=AAPL')
                        ? json({ 'Global Quote': { '05. price': '190' } })
                        : json({}, false, 429),
                'v7/finance/quote': (url) => {
                    expect(url).toContain('symbols=MSFT');
                    return yahooQuote(['MSFT', 400]);
                },
            });
            expect(await fetchPrices(['AAPL', 'MSFT'])).toEqual({
                AAPL: 190,
                MSFT: 400,
            });
        });

        it('treats network errors as missing, then falls back', async () => {
            mockFetch({
                alphavantage: () => {
                    throw new Error('network down');
                },
                'v7/finance/quote': yahooQuote(['AAPL', 5]),
            });
            expect(await fetchPrices(['AAPL'])).toEqual({ AAPL: 5 });
        });

        it('treats invalid JSON as missing', async () => {
            mockFetch({
                alphavantage: {
                    ok: true,
                    json: async () => {
                        throw new SyntaxError('bad');
                    },
                },
                'v7/finance/quote': json({ quoteResponse: { result: [] } }),
            });
            expect(await fetchPrices(['AAPL'])).toEqual({});
        });

        it('ignores a quote with no price field', async () => {
            mockFetch({
                alphavantage: json({ 'Global Quote': {} }),
                'v7/finance/quote': json({ quoteResponse: { result: [] } }),
            });
            expect(await fetchPrices(['ZZZ'])).toEqual({});
        });
    });

    describe('Polygon', () => {
        beforeEach(() => {
            process.env.POLYGON_API_KEY = 'test-poly';
        });

        it('reads results.p from the last-trade endpoint', async () => {
            const f = mockFetch({
                'api.polygon.io': (url) =>
                    json({
                        results: { p: url.includes('/AAPL?') ? 191.1 : 99.9 },
                    }),
            });
            expect(await fetchPrices(['AAPL', 'TSLA'])).toEqual({
                AAPL: 191.1,
                TSLA: 99.9,
            });
            expect(f.mock.calls[0][0]).toContain('/v2/last/trade/AAPL');
            expect(f.mock.calls[0][0]).toContain('apiKey=test-poly');
        });

        it('falls back to Yahoo on 429 and on missing results', async () => {
            mockFetch({
                'api.polygon.io': (url) =>
                    url.includes('/AAA?')
                        ? json({ error: 'rate limit' }, false, 429)
                        : url.includes('/BBB?')
                          ? json({ status: 'OK' })
                          : json({ results: { p: 7 } }),
                'v7/finance/quote': yahooQuote(['AAA', 1], ['BBB', 2]),
            });
            expect(await fetchPrices(['AAA', 'BBB', 'CCC'])).toEqual({
                AAA: 1,
                BBB: 2,
                CCC: 7,
            });
        });

        it('swallows thrown errors per symbol', async () => {
            mockFetch({
                'api.polygon.io': () => {
                    throw new Error('timeout');
                },
                'v7/finance/quote': json({ quoteResponse: { result: [] } }),
            });
            expect(await fetchPrices(['AAPL'])).toEqual({});
        });

        it('does not call Yahoo when every symbol resolved', async () => {
            const f = mockFetch({
                'api.polygon.io': json({ results: { p: 1 } }),
            });
            await fetchPrices(['A']);
            expect(
                f.mock.calls.every(([u]) => !String(u).includes('yahoo')),
            ).toBe(true);
        });
    });

    describe('Yahoo (default)', () => {
        it('maps quoteResponse results and skips null prices', async () => {
            const f = mockFetch({
                'v7/finance/quote': json({
                    quoteResponse: {
                        result: [
                            { symbol: 'AAPL', regularMarketPrice: 190 },
                            { symbol: 'BAD', regularMarketPrice: null },
                            { regularMarketPrice: 3 },
                        ],
                    },
                }),
            });
            expect(await fetchPrices(['AAPL', 'BAD'])).toEqual({ AAPL: 190 });
            expect(f).toHaveBeenCalledTimes(1);
            expect(f.mock.calls[0][0]).toContain('symbols=AAPL%2CBAD');
            expect(f.mock.calls[0][0]).toContain('crumb=crumb');
            expect(f.mock.calls[0][1].headers.Cookie).toBe('A1=x');
        });

        it('returns {} on HTTP error, thrown error, or malformed body', async () => {
            mockFetch({ 'v7/finance/quote': json({}, false, 401) });
            expect(await fetchPrices(['AAPL'])).toEqual({});
            mockFetch({
                'v7/finance/quote': () => {
                    throw new Error('boom');
                },
            });
            expect(await fetchPrices(['AAPL'])).toEqual({});
            mockFetch({ 'v7/finance/quote': json({ unexpected: true }) });
            expect(await fetchPrices(['AAPL'])).toEqual({});
        });

        it('bails out without a quote request if the crumb cannot be refreshed', async () => {
            pricesCache.crumb = '';
            const f = mockFetch({
                'finance.yahoo.com/quote': {
                    ok: true,
                    headers: { getSetCookie: () => ['A1=abc; Path=/'] },
                },
                csrfToken: { ok: false, status: 500 },
            });
            expect(await fetchPrices(['AAPL'])).toEqual({});
            expect(
                f.mock.calls.some(([u]) =>
                    String(u).includes('v7/finance/quote'),
                ),
            ).toBe(false);
        });

        it('uses a freshly refreshed crumb for the quote request', async () => {
            pricesCache.crumb = '';
            const f = mockFetch({
                'finance.yahoo.com/quote': {
                    ok: true,
                    headers: { getSetCookie: () => ['A1=abc; Path=/'] },
                },
                csrfToken: { ok: true, text: async () => 'newcrumb' },
                'v7/finance/quote': yahooQuote(['AAPL', 10]),
            });
            expect(await fetchPrices(['AAPL'])).toEqual({ AAPL: 10 });
            const quoteCall = f.mock.calls.find(([u]) =>
                String(u).includes('v7/finance/quote'),
            );
            expect(quoteCall[0]).toContain('crumb=newcrumb');
        });

        it('does not re-query Yahoo when provider is explicitly yahoo', async () => {
            process.env.PRICE_PROVIDER = 'yahoo';
            const f = mockFetch({
                'v7/finance/quote': json({ quoteResponse: { result: [] } }),
            });
            expect(await fetchPrices(['AAPL'])).toEqual({});
            expect(f).toHaveBeenCalledTimes(1);
        });

        it('an unknown PRICE_PROVIDER uses Yahoo once and does not retry for missing symbols', async () => {
            process.env.PRICE_PROVIDER = 'bogus';
            const f = mockFetch({
                'v7/finance/quote': json({ quoteResponse: { result: [] } }),
            });
            expect(await fetchPrices(['AAPL'])).toEqual({});
            expect(f).toHaveBeenCalledTimes(1);
            expect(f.mock.calls[0][0]).toContain('v7/finance/quote');
        });
    });
});

describe('fetchYahooChart', () => {
    const chart = (price, prev) =>
        json({
            chart: {
                result: [
                    {
                        meta: {
                            regularMarketPrice: price,
                            chartPreviousClose: prev,
                        },
                    },
                ],
            },
        });

    it('returns price and percent change', async () => {
        mockFetch({ 'v8/finance/chart/AAPL': chart(110, 100) });
        const out = await fetchYahooChart(['AAPL']);
        expect(out.AAPL.price).toBe(110);
        expect(out.AAPL.changePercent).toBeCloseTo(10);
    });

    it('falls back to previousClose, and to 0 with no previous close', async () => {
        mockFetch({
            'chart/A?': json({
                chart: {
                    result: [
                        {
                            meta: {
                                regularMarketPrice: 50,
                                previousClose: 100,
                            },
                        },
                    ],
                },
            }),
            'chart/B?': chart(5, undefined),
        });
        const out = await fetchYahooChart(['A', 'B']);
        expect(out.A.changePercent).toBeCloseTo(-50);
        expect(out.B.changePercent).toBe(0);
    });

    it('skips HTTP errors, thrown errors and non-finite prices', async () => {
        mockFetch({
            'chart/OK?': chart(1, 1),
            'chart/E429?': json({}, false, 429),
            'chart/THROW?': () => {
                throw new Error('x');
            },
            'chart/NAN?': chart('n/a', 1),
            'chart/EMPTY?': json({ chart: { result: [] } }),
        });
        const out = await fetchYahooChart([
            'OK',
            'E429',
            'THROW',
            'NAN',
            'EMPTY',
        ]);
        expect(Object.keys(out)).toEqual(['OK']);
    });

    it('batches large symbol lists and resolves all of them', async () => {
        const symbols = Array.from({ length: 13 }, (_, i) => `S${i}`);
        const f = mockFetch({ 'v8/finance/chart/': chart(2, 1) });
        const out = await fetchYahooChart(symbols);
        expect(Object.keys(out)).toHaveLength(13);
        expect(f).toHaveBeenCalledTimes(13);
    });

    it('returns {} for an empty list', async () => {
        const f = mockFetch({});
        expect(await fetchYahooChart([])).toEqual({});
        expect(f).not.toHaveBeenCalled();
    });
});
