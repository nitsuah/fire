import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FrameType } from '../../../app/bridge-protocol.mjs';
import { connect, send, setup } from './helpers.mjs';

const dir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../relay',
);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'));
const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('relay stays memory-only (design §3, C1)', () => {
    it('has relay files to check', () => {
        expect(files).toContain('session.mjs');
    });

    it.each(files)('%s imports and calls no storage API', (f) => {
        const src = stripComments(fs.readFileSync(path.join(dir, f), 'utf8'));
        const banned = [
            /\bimport\b[^;]*['"](node:)?(fs|fs\/promises|sqlite|better-sqlite3|redis|pg|mysql2?|mongodb)['"]/,
            /\brequire\s*\(/,
            /\.storage\b/,
            /\bsetAlarm\b|\bgetAlarm\b|\bdeleteAlarm\b/,
            /\bblockConcurrencyWhile\b.*storage/,
            /\bKV(Namespace)?\b|\bD1Database\b|\bR2Bucket\b/,
            /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bcaches\b/,
            /\bacceptWebSocket\b|\bsetWebSocketAutoResponse\b|\bgetWebSockets\b/,
        ];
        for (const re of banned) expect(src).not.toMatch(re);
    });

    it.each(files)('%s has no console or direct logging calls', (f) => {
        const src = stripComments(fs.readFileSync(path.join(dir, f), 'utf8'));
        expect(src).not.toMatch(/\bconsole\./);
    });

    it('uses the standard WebSocket accept(), never the hibernation API', () => {
        const src = fs.readFileSync(
            path.join(dir, 'session-object.mjs'),
            'utf8',
        );
        expect(src).toMatch(/server\.accept\(\)/);
    });
});

describe('relay logging carries no payload, token or session id', () => {
    it('after a full call, captured logs hold only coarse event names', async () => {
        const ctx = setup();
        const { socket } = await connect(ctx);
        const secretArg = 'SECRET-ARG-VALUE';
        const secretResult = 'SECRET-RESULT-BALANCE-12345';
        const p = ctx.session.dispatchCall('get_net_worth', { q: secretArg });
        const call = socket.last(FrameType.CALL);
        await send(ctx.session, socket, {
            v: 1,
            type: FrameType.RESULT,
            sid: ctx.sid,
            id: call.id,
            ok: true,
            content: { note: secretResult },
        });
        await p;
        ctx.session.end('done');
        expect(ctx.logs.length).toBeGreaterThan(0);
        const text = JSON.stringify(ctx.logs);
        for (const s of [
            secretArg,
            secretResult,
            ctx.sid,
            call.id,
            'good-pending',
        ]) {
            expect(text).not.toContain(s);
        }
        for (const e of ctx.logs) expect(e).toMatch(/^[a-z_]+$/);
    });

    it('the log sink ignores event names outside the allow-list', () => {
        const ctx = setup();
        ctx.session.log(`leak ${ctx.sid}`);
        expect(ctx.logs).toEqual([]);
    });
});
