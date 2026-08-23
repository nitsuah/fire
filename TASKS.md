updated: 2026-08-22

# Tasks

---

## In Progress

- [ ] Restore test coverage to ≥80% threshold — new Phase 1/2 code (eBay, Plaid, wallets, backup, vehicles, prices-provider) is largely untested; coverage_summary.txt shows ~26% vs 80% target

---

## Q4 2026 — Current Cycle

- [ ] Webhook sync end-to-end testing (template CRUD → ingest → db.json verification)
- [ ] Tax drag estimation engine (custom federal/state brackets + capital gains config)
- [ ] PWA packaging for offline access

---

## PROD Phase 1 — Real-Time Data Connectors (now live)

### eBay API Connector
- [ ] Validate eBay fee rates in `finance-platforms.js` against current published rates
- [ ] UI toggle in settings to enable/disable eBay sync and show last-sync timestamp
- [ ] Write tests for `app/lib/ebay-connector.js` and the 4 eBay sync routes

### Web3 / Crypto Wallet Tracking
- [ ] UI: wallet manager section in Financial Overview tab (add/remove wallets, balance display)
- [ ] Write tests for `app/routes/wallets.js` and `app/lib/web3-prices.js`

### Vehicle Value API
- [ ] UI: "Refresh Value" button on vehicle cards with last-updated timestamp
- [ ] Write tests for `app/routes/vehicles.js` and `app/lib/vehicle-api.js`

### Google Drive Encrypted Backup
- [ ] UI: backup panel in settings (trigger, list, restore buttons)
- [ ] Write tests for `app/routes/backup.js` and `app/lib/gdrive-backup.js`

---

## PROD Phase 2 — Financial Institution Integration (partially live)

### Fidelity / Plaid
- [ ] `POST /api/sync/plaid/transactions` — parse into expense categories
- [ ] Disable manual Fidelity CSV import UI when Plaid sync is active (prevent duplicates)
- [ ] Write tests for Plaid routes in `app/routes/sync.js`

### Real-Time Price Improvements
- [ ] Write tests for `app/lib/prices-provider.js` (Alpha Vantage + Polygon paths)

---

## PROD Phase 3 — Security Hardening (mostly done; remaining items)

See [docs/security-hardening.md](docs/security-hardening.md) for full remediation detail.

- [ ] Caddy reverse proxy in `config/docker-compose.yml` for HTTPS on localhost
- [ ] `config/Caddyfile` with TLS auto-cert for localhost
- [ ] Flip `FIRE_API_KEY` to required by default; add `FIRE_AUTH_DISABLED=true` opt-out
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

- [x] MCP server — 12 functional tools + 7 registered stubs (fire_status_summary, get_net_worth, get_accounts, get_portfolio, get_cds, get_expenses, get_projection_settings, get_side_gig_income, get_wallets, get_concentration_risk, simulate_rebalance, get_emergency_runway)
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
- [x] 198 unit/integration tests (coverage ~26% after Phase 1-3 additions; target 80% — see In Progress)
