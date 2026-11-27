// tests/site/tool-count.test.js
// Verifies the marketing page accurately reflects the canonical MCP tool registry.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const INDEX_HTML = resolve('site/index.html');
const MCP_TOOLS = resolve('app/mcp-tools.mjs');

function parseToolListFromHtml(html) {
    const ulMatch = html.match(/<ul class="tools"[^>]*>([\s\S]*?)<\/ul>/);
    if (!ulMatch) return [];
    const ulContent = ulMatch[1];
    const lis = ulContent.match(/<li>([^<]+)<\/li>/g) || [];
    return lis.map((li) => li.replace(/<\/?li>/g, '').trim());
}

function parseCanonicalToolsFromRegistry(registryJs) {
    const toolsMatch = registryJs.match(/export const TOOLS = \[([\s\S]*?)\];/);
    if (!toolsMatch) return [];
    const toolsContent = toolsMatch[1];
    const names = [];
    let match;
    const nameRegex = /name:\s*'([^']+)'/g;
    while ((match = nameRegex.exec(toolsContent)) !== null) {
        names.push(match[1]);
    }
    return names;
}

function parseStatNumber(html) {
    const match = html.match(
        /<span class="stat-num">(\d+)<\/span><span class="stat-label">read-only MCP tools/,
    );
    return match ? parseInt(match[1], 10) : null;
}

function parseMcpSectionCount(html) {
    const match = html.match(/It exposes (\d+) tools, all read-only/);
    return match ? parseInt(match[1], 10) : null;
}

// Load files
const html = readFileSync(INDEX_HTML, 'utf-8');
const registry = readFileSync(MCP_TOOLS, 'utf-8');

// Parse data
const displayedTools = parseToolListFromHtml(html);
const canonicalTools = parseCanonicalToolsFromRegistry(registry);
const statCount = parseStatNumber(html);
const mcpSectionCount = parseMcpSectionCount(html);

const requiredMissing = [
    'get_upcoming_events',
    'get_insurances',
    'get_transactions',
    'get_recurring_charges',
];

describe('site/index.html tool count', () => {
    it('hero stat shows 20', () => {
        expect(statCount).toBe(20);
    });

    it('MCP section text says 20', () => {
        expect(mcpSectionCount).toBe(20);
    });

    it('tool list has 20 entries', () => {
        expect(displayedTools).toHaveLength(20);
    });

    it('all canonical tools are in the displayed list', () => {
        for (const tool of canonicalTools) {
            expect(displayedTools).toContain(tool);
        }
    });

    it('the four previously missing tools are present', () => {
        for (const tool of requiredMissing) {
            expect(displayedTools).toContain(tool);
        }
    });

    it('displayed list matches canonical registry exactly (same set)', () => {
        const displayedSet = new Set(displayedTools);
        const canonicalSet = new Set(canonicalTools);
        expect(displayedSet.size).toBe(canonicalSet.size);
        for (const tool of canonicalSet) {
            expect(displayedSet).toContain(tool);
        }
        for (const tool of displayedSet) {
            expect(canonicalSet).toContain(tool);
        }
    });
});
