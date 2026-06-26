/* 
   backend-sync-architecture.md
   Draft architecture for secure OAuth/Sync handling.
   
   1. Token Storage: Use env var for master key to encrypt tokens.
      Store encrypted tokens in a dedicated file (or new table if DB scales).
   2. Proxy: New endpoints in server.js:
      - GET /api/sync/init: Redirect to OAuth provider.
      - GET /api/sync/callback: Exchange code for tokens, store encrypted.
      - GET /api/sync/data: Read stored tokens, proxy request to Fidelity/aggregator.
*/
