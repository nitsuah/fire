import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Static checks on how the shared escHtml helper is declared and loaded.
const ROOT = path.join(__dirname, '../..');
const APP_LIB = path.join(ROOT, 'app/lib');

const listJsFiles = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return listJsFiles(full);
        return entry.name.endsWith('.js') ? [full] : [];
    });

describe('shared escHtml helper', () => {
    it('is declared by exactly one file under app/lib', () => {
        const declaring = listJsFiles(APP_LIB)
            .filter((file) =>
                /\bfunction\s+escHtml\s*\(/.test(fs.readFileSync(file, 'utf8')),
            )
            .map((file) => path.relative(ROOT, file).split(path.sep).join('/'));
        expect(declaring).toEqual(['app/lib/html-utils.js']);
    });

    it('is loaded by app/index.html before every lib/tables script', () => {
        const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
        const srcs = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(
            (m) => m[1],
        );
        const utilsIndex = srcs.indexOf('lib/html-utils.js');
        expect(utilsIndex).toBeGreaterThanOrEqual(0);
        const tableSrcs = srcs.filter((src) => src.startsWith('lib/tables/'));
        expect(tableSrcs.length).toBeGreaterThan(0);
        for (const src of tableSrcs) {
            expect(srcs.indexOf(src), src).toBeGreaterThan(utilsIndex);
        }
    });
});
