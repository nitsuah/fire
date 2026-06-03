## updated: 2026-06-03

# Tasks

## Done

- [x] Create workspace documentation structure (`README.md`, `ROADMAP.md`).
- [x] Outline project goals and architecture.
- [x] Build application foundation and design system.
- [x] Implement Fidelity positions CSV parsing and import dashboard.
- [x] Build Net Worth Projections engine with SWR curves and milestone predictions.
- [x] Dockerize local environment (Node/Alpine, port 8080, volume-mounted data/).
- [x] Implement manual entry interfaces for custom accounts, Cash, and CDs.
- [x] Local storage sync with Import/Export JSON backup utility.
- [x] P&L table polish — red-green color scale, sortable faceted columns, pie filter.
- [x] Dashboard layout reorganization — growth + investments left, allocation + stats + CDs right.
- [x] Time-period filter buttons (1M / 1Y / 5Y / 10Y / 15Y+) on retirement growth charts.
- [x] CD maturity markers on dashboard retirement growth chart.
- [x] Real estate tracker — manual entry with equity/mortgage/gain tracking.
- [x] Vehicle tracker — make/model/year/loan/depreciation with fleet summary.
- [x] Retirement chart line toggles + scenario bands (Bull/Bear) + US Median benchmark.
- [x] CD annual yield badge on dashboard CDs Maturing Soon card.
- [x] Header restructure — mini allocation bars, income metric, FIRE progress bar.
- [x] Investments: collapse-all, cost basis in facet totals, settled cash excluded from PnL.
- [x] Investments: risk concentration badges and market return comparison badges.
- [x] Investments: diversification suggestion block.
- [x] Financial Overview tab (merged Accounts + CDs) + Monthly Cash Flow section.

## Todo

### P2 - Extensions & Auto-Parsing
- [ ] Expand CSV parsing to support Chase and Capital One credit card statement uploads.
  - Priority: P2
  - Context: Parse bank statement debits to auto-categorize and update expense baselines.
  - Acceptance Criteria: Parsed debits are logged and reflected in monthly cash flow section.
- [ ] Create Side Hustle Tracker enhancements — Etsy/FB Marketplace log support.
  - Priority: P2
  - Context: Expand side gig ledger to support multiple platform categories beyond eBay.

### P3 - Visualization & Polish
- [ ] CD Ladder visualizer — timeline view of upcoming maturities with yield overlays.
- [ ] Add tooltips and explanation indicators for financial metrics (SWR, FIRE number, etc.).
- [ ] Mobile-responsive layout adjustments for tablet/phone.

### Q3/Q4 Backlog
- [ ] Tax drag estimation engine with custom federal/state bracket support.
- [ ] Multi-scenario FIRE date comparison (salary bumps, inflation spikes, market downturns).
- [ ] PWA packaging for offline access.
