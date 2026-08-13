## updated: 2026-08-12

# Tasks

---

## In Progress

_(none — see ROADMAP.md for phase details)_

---

## Q4 2026 — Current Cycle

- [ ] Webhook sync end-to-end testing (template CRUD → ingest → db.json verification)
- [ ] Tax drag estimation engine (custom federal/state brackets + capital gains config)
- [ ] PWA packaging for offline access

---

## PROD Phase 1 — Real-Time Data Connectors (Q1 2027)

### eBay API Connector
- [ ] Document eBay Developer program signup and app creation steps in docs/integrations.md
- [ ] Add `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_REFRESH_TOKEN`, `EBAY_ENVIRONMENT` to `.env.example`
- [ ] `app/routes/sync.js`: add `/api/sync/ebay/authorize` (OAuth initiation)
- [ ] `app/routes/sync.js`: add `/api/sync/ebay/callback` (code exchange + encrypted token storage)
- [ ] `app/routes/sync.js`: add `/api/sync/ebay/sync` (Order API pull → sideGigLedger dedup)
- [ ] `app/routes/sync.js`: add `/api/sync/ebay/refresh` (access token refresh)
- [ ] Validate eBay fee rates in `finance-platforms.js` against current published rates
- [ ] UI toggle in settings to enable/disable eBay sync and show last-sync timestamp

### Web3 / Crypto Wallet Tracking
- [ ] `app/lib/db.js`: add `wallets: []` to `defaultState()` schema
- [ ] Define wallet schema: `{ id, address, chain, label, lastBalance, lastFetched }`
- [ ] `app/routes/wallets.js`: `POST /api/wallets` — add wallet (validate address format per chain)
- [ ] `app/routes/wallets.js`: `GET /api/wallets` — list with last known balances
- [ ] `app/routes/wallets.js`: `DELETE /api/wallets/:id` — remove wallet
- [ ] `app/routes/wallets.js`: `POST /api/wallets/refresh` — trigger balance refresh
- [ ] `app/lib/web3-prices.js`: ETH + ERC-20 balance fetch via Etherscan API (BYOK)
- [ ] `app/lib/web3-prices.js`: BNB via BscScan, Polygon via Polygonscan, Arbitrum via Arbiscan, Base via Basescan
- [ ] `app/lib/web3-prices.js`: Bitcoin balance via Blockstream.info (no key)
- [ ] `app/lib/web3-prices.js`: Solana balance via public `mainnet-beta` RPC (no key)
- [ ] `config/chains.json`: chain registry (id, name, apiBase, envKey, nativeSymbol, coingeckoId)
- [ ] Wallet USD value = balance × CoinGecko price; roll into net worth under "Crypto Wallets"
- [ ] `app/mcp-server.mjs`: add `get_wallets` tool (chain, address last 6 chars, label, USD balance)
- [ ] UI: wallet manager section in Financial Overview tab (add/remove wallets, balance display)
- [ ] Add `ETHERSCAN_API_KEY`, `BSCSCAN_API_KEY`, `POLYGONSCAN_API_KEY`, `ARBISCAN_API_KEY`, `BASESCAN_API_KEY` to `.env.example`

### Vehicle Value API
- [ ] NHTSA VIN decode fetch on vehicle save (free, `https://vpic.nhtsa.dot.gov/api/`)
- [ ] Add `VEHICLE_VALUE_API_KEY` to `.env.example` with notes on supported providers
- [ ] `app/routes/vehicles.js` (or inline): `POST /api/vehicles/:id/refresh-value` — fetch + update currentValue
- [ ] UI: "Refresh Value" button on vehicle cards with last-updated timestamp

### Google Drive Encrypted Backup
- [ ] Add `GDRIVE_SERVICE_ACCOUNT_JSON` to `.env.example`
- [ ] `app/routes/backup.js`: `POST /api/backup/drive` — AES-encrypt db.json + upload to Drive
- [ ] `app/routes/backup.js`: `GET /api/backup/drive/list` — list backup files in Drive folder
- [ ] `app/routes/backup.js`: `POST /api/backup/drive/restore` — download + decrypt + apply
- [ ] UI: backup panel in settings (trigger, list, restore buttons)
- [ ] Document Google service account setup in docs/integrations.md

---

## PROD Phase 2 — Financial Institution Integration (Q2 2027)

