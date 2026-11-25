import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:net';
import serverUtils from '../../app/lib/server-utils.js';

const { findAvailablePort, strictNum } = serverUtils;

describe('strictNum', () => {
    it('parses numeric strings', () => {
        expect(strictNum('3')).toBe(3);
        expect(strictNum('3.5')).toBe(3.5);
        expect(strictNum('-2')).toBe(-2);
        expect(strictNum('0')).toBe(0);
    });

    it('returns numbers unchanged', () => {
        expect(strictNum(3)).toBe(3);
    });

    it('returns NaN for empty string', () => {
        expect(Number.isNaN(strictNum(''))).toBe(true);
    });

    it('returns NaN for whitespace-only strings', () => {
        expect(Number.isNaN(strictNum('  3'))).toBe(true);
        expect(Number.isNaN(strictNum('3 '))).toBe(true);
    });

    it('returns NaN for non-numeric strings', () => {
        expect(Number.isNaN(strictNum('abc'))).toBe(true);
    });

    it('returns NaN for null and undefined', () => {
        expect(Number.isNaN(strictNum(null))).toBe(true);
        expect(Number.isNaN(strictNum(undefined))).toBe(true);
    });
});

describe('findAvailablePort', () => {
    let openServers = [];

    afterEach(() => {
        for (const srv of openServers) {
            srv.close();
        }
        openServers = [];
    });

    it('rejects when no candidates provided', async () => {
        await expect(findAvailablePort([])).rejects.toThrow(
            'No port candidates provided'
        );
    });

    it('resolves a free candidate port', async () => {
        const srv = createServer();
        await new Promise((resolve) => srv.listen(0, resolve));
        const freePort = srv.address().port;
        srv.close();

        const port = await findAvailablePort([freePort]);
        expect(port).toBe(freePort);
    });

    it('skips occupied ports and resolves the next free one', async () => {
        const srvA = createServer();
        await new Promise((resolve) => srvA.listen(0, resolve));
        const portA = srvA.address().port;
        openServers.push(srvA);

        const srvB = createServer();
        await new Promise((resolve) => srvB.listen(0, resolve));
        const portB = srvB.address().port;
        srvB.close();

        const port = await findAvailablePort([portA, portB]);
        expect(port).toBe(portB);
    });

    it('falls back to an ephemeral port when all candidates are occupied', async () => {
        const srvA = createServer();
        await new Promise((resolve) => srvA.listen(0, resolve));
        const portA = srvA.address().port;
        openServers.push(srvA);

        const port = await findAvailablePort([portA]);
        expect(port).toBeGreaterThan(0);
        expect(port).not.toBe(portA);
    });
});
