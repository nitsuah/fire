# 🔥 FIRE Tracker

[![CI](https://github.com/nitsuah/fire/actions/workflows/ci.yml/badge.svg)](https://github.com/nitsuah/fire/actions/workflows/ci.yml)

> A self-hosted Financial Independence, Retire Early (FIRE) tracker and API server. Runs locally via Docker. All financial data is stored in `data/db.json` on your machine with optional AES-256-GCM encryption (`SYNC_MASTER_KEY`). Currently read-only and offline-first; being productionized toward real-time API-driven sync (eBay, Web3 wallets, Fidelity/Plaid) in PROD Phases 1–4. See [docs/prod-plan.md](docs/prod-plan.md).

---

## Features

- **Net Worth Dashboard** — real-time tracking of accounts, CDs, real estate, vehicles, and investments
- **Retirement Projections** — SWR curves (3 – 4%), bull/bear scenarios, portfolio drawdown after retirement age
- **Investment P&L Table** — sortable, color-coded, allocation filter with pie chart, risk concentration badges
- **CD Ladder Visualizer** — timeline of upcoming maturities with yield overlays
- **Side Hustle Tracker** — income logs + built-in eBay/platform fee calculator
- **CSV Imports** — Fidelity positions, Chase and Capital One statements (all processed locally)
- **REST API** — full CRUD for accounts, CDs, state; optional `FIRE_API_KEY` header auth
- **MCP Server** — 8 read-only tools for Claude/LLM integration via `app/mcp-server.mjs`
- **Yahoo Finance prices** — live portfolio valuation with crumb-based auth and stale-data fallback
- **Webhook sync framework** — JSON data-mapped templates for automated data ingestion

---

## Quick Start

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
# Clone and start
git clone https://github.com/nitsuah/fire.git
cd fire
docker compose -f config/docker-compose.yml up -d
```

Open **http://localhost:3001** in your browser.

```bash
# Stop
docker compose -f config/docker-compose.yml down

# Rebuild after dependency changes
docker compose -f config/docker-compose.yml build
docker compose -f config/docker-compose.yml up -d --force-recreate
```

---

## Environment Variables

Copy `.env.example` to `.env` and set values as needed. All are optional for basic local use.

| Variable | Purpose |
|---|---|
| `PORT` | Server port (default `3001`) |
| `FIRE_API_KEY` | When set, all `/api/*` routes require `X-Api-Key: <value>` |
| `SYNC_MASTER_KEY` | 64-hex-char key to encrypt `db.json` at rest with AES-256-GCM |
| `SESSION_SECRET` | Secret for signing session cookies (random string; warn logged if unset) |

Generate keys:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## MCP Server (Claude Integration)

Connect Claude Code to your live financial data. The project ships a `.mcp.json` that Claude Code picks up automatically on startup — edit the `cwd` to match your local path:

```json
{
  "mcpServers": {
    "fire-tracker": {
      "command": "node",
      "args": ["app/mcp-server.mjs"],
      "cwd": "/your/path/to/fire"
    }
  }
}
```

**Available tools:** `fire_status_summary`, `get_net_worth`, `get_accounts`, `get_portfolio`, `get_cds`, `get_expenses`, `get_projection_settings`, `get_side_gig_income`

Smoke-test locally:
```bash
docker compose -f config/docker-compose.yml exec fire node scripts/test-mcp.mjs
```

---

## Data & Privacy

- All financial data is stored in `data/db.json` inside the project directory (Docker volume-mounted).
- No data is ever transmitted to external services except optional Yahoo Finance price fetches.
- Optionally encrypt `db.json` at rest with `SYNC_MASTER_KEY` (AES-256-GCM).
- Export/restore a full JSON backup any time from the dashboard.

---

## Architecture

```
fire/
├── app/
│   ├── index.html              # Single-page app entry point
│   ├── server.js               # Express server (port 3001)
│   ├── mcp-server.mjs          # MCP server — 8 read-only tools
│   ├── lib/
│   │   ├── db.js               # State persistence (db.json, atomic writes)
│   │   ├── crypto-utils.js     # AES-256-GCM encrypt/decrypt
│   │   ├── finance-calcs.js    # Server-side projection engine
│   │   ├── html-utils.js       # XSS escape utility (shared by table renderers)
│   │   ├── yahoo-prices.js     # Yahoo Finance price fetcher
│   │   ├── webhook-integration.js # Webhook payload handler
│   │   ├── charts/             # Chart.js renderers
│   │   ├── tables/             # Table renderers
│   │   └── managers/           # UI CRUD managers
│   └── routes/
│       ├── state.js            # GET / POST /api/state
│       ├── accounts.js         # CRUD /api/accounts
│       ├── cds.js              # CRUD /api/cds
│       ├── prices.js           # GET /api/prices
│       └── sync.js             # Webhook / OAuth sync
├── config/
│   ├── docker-compose.yml
│   ├── Dockerfile              # node:22-alpine
│   └── eslint.config.mjs
├── scripts/
│   └── test-mcp.mjs            # MCP smoke test (all 8 tools)
├── data/                       # db.json lives here (git-ignored)
├── docs/                       # Architecture notes
├── .env.example                # Environment variable reference
├── .mcp.json                   # MCP server config for Claude Code
└── package.json                # fire-tracker v1.1.0
```

---

## Development

```bash
# Run tests inside Docker
docker compose -f config/docker-compose.yml exec fire npm test

# Run tests with coverage
docker compose -f config/docker-compose.yml exec fire npm run test:coverage

# Lint
docker compose -f config/docker-compose.yml exec fire npm run lint
```

---

## Planned Integrations

The system is being productionized toward real-time, API-driven data in four phases. All planned connections are opt-in, BYOK, and read-only with respect to external accounts.

| Integration | Phase | Status |
|---|---|---|
| eBay Order API (auto-import sales) | Phase 1 | Planned |
| Web3 wallet tracking (ETH, BTC, SOL, + EVM chains) | Phase 1 | Planned |
| Google Drive encrypted backup | Phase 1 | Planned |
| Vehicle value API (NHTSA VIN + KBB) | Phase 1 | Planned |
| Fidelity / Plaid positions + balance sync | Phase 2 | Planned |
| Stable stock quote API (Alpha Vantage / Polygon.io) | Phase 2 | Planned |
| Security hardening (rate limiting, HTTPS, CSP) | Phase 3 | Planned |

See [docs/prod-plan.md](docs/prod-plan.md) for the full productionization roadmap and [docs/integrations.md](docs/integrations.md) for per-integration setup instructions.

---

## Roadmap & Tasks

- Productionization plan → [docs/prod-plan.md](docs/prod-plan.md)
- Integration setup → [docs/integrations.md](docs/integrations.md)
- Security hardening → [docs/security-hardening.md](docs/security-hardening.md)
- Sync architecture → [docs/backend-sync-architecture.md](docs/backend-sync-architecture.md)
- Milestones → [ROADMAP.md](ROADMAP.md)
- Task backlog → [TASKS.md](TASKS.md)
- Shipped features → [FEATURES.md](FEATURES.md)
