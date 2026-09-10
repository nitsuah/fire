updated: 2026-08-28

# Tasks

---

## In Progress

_(none — all Q4 2026 tasks complete; see ROADMAP.md for phase details)_

---

## Q4 2026 — Current Cycle ✅ COMPLETE

> Note: a prior audit found this section contradicting ROADMAP.md — two items
> below were checked off `[x]` here while their own note said "deferred" (not
> actually implemented), while ROADMAP.md correctly left them unchecked under
> Q4 2026 / PROD Phase 4. Un-checked below to match reality; they're tracked
> once, under PROD Phase 2 / Phase 4 respectively, not also claimed done here.

- [x] Webhook sync end-to-end testing (template CRUD → ingest → db.json verification)
- [x] Retirement projection drawdown & depletion age (money run-out detection)
- [x] Milestone presets — 5 financial profiles with dynamic targets
- [x] Diversification tips redesign — dismissible tiles with curated links
- [x] Unified Settings page — notifications, export/import, projection defaults, privacy/terms, danger zone
- [x] eBay & Plaid integration UI — connection status, Plaid Link SDK
- [x] Vehicle estimate overlay — complete CSS styling
- [x] Fix retirement projection syntax error (duplicate return block)
- [x] All 251 tests passing (16 test files)

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
- [ ] Close the branch/function coverage gap (68.33% branch vs. 70% threshold, 75.67% functions vs. 80%).
  - Priority: P2
  - Context: statement and line coverage clear the target but branch and function coverage don't — `config/vitest.config.ts` thresholds are stricter than the blanket 80% METRICS.md target implies. `app/server.js` (41.83% stmts) is the single biggest gap.
  - Acceptance Criteria: `npm run test:coverage` reports branch ≥70% and functions ≥80%; new tests target untested branches in `app/server.js` and the sync route error paths rather than padding easy files.

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
- [x] 251 unit/integration tests, 81.1% statement / 80.9% line coverage (measured 2026-08-28; target 80% statements/lines met, branch 68.33% and function 75.67% remain below their 70%/80% thresholds — see PROD Phase 3 below)