### Fidelity / Plaid
- [ ] Research Fidelity direct API availability (may require partner program; Plaid is primary fallback)
- [ ] Add `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` to `.env.example`
- [ ] `app/routes/sync.js`: `POST /api/sync/plaid/create-link-token`
- [ ] `app/routes/sync.js`: `POST /api/sync/plaid/exchange` (public_token → encrypted access_token)
- [ ] `app/routes/sync.js`: `POST /api/sync/plaid/positions` — sync positions → `importedPositions`
- [ ] `app/routes/sync.js`: `POST /api/sync/plaid/accounts` — sync balances → `customAccounts`
- [ ] `app/routes/sync.js`: `POST /api/sync/plaid/transactions` — parse into expense categories
- [ ] Implement token refresh loop with re-encryption on each refresh cycle
- [ ] Disable manual Fidelity CSV import UI when Plaid sync is active (prevent duplicates)

### Real-Time Price Improvements
- [ ] Add `ALPHA_VANTAGE_API_KEY` or `POLYGON_API_KEY` to `.env.example` as Yahoo Finance alternative
- [ ] `app/lib/yahoo-prices.js`: abstract price provider interface; swap implementation via env var
- [ ] CoinGecko integration in `app/lib/web3-prices.js` for token USD prices
- [ ] SSE endpoint `GET /api/prices/stream` for live price push to browser

---

## PROD Phase 3 — Security Hardening (Q3 2027)

See [docs/security-hardening.md](docs/security-hardening.md) for full remediation detail.

- [ ] `npm install express-rate-limit` → add to all `/api/*` routes (30/min unauthed, 300/min authed)
- [ ] Caddy reverse proxy in `config/docker-compose.yml` for HTTPS on localhost
- [ ] `config/Caddyfile` with TLS auto-cert for localhost
- [ ] `app/server.js`: fail-fast if `SESSION_SECRET` is default/unset in `NODE_ENV=production`
- [ ] Flip `FIRE_API_KEY` to required by default; add `FIRE_AUTH_DISABLED=true` opt-out
- [ ] Webhook payload size cap: `express.raw({ limit: '16kb' })` on webhook routes
- [ ] Webhook `sideGigLedger` field-level schema validation (id, description, net, date)
- [ ] `.github/workflows/ci.yml`: add `npm audit --audit-level=high --omit=dev` step
- [ ] `npm install helmet` → CSP, HSTS, X-Frame-Options, X-Content-Type-Options headers
- [ ] `POST /api/admin/rotate-key` — re-encrypt db.json with new SYNC_MASTER_KEY
- [ ] MCP audit log (`data/mcp-audit.log`): tool name, timestamp, response byte size
- [ ] `app/mcp-server.mjs`: truncate account/position identifiers to last 4 chars in responses
- [ ] Vitest test asserting no write tools are registered in MCP server
- [ ] Run full penetration testing checklist from docs/security-hardening.md

---

## PROD Phase 4 — Feature Parity (Q4 2027)

- [ ] Portfolio rebalancing suggestions (target allocation config + current allocation diff)
- [ ] Tax-loss harvesting alert (flag positions with unrealized losses ≥ threshold)
- [ ] Income vs. expense 12-month rolling trend view
- [ ] PWA: `manifest.json` + service worker for installable offline mode
- [ ] CD maturity and FIRE milestone notification system
- [ ] Optional multi-user mode (separate encrypted db.json per user, HTTP Basic auth gate)

---

## Completed ✅

- [x] MCP server — 8 read-only tools (fire_status_summary, get_net_worth, get_accounts, get_portfolio, get_cds, get_expenses, get_projection_settings, get_side_gig_income)
- [x] Webhook sync framework with JSONata mapping and HMAC-SHA256 verification
- [x] AES-256-GCM encryption of db.json at rest (SYNC_MASTER_KEY)
- [x] OAuth stub scaffold (/api/sync/init, /api/sync/callback)
- [x] Yahoo Finance live price fetching (crumb-based auth, stale fallback, 5-min TTL)
- [x] Fidelity CSV import (multi-account aggregation)
- [x] Chase / Capital One statement parsing with auto-categorization
- [x] eBay / Etsy / Facebook fee calculators (manual-entry, server-side)
- [x] Multi-scenario FIRE comparison (salary bumps, market downturns, inflation)
- [x] Chart line toggles (NW, 75/100/125% FIRE goals, Coast FIRE, US Median)
- [x] Risk concentration badges (⚡ ≥15%, ⚠ ≥20%) on investment positions
- [x] CD ladder visualizer with annual yield badges
- [x] Real estate and vehicle trackers
- [x] Mobile-responsive layout
- [x] XSS hardening (escHtml + data-* event delegation pattern)
- [x] Atomic db.json writes (write-to-tmp then renameSync)
- [x] Concurrent write safety (mutateState() promise queue)
- [x] Webhook deduplication by stable upstream ID or content fingerprint
- [x] Financial Overview tab (unified Accounts + CDs + Cash Flow)
- [x] Header summary bar (allocation bars, income, FIRE progress %)
- [x] Diversification suggestion block
- [x] 198 unit/integration tests, 88% coverage
