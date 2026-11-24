import { describe, it, expect } from 'vitest';
import {
    createPairing,
    acceptPairing,
    completePairing,
    SealedResponder,
    SealedClient,
    SealedChannel,
    b64uEncode,
    b64uDecode,
} from '../../app/bridge-sealed.mjs';
import { buildShim, createHttpCarrier } from '../../app/fire-bridge.mjs';
import { handleTool } from '../../app/mcp-tools.mjs';
import { toolsForScope } from '../../app/bridge-scope.mjs';

const SID = 'sid_test_12345678';

async function pair() {
    const { pairing, pending } = await createPairing(SID);
    const { channel: shim, hello } = await acceptPairing(pairing);
    const browser = await completePairing(pending, hello);
    return { pairing, shim, browser, hello };
}

const STATE = { accounts: [{ id: 'a', name: 'Cash', balance: 100 }] };

describe('sealed pairing and key agreement', () => {
    it('both ends derive matching directional keys', async () => {
        const { shim, browser } = await pair();
        const env = await shim.seal({ hi: 'there' });
        expect(await browser.open(env)).toEqual({ hi: 'there' });
        const back = await browser.seal({ ok: true });
        expect(await shim.open(back)).toEqual({ ok: true });
    });

    it('ciphertext does not contain the plaintext', async () => {
        const { shim } = await pair();
        const env = await shim.seal({ secret: 'net-worth-123456' });
        expect(JSON.stringify(env)).not.toContain('net-worth');
    });

    it('a relay that swaps public keys cannot derive the keys', async () => {
        const { pairing, pending } = await createPairing(SID);
        const { channel: shim } = await acceptPairing(pairing);
        // The relay does not have the secret. It makes its own shim end with a
        // different pairing (same browser key is unknown to it, so it can only
        // pair against a pairing string of its own) and hands that hello over.
        const other = await createPairing(SID);
        const evil = await acceptPairing(other.pairing);
        const browser = await completePairing(pending, evil.hello);
        const env = await shim.seal({ tool: 'get_net_worth' });
        await expect(browser.open(env)).rejects.toMatchObject({
            code: 'auth_failed',
        });
        const reply = await browser.seal({ ok: true });
        await expect(shim.open(reply)).rejects.toMatchObject({
            code: 'auth_failed',
        });
    });

    it('a relay that knows the public key but not the secret fails too', async () => {
        const { pairing, pending } = await createPairing(SID);
        const body = JSON.parse(
            new TextDecoder().decode(b64uDecode(pairing.slice(7))),
        );
        // Same browser public key, wrong secret.
        body.secret = b64uEncode(new Uint8Array(16));
        const forged =
            'fireb1.' +
            b64uEncode(new TextEncoder().encode(JSON.stringify(body)));
        const evil = await acceptPairing(forged);
        const browser = await completePairing(pending, evil.hello);
        const env = await evil.channel.seal({ tool: 'get_net_worth' });
        await expect(browser.open(env)).rejects.toMatchObject({
            code: 'auth_failed',
        });
    });

    it('a pairing completes once', async () => {
        const { pairing, pending } = await createPairing(SID);
        const { hello } = await acceptPairing(pairing);
        await completePairing(pending, hello);
        await expect(completePairing(pending, hello)).rejects.toMatchObject({
            code: 'pairing_used',
        });
    });

    it('rejects malformed pairing strings and bad public keys', async () => {
        await expect(acceptPairing('nope')).rejects.toMatchObject({
            code: 'bad_pairing',
        });
        await expect(acceptPairing('fireb1.!!')).rejects.toMatchObject({
            code: 'bad_pairing',
        });
        const { pending } = await createPairing(SID);
        await expect(
            completePairing(pending, {
                v: 1,
                sid: SID,
                pub: b64uEncode(new Uint8Array(65).fill(4)),
            }),
        ).rejects.toMatchObject({ code: 'bad_public_key' });
    });
});

describe('sealed replay and ordering', () => {
    it('rejects a replayed envelope', async () => {
        const { shim, browser } = await pair();
        const env = await shim.seal({ n: 1 });
        await browser.open(env);
        await expect(browser.open(env)).rejects.toMatchObject({
            code: 'replay',
        });
    });

    it('rejects a reordered (older) envelope', async () => {
        const { shim, browser } = await pair();
        const first = await shim.seal({ n: 1 });
        const second = await shim.seal({ n: 2 });
        await browser.open(second);
        await expect(browser.open(first)).rejects.toMatchObject({
            code: 'replay',
        });
    });

    it('rejects a changed seq, direction, session or ciphertext', async () => {
        const { shim, browser } = await pair();
        const env = await shim.seal({ n: 1 });
        await expect(
            browser.open({ ...env, seq: env.seq + 1 }),
        ).rejects.toMatchObject({ code: 'auth_failed' });
        await expect(
            browser.open({ ...env, dir: 'b2c' }),
        ).rejects.toMatchObject({ code: 'bad_envelope' });
        await expect(
            browser.open({ ...env, sid: 'other_session_1' }),
        ).rejects.toMatchObject({ code: 'bad_envelope' });
        const flipped = { ...env, ct: env.ct.slice(0, -2) + 'AA' };
        await expect(browser.open(flipped)).rejects.toMatchObject({
            code: 'auth_failed',
        });
        // None of the failures burned the counter.
        expect(await browser.open(env)).toEqual({ n: 1 });
    });

    it('does not accept its own direction back (reflection)', async () => {
        const { shim } = await pair();
        const env = await shim.seal({ n: 1 });
        await expect(shim.open(env)).rejects.toMatchObject({
            code: 'bad_envelope',
        });
    });

    it('allows gaps but never a lower counter', async () => {
        const { shim, browser } = await pair();
        const a = await shim.seal({ n: 1 });
        await shim.seal({ n: 2 }); // dropped by the network
        const c = await shim.seal({ n: 3 });
        await browser.open(a);
        expect(await browser.open(c)).toEqual({ n: 3 });
    });
});

