/* ==========================================================================
   mcp-tools.browser.mjs — The browser's MCP tool core, loaded on demand by the
   hosted consent page (mcp-connect.js) once the user approves a session.

   It re-exports the same synchronous handleTool the stdio MCP server uses
   (app/mcp-tools.mjs), whose helpers are native ES modules, so the browser
   loads them as-is: no bundler, no build step. The bridge host still checks
   scope, expiry and size before and after every call.
   ========================================================================== */

export { handleTool } from '../mcp-tools.mjs';
