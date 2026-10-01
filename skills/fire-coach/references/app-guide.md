# Using the fire app

Where things live, so you can send the user straight to the right control.
Hosted demo: https://lifefire.netlify.app/. Self-hosted: `docker compose up -d`
→ https://localhost.

## Header (every tab)

Estimated Net Worth (with allocation mini-bars), Annual Income (plus
interest/yield and side income), Annual Spend Rate, and a **FIRE Progress**
bar showing the target and years to FIRE. The 🔔 bell lists alerts (CD
maturities, FIRE milestones, big price moves). On phones these collapse into
one tappable summary bar.

## Tabs

| Tab | Cards |
| --- | --- |
| **Dashboard** | Retirement Growth Path (1M–All windows, ⤢ full width, 🌪️ Chaos), Top Investment Positions, Asset Allocation (click a slice to drill down), Cash & Fixed Income, Other Assets, Net Worth History |
| **Financial Overview** | Net Monthly Cash Flow, Income Sources, Monthly Expenses; one add form (Import CSV · Account/Asset · CD · Real Estate · Vehicle); Crypto Wallets; Holdings; Properties; Vehicles; CD Ladder |
| **Expenses** | Basic Budget & Expenses (with insurance, normalized to monthly), Tax Estimator & Summary, Spending Upload (auto-categorized CSV + Category Mapping) |
| **Insights** | Portfolio Insights tiles, Portfolio Rebalancing (target % → suggested trades), Tax-Loss Harvesting Alerts |
| **Side Hustle Hub** | Platform Fee Calculator (eBay/Etsy/Facebook), Side Hustle Accelerators, eBay Sales Sync, Side Gig Ledger (tax tags, item cost) |
| **Projections** | Growth Settings (presets, Customize ▾ form, Milestone Focus), Retirement Growth Path (line toggles, Bear/Base/Bull, 🌪️ Chaos), Milestone Predictions, Scenario Comparison |
| **Settings** | Projection Defaults, Notifications & Alerts, Plaid Transaction Sync, Privacy & Terms, Data Management (JSON/CSV export & import), Google Drive Backup (encrypted), Danger Zone |

## Getting data in

- **Fastest start:** Financial Overview → add form → **Import CSV**
  (Fidelity positions; Chase/Capital One statements; eBay sales reports).
  Everything is parsed locally.
- **Manual:** the same form's Account/Asset, CD, Real Estate and Vehicle
  options. Gold/silver are valued by weight × live spot price. For crypto,
  enter an ENS name, 0x address or ticker.
- **Synced (self-hosted, opt-in):** Plaid (Settings), eBay (Side Hustle Hub →
  eBay Sales Sync), wallets (Crypto Wallets).
- **Spending:** Expenses → Spending Upload, then adjust the categories.
  Budget numbers drive the FIRE number.

## Projections — what the knobs do

- **Growth Settings → Customize ▾**: current/retire age, annual savings,
  nominal return, inflation, SWR, span. Presets: Conservative, Standard,
  Aggressive, Early Retiree. All math is in real dollars, and after the
  retirement age withdrawals come from cash first.
- **Line toggles:** Net Worth, 100% FIRE, 75% Lean, 125% Fat, Coast, US
  Median peer benchmark, Scenarios (bull/bear band).
- **Bear / Base / Bull:** shifts the expected return by −2 / 0 / +2 points.
- **🌪️ Chaos** (also on the Dashboard chart): adds realistic random life
  events to the net worth path. There are 30 predefined events in 8
  categories: health, pets, family, career, housing, auto, windfalls, and
  legal/money. Examples are gallbladder surgery, cat cancer, a child,
  a new job, a roof, a job loss and an unexpected windfall.
  - Each event has a life-average yearly probability and an age window
    (weddings and children skew young, joint replacements older, career
    events stop at retirement). Outcomes come from a small predefined set
    with sensible costs, e.g. gallbladder surgery is $2.5k, $6k or $14k.
  - **One-time** events (surgery, a roof) drop or lift the line once.
    **Long-term** ones change cash flow for years: a child is −$8k to
    −$16k/yr for 18 years, a promotion adds to savings until retirement.
  - ▲ green markers are increases and ▼ red are decreases; the ring color is
    the category. Hover or tap the line for the events nearest that age and
    their dollar impact. The gray dashed line is the path without chaos, and
    chips under the chart list every event in the selected window. The
    Dashboard folds them under "details".
  - Density follows the window: at least 1 event in the first year and 3 per
    5 years, averaging about 0.7 a year over a lifetime.
  - The timeline is seeded, so it stays the same across reloads and window
    changes. **🎲** rerolls a different life. The toggle is saved per browser.
  - Use it to size the emergency fund and to see how much buffer the plan has.
- **Milestone Predictions** shows when they reach emergency fund, Coast, Lean,
  FIRE and Fat. **Scenario Comparison** shows how the FIRE age moves with
  savings ±, bear markets and inflation.

## Customizing the layout

- **Collapse:** click any card title (or focus it and press Enter). This is
  remembered.
- **✎ Customize** (top right of every tab): drag ⠿ with a mouse or finger,
  or use ↑ ↓ to reorder. On the Dashboard, cards can also move between
  columns. **↺ Reset** restores the tab's default order.
- **Dashboard widgets:** in Customize mode, **＋ Add widget** pins any card
  from another tab to the Dashboard. Its home tab shows a placeholder with
  "Go to Dashboard" / "Move back here". **✕** removes a Dashboard card; add it
  back from the same picker.
- The layout is saved in this browser (localStorage), like the chart size.

## Ask Claude (MCP)

With the repo's `.mcp.json` (set `cwd` to the checkout), Claude Code gets 16
read-only tools: `fire_status_summary`, `get_net_worth`, `get_net_worth_trend`,
`get_accounts`, `get_portfolio`, `get_cds`, `get_expenses`,
`get_projection_settings`, `get_side_gig_income`, `get_side_gig_tax_summary`,
`get_wallets`, `get_concentration_risk`, `get_diversification_score`,
`get_swr_sensitivity`, `simulate_rebalance`, `get_emergency_runway`. None of
them trade or change anything.

## Privacy

Self-hosted data lives in `data/db.json` (optionally AES-256-GCM encrypted
with `SYNC_MASTER_KEY`). For the hosted demo, see `docs/privacy-policy.md`.
Integrations are opt-in and read-only toward financial accounts.