describe('sealed end to end through a hostile relay', () => {
    async function rig(execute, tamper = (e) => e) {
        const { shim, browser } = await pair();
        const responder = new SealedResponder({ channel: browser, execute });
        const seen = [];
        const client = new SealedClient({
            channel: shim,
            send: async (env) => {
                seen.push(JSON.stringify(env));
                const reply = await responder.handle(tamper(env));
                seen.push(JSON.stringify(reply));
                return reply;
            },
        });
        return { client, seen, responder };
    }

    const allowed = toolsForScope(['accounts']);
    const execute = (tool, args) => {
        if (!allowed.has(tool)) throw new Error('not_in_scope');
        return handleTool(tool, STATE, args);
    };

    it('runs a tool call and the relay sees only ciphertext', async () => {
        const { client, seen } = await rig(execute);
        const out = await client.call('get_accounts', {});
        expect(out).toBeTruthy();
        const wire = seen.join('');
        expect(wire).not.toContain('get_accounts');
        expect(wire).not.toContain('Cash');
    });

    it('surfaces an out-of-scope tool as a sealed error', async () => {
        const { client } = await rig(execute);
        await expect(client.call('get_transactions', {})).rejects.toThrow(
            'not_in_scope',
        );
    });

    it('a relay replaying a request gets no second answer', async () => {
        const { shim, browser } = await pair();
        const responder = new SealedResponder({ channel: browser, execute });
        const env = await shim.seal({
            id: 'req-0000-0001',
            tool: 'get_accounts',
            args: {},
            deadline: Date.now() + 10_000,
        });
        expect(await responder.handle(env)).not.toBeNull();
        expect(await responder.handle(env)).toBeNull();
    });

    it('ignores an expired request', async () => {
        const { shim, browser } = await pair();
        const responder = new SealedResponder({ channel: browser, execute });
        const env = await shim.seal({
            id: 'req-0000-0002',
            tool: 'get_accounts',
            args: {},
            deadline: Date.now() - 1,
        });
        expect(await responder.handle(env)).toBeNull();
    });

    it('a reply from the wrong request id is refused', async () => {
        const { shim, browser } = await pair();
        const client = new SealedClient({
            channel: shim,
            send: async () => browser.seal({ id: 'someone-else', ok: true }),
        });
        await expect(client.call('get_accounts', {})).rejects.toMatchObject({
            code: 'id_mismatch',
        });
    });
});

describe('fire-bridge shim', () => {
    it('lists the same tools as the stdio server and refuses unknown ones', async () => {
        const { TOOLS } = await import('../../app/mcp-tools.mjs');
        const calls = [];
        const server = buildShim({
            call: async (name, args) => {
                calls.push([name, args]);
                return { ok: 1 };
            },
        });
        const handlers = server._requestHandlers;
        const list = await handlers.get('tools/list')(
            { method: 'tools/list' },
            {},
        );
        expect(list.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
        const bad = await handlers.get('tools/call')(
            { method: 'tools/call', params: { name: 'delete_everything' } },
            {},
        );
        expect(bad.isError).toBe(true);
        expect(calls).toEqual([]);
        const good = await handlers.get('tools/call')(
            { method: 'tools/call', params: { name: TOOLS[0].name } },
            {},
        );
        expect(good.content[0].text).toContain('"ok": 1');
    });

    it('the HTTP carrier posts JSON and returns the envelope', async () => {
        let seen;
        const carrier = createHttpCarrier(
            'https://relay.example/sealed/',
            'sid/with space',
            async (url, init) => {
                seen = { url, body: init.body };
                return { ok: true, json: async () => ({ envelope: { v: 1 } }) };
            },
        );
        expect(await carrier({ envelope: { v: 1 } })).toEqual({ v: 1 });
        expect(seen.url).toBe(
            'https://relay.example/sealed/sid%2Fwith%20space',
        );
        const fail = createHttpCarrier('https://r.example', 'x', async () => ({
            ok: false,
            status: 502,
        }));
        await expect(fail({})).rejects.toThrow('relay_502');
    });
});

describe('SealedChannel guards', () => {
    it('refuses to send past the counter limit', async () => {
        const { shim } = await pair();
        shim.sendSeq = Number.MAX_SAFE_INTEGER;
        await expect(shim.seal({})).rejects.toMatchObject({
            code: 'seq_exhausted',
        });
        expect(SealedChannel).toBeTypeOf('function');
    });
});
