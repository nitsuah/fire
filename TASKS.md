## updated: 2026-06-02

# Tasks

## Done

- [x] Create workspace documentation structure (`README.md`, `ROADMAP.md`).
- [x] Outline project goals and architecture.

## In Progress

- [/] Build application foundation and design system.
  - Priority: P1
  - Context: Need to create HTML/CSS skeleton with modern dark glassmorphic styling, side nav, and content pane.
  - Acceptance Criteria: Navigation tabs switch sections correctly and responsive layouts work on desktop/mobile.

- [/] Implement Fidelity positions CSV parsing and import dashboard.
  - Priority: P1
  - Context: Extract investment data from Fidelity's standard export spreadsheet format and dynamically populate the tracker.
  - Acceptance Criteria: Uploading `Portfolio_Positions_Jun-02-2026.csv` computes correct net worth (~$457,838 based on the CSV data) and splits asset holdings dynamically.

- [/] Build Net Worth Projections engine.
  - Priority: P1
  - Context: Generate a line chart detailing net worth growth over 10-40 years, showing target FIRE thresholds under customizable SWR (3% - 4%).
  - Acceptance Criteria: Interactive Chart.js graph draws projections correctly using inputs like annual salary savings, expected returns, and inflation.

## Todo

### P1 - Core App & Data
- [ ] Dockerize local environment.
  - Priority: P1
  - Context: Create a Dockerfile using Nginx Alpine to serve static files.
  - Acceptance Criteria: App builds and runs successfully via container on port 8080.
- [ ] Implement manual entry interfaces for custom accounts, Cash, and CDs.
  - Priority: P1
  - Context: Allow users to append financial sources that aren't imported via CSV, including detailed CD entries (principal, rate, maturity).
  - Acceptance Criteria: Manual entries are saved in localStorage, editable, deletable, and sum into the aggregate Net Worth display.
- [ ] Local storage backup & restore.
  - Priority: P1
  - Context: Provide JSON configuration import/export tools in the dashboard.
  - Acceptance Criteria: Clicking export downloads a `.json` file; uploading the file restores state perfectly.

### P2 - Extensions & Side Income
- [ ] Create Side Hustle Tracker & eBay Profit Calculator.
  - Priority: P2
  - Context: Add a side gig tab with flip estimator computations (fees, margins, postage) and logs.
  - Acceptance Criteria: Calculated eBay fees match actual tier standards, margins update dynamically, and entries save successfully.
- [ ] Create Chase / Capital One CSV statement upload.
  - Priority: P2
  - Context: Parse bank statement uploads to track expenditures and estimate annual/monthly expense baselines automatically.
  - Acceptance Criteria: Parsed debits are logged and factored into annual expense estimates.

### P3 - Polish
- [ ] Add tooltips and explanation indicators for financial metrics (e.g. SWR, CD yield, FIRE target).
- [ ] Set up CD maturity reminders / notifications visual banner.
