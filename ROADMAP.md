updated: 2026-08-12

# 🗺️ FIRE Tracker Roadmap

---

## Q2 2026 ✅ — Foundation & Core Calculators

> Completed. Full tracker foundation shipped — see FEATURES.md for all shipped capabilities.

## Q3 2026 ✅ — Side Hustle Hub & Auto-Calculators

> Completed. All Q3 items shipped — see FEATURES.md.

## Q4 2026: Advanced Scenarios & Integrations 🧪

- [x] Multi-scenario FIRE comparison (salary bumps, market downturns, inflation spikes)
- [x] Webhook-based sync templates with JSONata data mapping and HMAC verification
- [x] MCP server — 8 read-only tools for Claude/LLM integration
- [x] Mobile-responsive layout
- [x] Retirement projection drawdown & depletion age (money run-out detection)
- [x] Milestone presets — 5 financial profiles with dynamic targets
- [x] Diversification tips redesign — dismissible tiles with curated links
- [x] Unified Settings page — notifications, export/import, projection defaults, privacy/terms, danger zone
- [x] eBay & Plaid integration UI — connection status, Plaid Link SDK
- [x] Vehicle estimate overlay — complete CSS styling
- [ ] Tax drag estimation engine (custom federal/state brackets, capital gains)
- [ ] Webhook sync end-to-end testing
- [ ] Lightweight PWA packaging

---

## PROD Phase 1 — Real-Time Data Connectors (Q1 2027) 🔌

Goal: replace manual CSV imports with automated, API-driven data ingestion for key sources.
Full detail: [docs/prod-plan.md](docs/prod-plan.md)

### eBay API Connector
- [ ] eBay OAuth 2.0 app credentials (BYOK: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_REFRESH_TOKEN`)
- [ ] `/api/sync/ebay/sync` — pull completed orders into sideGigLedger automatically
- [ ] eBay Order API deduplication via stable `orderId`
- [ ] Fee rate table validation against current eBay published rates
- [ ] Sandbox/production environment toggle (`EBAY_ENVIRONMENT`)

### Web3 / Crypto Wallet Tracking
- [ ] `wallets[]` schema in db.json (address, chain, label, lastBalance, lastFetched)
- [ ] Wallet CRUD: `POST/GET/DELETE /api/wallets`
- [ ] Etherscan API — ETH + ERC-20 token balances (BYOK: `ETHERSCAN_API_KEY`)
- [ ] BNB Smart Chain via BscScan (BYOK: `BSCSCAN_API_KEY`)
- [ ] Polygon via Polygonscan (BYOK: `POLYGONSCAN_API_KEY`)
- [ ] Arbitrum via Arbiscan (BYOK: `ARBISCAN_API_KEY`)
- [ ] Base via Basescan (BYOK: `BASESCAN_API_KEY`)
- [ ] Avalanche via Routescan (optional BYOK: `ROUTESCAN_API_KEY`)
- [ ] Bitcoin via Blockstream.info (no key required)
- [ ] Solana via public RPC (no key required)
- [ ] `config/chains.json` registry — add chains without code changes
- [ ] Wallet USD totals aggregated into net worth; existing manual Crypto-type accounts show a migration prompt to link a wallet address or keep as manual override (no silent double-counting)
- [ ] MCP tool: `get_wallets`

### Vehicle Value API
- [ ] NHTSA VIN decode (free, confirms vehicle identity)
- [ ] Vehicle value BYOK integration (env var: `VEHICLE_VALUE_API_KEY`)
- [ ] Auto-refresh vehicle values on dashboard load

### Encrypted Cloud Backup
- [ ] Google Drive API via service account key (BYOK: `GDRIVE_SERVICE_ACCOUNT_JSON`)
- [ ] `POST /api/backup/drive` — encrypt + upload backup
- [ ] `GET /api/backup/drive/list` — list available backups
- [ ] Restore flow: download → decrypt → apply

---

## PROD Phase 2 — Financial Institution Integration (Q2 2027) 🏦

Goal: real-time read-only position and balance sync from major brokerages and banks.

### Fidelity / Plaid Integration
- [ ] Plaid Link embedded UI (BYOK: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`)
- [ ] `/api/sync/plaid/create-link-token` + `/api/sync/plaid/exchange`
- [ ] Position sync → replaces manual CSV import
- [ ] Account balance sync → `customAccounts`
- [ ] Transaction import → expense categorization
- [ ] Encrypted token storage with auto-refresh

### Real-Time Price Improvements
- [ ] Replace Yahoo Finance crumb hack with stable quote API (Alpha Vantage or Polygon.io, BYOK)
- [ ] CoinGecko free API for crypto token prices (no key for basic tier)
- [ ] Server-Sent Events (SSE) for live price push to browser dashboard

### Car Values
- [ ] Free fallback: NHTSA VIN + manual refresh prompt
- [ ] Premium: KBB API or DataOne.io (BYOK)

---

## PROD Phase 3 — Security Hardening (Q3 2027) 🔐

Goal: harden the system for shared-machine and LAN-facing use.
Full detail: [docs/security-hardening.md](docs/security-hardening.md)

- [ ] Rate limiting on all `/api/*` routes (express-rate-limit, per-IP + per-key)
- [ ] HTTPS via Caddy reverse proxy in docker-compose.yml
- [ ] Security headers (helmet.js: CSP, HSTS, X-Frame-Options)
- [ ] `SESSION_SECRET` fail-fast in production if default/unset
- [ ] `FIRE_API_KEY` required by default (opt-out for local-only mode)
- [ ] Webhook payload size cap (16KB)
- [ ] Webhook sideGigLedger field-level schema validation
- [ ] `npm audit` CI gate (fail on high/critical prod deps)
- [ ] SYNC_MASTER_KEY rotation endpoint (atomically re-encrypt both `db.json` and `data/tokens.json` with new key; backup old ciphertext before write)
- [ ] MCP audit log (tool name, timestamp, response byte size — no content)
- [ ] Account/position identifier truncation in MCP responses
- [ ] Penetration testing checklist (see docs/security-hardening.md)

---

## PROD Phase 4 — Feature Parity (Q4 2027) 🚀

Goal: match Fidelity NetBenefits + Rocket Money from a tracking standpoint while preserving local-first privacy.

- [ ] Portfolio rebalancing suggestions (target vs. actual allocation)
- [ ] Tax-loss harvesting alerts (unrealized loss detection)
- [ ] Income vs. expense 12-month rolling trend
- [ ] PWA — installable, offline-capable
- [ ] Notification system (CD maturity alerts, FIRE milestone push)
- [ ] Optional multi-user mode (separate encrypted db.json per user, auth-gated)
