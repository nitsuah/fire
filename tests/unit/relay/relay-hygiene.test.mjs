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

const BANNED_MODULES =
    /^(node:)?(fs|fs\/promises|sqlite|better-sqlite3|redis|pg|mysql2?|mongodb)$/;

// A small scanner that tells code from comments and strings. Returns the
// source without comments (`kept`, strings intact, for module specifiers) and
// the same with string contents blanked (`blanked`, for API-name checks).
function scan(src) {
    let kept = '';
    let blanked = '';
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        const n = src[i + 1];
        if (c === '/' && n === '/') {
            while (i < src.length && src[i] !== '
') i++;
        } else if (c === '/' && n === '*') {
            const end = src.indexOf('*/', i + 2);
            i = end === -1 ? src.length : end + 2;
        } else if (c === "'" || c === '"' || c === '`') {
            let j = i + 1;
            while (j < src.length && src[j] !== c) j += src[j] === '\' ? 2 : 1;
            const lit = src.slice(i, j + 1);
            kept += lit;
            blanked += c + ' '.repeat(Math.max(0, lit.length - 2)) + c;
            i = j + 1;
        } else {
            kept += c;
            blanked += c;
            i++;
        }
    }
    return { kept, blanked };
}

/** Storage-API violations in relay source (comments ignored). */
function findStorageViolations(source) {
    const { kept, blanked } = scan(source);
    const src = blanked;
    const found = [];
    // Imports, re-exports, dynamic imports and require, by module specifier.
    const specifiers = [
        ...kept.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
        ...kept.matchAll(/\bimport\s*\(?\s*['"]([^'"]+)['"]/g),
        ...kept.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]/g),
    ].map((m) => m[1]);
    for (const spec of specifiers) {
        if (BANNED_MODULES.test(spec)) found.push(`module ${spec}`);
    }
    const patterns = [
        [/\brequire\s*\(/, 'require'],
        [/\.\s*storage\b/, 'storage property'],
        [/\b(set|get|delete)Alarm\b/, 'alarm'],
        [/\bKV(Namespace)?\b|\bD1Database\b|\bR2Bucket\b/, 'KV/D1/R2'],
        [
            /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bcaches\b/,
            'browser storage',
        ],
        [
            /\bacceptWebSocket\b|\bsetWebSocketAutoResponse\b|\bgetWebSockets\b/,
            'hibernation API',
        ],
    ];
    if (/\[\s*['"`]storage['"`]\s*\]/.test(kept)) {
        found.push('storage property');
    }
    for (const [re, label] of patterns) {
        if (re.test(src)) found.push(label);
    }
    return found;
}

describe('storage guard (fixtures)', () => {
    it.each([
        ["import fs from 'node:fs';", 'module'],
        ["export { readFile } from 'node:fs/promises';", 'module'],
        ["const m = await import('fs');", 'module'],
        ["const fs = require('fs');", 'require'],
        ['await state.storage.put(k, v);', 'storage property'],
        ["await state['storage'].get(k);", 'storage property'],
        ['await this.state.storage.setAlarm(1);', 'alarm'],
        ['env.CACHE_KV; const x = KVNamespace;', 'KV'],
        ['ctx.acceptWebSocket(ws);', 'hibernation'],
        ["localStorage.setItem('a', 'b');", 'browser storage'],
    ])('flags %s', (code, kind) => {
        const hits = findStorageViolations(code);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.join(' ')).toContain(kind.split(' ')[0]);
    });

    it('ignores comments and harmless code', () => {
        const code = [
            "// import fs from 'node:fs'; state.storage.put()",
            '/* ctx.acceptWebSocket(ws) */',
            "import { x } from './session.mjs';",
            'const storageful = 1; const kv = 2;',
            'const ok = 1; // state.storage.put()',
            "const s = 'ctx.acceptWebSocket and localStorage'; /* x */",
            'const t = `state.storage`;',
        ].join('\n');
        expect(findStorageViolations(code)).toEqual([]);
    });
});

describe('relay stays memory-only (design §3, C1)', () => {
    it('has relay files to check', () => {
        expect(files).toContain('session.mjs');
    });

    it.each(files)('%s imports and calls no storage API', (f) => {
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        expect(findStorageViolations(src)).toEqual([]);
    });

    it.each(files)('%s has no console or direct logging calls', (f) => {
        const src = scan(fs.readFileSync(path.join(dir, f), 'utf8')).blanked;
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
