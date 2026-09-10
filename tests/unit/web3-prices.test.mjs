import { vi, describe, it, expect, afterEach } from 'vitest';
import { refreshWalletBalance, loadChains } from '../../app/lib/web3-prices.js';

function mockFetchByUrl(handlers) {
    return vi.fn(async (url) => {
        const key = Object.keys(handlers).find((k) => url.includes(k));
        if (!key) throw new Error(`Unexpected fetch URL: ${url}`);
        return handlers[key]();
    });
}

const okJson = (body) => ({ ok: true, json: async () => body });
const badStatus = (status) => ({ ok: false, status });

describe('loadChains', () => {
    it('loads the configured chain list with expected shapes', () => {
        const chains = loadChains();
        expect(Array.isArray(chains)).toBe(true);
        expect(chains.length).toBeGreaterThan(0);
        const ethereum = chains.find((c) => c.id === 'ethereum');
        expect(ethereum).toMatchObject({
            nativeSymbol: 'ETH',
            addressFormat: 'evm',
        });
        const bitcoin = chains.find((c) => c.id === 'bitcoin');
        expect(bitcoin).toBeDefined();
        const solana = chains.find((c) => c.id === 'solana');
        expect(solana).toBeDefined();
    });

    it('is memoized across calls (same array reference)', () => {
        expect(loadChains()).toBe(loadChains());
    });
});

describe('refreshWalletBalance', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        delete process.env.ETHERSCAN_API_KEY;
    });

    it('returns a warning for an unknown chain id without making a request', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const wallet = { id: 'w1', address: '0xabc', chain: 'dogechain' };
        const result = await refreshWalletBalance(wallet);
        expect(result.warning).toMatch(/Unknown chain: dogechain/);
        expect(result.lastFetched).toBeTruthy();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('warns without a network call when an EVM chain has no explorer key configured', async () => {
        delete process.env.ETHERSCAN_API_KEY;
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const wallet = {
            id: 'w2',
            address: '0x' + '1'.repeat(40),
            chain: 'ethereum',
        };
        const result = await refreshWalletBalance(wallet);
        expect(result.warning).toMatch(/ETHERSCAN_API_KEY not set/);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('fetches an EVM balance and USD value when the explorer key is set', async () => {
        process.env.ETHERSCAN_API_KEY = 'test-key';
        vi.stubGlobal(
            'fetch',
            mockFetchByUrl({
                'etherscan.io': () =>
                    okJson({ status: '1', result: String(2n * 10n ** 18n) }),
                'coingecko.com': () => okJson({ ethereum: { usd: 3000 } }),
            }),
        );
        const wallet = {
            id: 'w3',
            address: '0x' + '2'.repeat(40),
            chain: 'ethereum',
        };
        const result = await refreshWalletBalance(wallet);
        expect(result.lastBalance).toBe(2);
        expect(result.lastUsdValue).toBe(6000);
        expect(result.lastPrice).toBe(3000);
        expect(result.warning).toBeUndefined();
        expect(result.lastFetched).toBeTruthy();
    });

    it('surfaces an explorer error status as a warning, not a throw', async () => {
        process.env.ETHERSCAN_API_KEY = 'test-key';
        vi.stubGlobal(
            'fetch',
            mockFetchByUrl({
                'etherscan.io': () => badStatus(500),
            }),
        );
        const wallet = {
            id: 'w4',
            address: '0x' + '3'.repeat(40),
            chain: 'ethereum',
        };
        const result = await refreshWalletBalance(wallet);
        expect(result.warning).toMatch(/Explorer returned 500/);
    });

    it('fetches a Bitcoin balance in BTC from satoshis', async () => {
        vi.stubGlobal(
            'fetch',
            mockFetchByUrl({
                'blockstream.info': () =>
                    okJson({
                        chain_stats: { funded_txo_sum: 150000000, spent_txo_sum: 50000000 },
                    }),
                'coingecko.com': () => okJson({ bitcoin: { usd: 60000 } }),
            }),
        );
        const wallet = { id: 'w5', address: 'bc1qxyz', chain: 'bitcoin' };
        const result = await refreshWalletBalance(wallet);
        expect(result.lastBalance).toBe(1); // (150000000-50000000) sats = 1 BTC
        expect(result.lastUsdValue).toBe(60000);
    });

    it('fetches a Solana balance in SOL from lamports', async () => {
        vi.stubGlobal(
            'fetch',
            mockFetchByUrl({
                'mainnet-beta.solana.com': () =>
                    okJson({ result: { value: 2_000_000_000 } }),
                'coingecko.com': () => okJson({ solana: { usd: 150 } }),
            }),
        );
        const wallet = { id: 'w6', address: 'SoLanaAddr', chain: 'solana' };
        const result = await refreshWalletBalance(wallet);
        expect(result.lastBalance).toBe(2);
        expect(result.lastUsdValue).toBe(300);
    });

    it('does not throw when the balance fetch itself rejects', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('network down');
            }),
        );
        const wallet = { id: 'w7', address: 'bc1qxyz', chain: 'bitcoin' };
        const result = await refreshWalletBalance(wallet);
        expect(result.warning).toBe('Balance fetch failed');
    });
});
