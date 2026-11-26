# Cloudflare Pages deploy

The hosted browser app is moving from Netlify to Cloudflare Pages (free plan).
The Netlify config stays in place and working until DNS for `fire.nitsuah.io`
is switched.

- **Project:** `lifefire` on Cloudflare Pages, Git-connected to `nitsuah/fire`,
  production branch `main`, preview deployments off.
- **Static files:** served from `app/` (same as Netlify's `publish = "app"`),
  with `app/_headers` applied as-is.
- **API:** `functions/api/[[path]].js` handles every `/api/*` request and
  dispatches through `cloudflare/router.mjs`. The route table mirrors the
  `[[redirects]]` in `netlify.toml` one for one, and the handlers are the
  Netlify Functions in `netlify/functions/` (already Web-standard
  `Request -> Response`), so every public URL, OAuth callback and the eBay
  marketplace-account-deletion endpoint stay the same.
  `tests/unit/cloudflare-pages.test.mjs` fails if the two drift.
- **Runtime:** `nodejs_compat`, set in `wrangler.toml` (the Pages build only applies it to the Functions bundle when it is in that file). Vars and secrets set on the Pages project are
  copied into `process.env` before each request.
- **Local:** `npx wrangler pages dev app --compatibility-flags nodejs_compat`
  with secrets in `.dev.vars` (git-ignored).

## Relay Worker

The hosted MCP browser bridge runs a separate Cloudflare Worker (Durable Object) for
the WebSocket relay. Its config is `relay/wrangler.toml` and is **not** part of the
Pages project.

- **File:** `relay/wrangler.toml`
- **Dry-run:** `wrangler deploy --dry-run --config relay/wrangler.toml` (passes on `main`)
- **Owner-only steps (from #515):**
  - Create the Worker account / namespace
  - `wrangler secret put RELAY_HMAC_KEY --config relay/wrangler.toml`
  - Choose the Workers plan (SQLite-backed Durable Objects run on the Free plan, within its limits)
  - Add any custom routes
  - `wrangler deploy --config relay/wrangler.toml`

The root `wrangler.toml` belongs to the Pages app and is left alone.
