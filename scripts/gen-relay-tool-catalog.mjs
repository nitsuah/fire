// Regenerates relay/tool-catalog.json from app/mcp-tools.mjs. The relay lists
// tools without importing the finance code, so the catalog is a checked-in
// copy of name, description and inputSchema; a unit test fails when it drifts.
// Run: node scripts/gen-relay-tool-catalog.mjs
import fs from 'node:fs';
import { TOOLS } from '../app/mcp-tools.mjs';

const catalog = TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
}));
fs.writeFileSync(
    new URL('../relay/tool-catalog.json', import.meta.url),
    JSON.stringify(catalog, null, 2) + '\n',
);
console.log(`wrote ${catalog.length} tools`);
