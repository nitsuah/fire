# Features

`nitsuah/fire` is a lightweight FIRE (Financial Independence, Retire Early) Tracker and API Server, built with JavaScript, designed for efficient financial management and programmatic access.

## Core Functionality

- **Net Worth Tracking** — Monitor assets and liabilities to calculate overall net worth in real time.
- **Asset & Liability Management** — Record and manage custom accounts, CDs, real estate, and vehicles.
- **Fidelity CSV Import** — Parses Fidelity brokerage position exports; aggregates symbols, quantities, and cash; dedupes settled cash from P&L.
- **Local Storage Sync** — All data persists in browser localStorage with Import/Export JSON backup utility.
- **Docker Environment** — Node/Alpine container on port 8080 with volume-mounted data/ for consistent local dev.

## Investments Dashboard

- **P&L Table** — Red-green color scale, sortable faceted columns with inline totals, pie-chart filter that greys non-selected slices.
- **Risk Concentration Badges** — ⚡ for positions ≥15% of portfolio, ⚠ for ≥20%; market return comparison badges per position.
- **Diversification Suggestion Block** — Allocation-aware tips surfaced inline with the investments view.
- **Collapse-All Toggle** — Collapses investment rows; cost basis included in facet totals.

## Retirement Projections

- **Net Worth Projections Engine** — SWR curves (3%, 3.5%, 4%) with retirement age predictions and milestone forecasts.
- **Time-Period Filters** — 1M / 1Y / 5Y / 10Y / 15Y+ buttons on both retirement growth charts.
- **Chart Line Toggles** — Toggle NW, 75%/100%/125% FIRE goals, Coast FIRE, and US Median benchmark independently.
- **Bull/Bear Scenario Bands** — Clickable +2%/−2% offset buttons update the growth path in real time.
- **CD Maturity Markers** — Overlaid on the dashboard retirement growth chart to show liquidity events.

## Asset Trackers

- **Real Estate Tracker** — Manual entry with property name, value, equity, and mortgage details.
- **Vehicle Tracker** — Make/model/year, current value, loan balance, and depreciation estimate; fleet summary view.
- **CD Tracker** — Annual yield badge on the CDs Maturing Soon dashboard card.

## Dashboard & UX

- **Glassmorphic Dark Theme** — High-end HTML5 layout with CSS glassmorphism.
- **Header Summary Bar** — Mini allocation bars, Annual Income metric, and FIRE Progress bar with percentage displayed inside.
- **Financial Overview Tab** — Unified Accounts + CDs & Fixed Income tab with Monthly Cash Flow section (income vs. expenses, savings rate, annual surplus/deficit).
- **Dashboard Layout** — Growth + investments left column; allocation + stats + CDs right column.

## Planned

- **Side Hustle Tracker** — Manual logs for Etsy, FB Marketplace, Craigslist, and eBay with fee/margin calculator.
- **Chase / Capital One CSV Import** — Auto-categorize credit card statement debits into monthly cash flow.
- **CD Ladder Visualizer** — Timeline view of upcoming maturities with aggregate yield overlays.
- **Tax Drag Estimation Engine** — Custom federal/state bracket support with capital gains configuration.
- **Multi-Scenario FIRE Comparison** — Compare FIRE dates across salary bumps, market downturns, and inflation spikes.
- **PWA Packaging** — Offline access and lightweight installable app.
