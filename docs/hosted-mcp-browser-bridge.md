# Hosted MCP Browser Bridge — Design

> 🧭 [fire](../README.md) · [Features](./FEATURES.md) · [Roadmap](./ROADMAP.md) · [Tasks](./TASKS.md) · [Changelog](./CHANGELOG.md) · [Metrics](./METRICS.md) <!-- nav -->
>
> **Status:** Proposed. This is a design for review, not an implementation brief (#341).
> **Last updated:** 2026-11-19
> **Parent:** #266 (remote MCP). The self-hosted half is #492.
> **See also:** [security-hardening.md](security-hardening.md), [privacy-policy.md](privacy-policy.md), [prod-plan.md](prod-plan.md#mcp-security-model)

---

## 1. Goal and constraints

A remote agent (for example a Claude connector added by URL) should be able to use fire's read-only MCP tools against the **hosted** deploy (fire.nitsuah.io / lifefire.netlify.app). On the hosted deploy the financial state lives only in the user's browser (`fire_tracker_state` in `localStorage`). The server has no copy and must not get one. The browser tab is the data source, and the server only relays messages in flight.

The owner approved this constraint set on 2026-11-18. Each constraint is a requirement in this design:

| # | Constraint | Where it is met |
|---|---|---|
| C1 | No user data at rest on the relay | §3 (memory-only relay, no storage API, no body logging) |
| C2 | Short-lived sessions | §6 |
| C3 | Replay protection | §7 |
| C4 | Keys held in the browser | §5 |
| C5 | A written threat model for the relay | §9 |

The design also keeps these invariants:

- **The self-hosted `/mcp` is unchanged.** It keeps its bearer `FIRE_API_KEY` behind Caddy and reads local `db.json` (#492). Nothing here touches `app/server.js`, `app/routes/` or the stdio server's behavior.
- **The tools stay read-only.** The bridge exposes the same tools as `app/mcp-server.mjs`, and the read-only rule is enforced in the browser, not by the relay.
- **The browser is the policy enforcement point.** Scope, lifetime and rate limits are checked in the browser as well as the relay, so a relay that misbehaves cannot widen them (§9).

### Context the design depends on

- The hosted deploy has **no user accounts**. "Signed in" means "this browser profile holds the data". OAuth consent therefore has to happen in the browser that holds the data (§5.2).
- `app/mcp-server.mjs` imports Node-only modules (`fs`, `db.js`) and writes an audit log to disk. Its `TOOLS` and `handleTool(name, state, args)` are already separate from the transport, and `handleTool` takes the state as an argument. The browser needs a build of the tool layer without the Node imports (child 1, §11).
- Netlify Functions cannot hold WebSockets, each invocation is stateless, and every invocation costs credits (see the `ignore` rule in `netlify.toml`).
- Standard remote MCP clients speak Streamable HTTP with OAuth 2.1 (protected-resource metadata, authorization-server metadata, dynamic client registration, PKCE `S256`). They do not speak any custom encryption layer.

---

## 2. Architecture overview

```
 MCP client                    Relay (memory only)                 Browser tab (fire app)
 (e.g. a Claude connector)                                         holds fire_tracker_state
     │                                │                                     │
     │ 1. POST /mcp (Bearer)  TLS     │                                     │
     │───────────────────────────────▶│ 2. CALL frame (seq, id, deadline)   │
     │                                │────────────────────────────────────▶│ 3. check scope/TTL/rate,
     │                                │        WebSocket (TLS)              │    handleTool(state)
     │                                │◀────────────────────────────────────│ 4. RESULT frame (id)
     │◀───────────────────────────────│ 5. JSON-RPC response                │
     │                                │                                     │
```

- **Hop 1:** MCP client to relay. Streamable HTTP over TLS, OAuth bearer token. Each `tools/call` is one POST answered with `application/json` once the browser replies. There is no long-lived SSE stream; `GET /mcp` returns `405`.
- **Hop 2:** relay to browser. One WebSocket per bridge session, opened by the browser, authenticated with a browser-held key (§5).
- The public MCP URL is `https://fire.nitsuah.io/mcp` (on the app's routes). A Netlify `200` rewrite proxies `/mcp` and the OAuth well-known paths to the relay. The browser opens its WebSocket **directly** to the relay host, because Netlify cannot proxy WebSockets. The relay host is added to `connect-src` in `app/_headers`.

---

## 3. Transport decision

| Option | How it works | Verdict |
|---|---|---|
| A. Netlify Functions + SSE or long-poll + mailbox | The MCP POST and the browser's poll land on different stateless instances, so they meet in a shared store (Netlify Blobs). | **Rejected.** The mailbox is user data at rest, even as ciphertext, and Blobs has no native TTL, so it needs a sweeper (fails C1). An open tab polls all day, which costs a function invocation per poll. Function time limits bound every wait. |
| B. Netlify + hosted pub/sub (Ably, Pusher, …) | A third-party channel carries the frames. | **Rejected.** Another processor sees the traffic and needs its own account and keys. It adds a party to the threat model for no gain over C. |
| C. Small dedicated relay, memory only | One process (or one isolate per session) holds the browser WebSocket and the waiting MCP request in memory and pairs them. | **Chosen.** Nothing is written to disk. A restart drops every session, which is acceptable because sessions are short (C2) and the user re-consents. |

**Relay host (owner decision D2, §10):** the recommendation is **Cloudflare Workers + one Durable Object per bridge session**, using in-memory fields only. It must not call the Durable Object Storage API, and it must not use WebSocket hibernation attachments to hold anything except the session id. A single Node process (on Fly.io or a small VPS) is an equivalent fallback. The protocol core (§4, §7) is a host-agnostic module, so either host, or later the self-hosted Express server, can run it.

Relay rules that make C1 testable:

- No storage API, file, database or cache writes. A unit test fails if the relay module imports one.
- No request or response bodies, tokens or frame payloads in logs. Logs carry only counters and coarse events (`session_opened`, `call_timeout`), with no session id, client IP or tool arguments. A test greps the relay source for logging calls that take payload variables, and a runtime test checks captured logs after a full call.
- Hosting-provider request logs see only paths. No secret goes in a URL except the standard single-use, 60-second OAuth `code` on the client's redirect.

---

## 4. Bridge protocol (hop 2)

All frames are JSON over the WebSocket. Every frame has `v` (protocol version, `1`), `type`, and `sid` (session id).

| Frame | Direction | Fields | Purpose |
|---|---|---|---|
| `HELLO` | browser → relay | `pub` (session public key, JWK), `pendingAuth?` | Open or resume a session |
| `CHALLENGE` | relay → browser | `nonce` (128-bit random), `exp` | Proof of possession |
| `PROVE` | browser → relay | `sig` over `"fire-bridge/v1" ‖ relayOrigin ‖ sid ‖ nonce` | Answers the challenge |
| `READY` | relay → browser | `expiresAt`, `idleTimeout` | Session live |
| `CALL` | relay → browser | `seq`, `id` (128-bit random), `deadline`, `tool`, `args` | One tool call |
| `RESULT` | browser → relay | `id`, `ok`, `content` or `error` | Answer to exactly one `CALL` |
| `END` | either | `reason` | Session over (user disconnect, expiry, revoke) |

Limits (proposed defaults): 15 s per call deadline, 4 calls in flight per session, 256 KB per `RESULT` (larger results return `result_too_large`, and tools that can grow, such as `get_transactions`, must paginate), 30 calls per minute per session. The relay sends WebSocket ping frames every 20 s. The browser answers pings at the protocol level, so background-tab timer throttling does not drop the connection.

---

## 5. Keys and authentication

### 5.1 Browser session key (C4)

- When the user approves a connection, the bridge host tab generates an **ECDSA P-256 key pair** with WebCrypto, `extractable: false`. The private key never leaves the browser, is never put in `localStorage` or `fire_tracker_state`, and so never lands in JSON or Drive backups. It lives in memory for the life of the tab (it may be held in IndexedDB as a non-extractable `CryptoKey` only to survive a reload within the reconnect grace window, and is deleted when the session ends).
- The relay stores only the **public** key, in memory, mapped to the session id. Every WebSocket (re)connect proves possession through `CHALLENGE`/`PROVE`, so stealing a session id alone does not let anyone attach a fake browser.
- One key per session. Ending the session deletes the key, so there is no long-term browser identity to steal.

### 5.2 OAuth binding (hop 1)

The relay is both the MCP resource server and the OAuth authorization server. It follows the MCP authorization spec: protected-resource metadata, authorization-server metadata, dynamic client registration (registrations are kept in memory with a 24 h TTL, and a client that gets `invalid_client` after a restart registers again), PKCE `S256` required, and the `resource` parameter checked against the MCP URL.

1. The MCP client calls `POST /mcp` without a token and gets `401` with `WWW-Authenticate: Bearer resource_metadata=…`.
2. The client discovers the endpoints, registers, and sends the user to `GET /authorize?client_id…&code_challenge…&state…&scope…`.
3. The relay validates the request, keeps it as a **pending authorization** (5 min TTL, random id), and redirects to the app's consent page: `https://fire.nitsuah.io/#/mcp-connect?req=<id>`. The user lands in **their own browser, where the data lives**. If that profile has no fire data, the page says so and stops.
4. The consent page shows the client name (labelled as self-asserted), the **redirect URI host** (the trustworthy part), the requested tool groups (the user can untick any, for example transactions), and the session length. It is `frame-ancestors 'none'`, as the whole app already is.
5. On **Approve**, the consent tab asks the bridge host tab over a same-origin `BroadcastChannel` to open a session. If no fire tab is open, the consent tab becomes the bridge host itself and tells the user to keep it open. The bridge host generates the session key, connects, sends `HELLO` with `pendingAuth=<id>`, and completes `PROVE`.
6. The relay mints a single-use **authorization code** (60 s TTL) bound to the pending authorization **and** the now-live session id, then the consent tab navigates to the relay's `/authorize/complete`, which `302`s to the registered `redirect_uri` with `code` and `state`.
7. The client exchanges the code (with the PKCE verifier) at `/token` for an **opaque access token** (256-bit random; the relay keeps only its SHA-256 in memory) whose lifetime is the session's remaining lifetime. **No refresh tokens are issued.** When the session ends, the token is dead, and the client must run the flow again, which again needs the browser.

Binding summary: access token → session id → browser public key → a live, proven WebSocket. Any of the three ending ends the others.

### 5.3 What "end-to-end" can and cannot mean (owner decision D1, §10)

A standard MCP client terminates TLS at the relay and expects plaintext JSON-RPC back. **So with stock MCP clients the relay necessarily handles tool calls and results in plaintext, in memory, for the duration of each call.** No browser-held key can change that, because the client holds no matching key. The design states this rather than adding a cosmetic encryption layer that the relay itself would decrypt.

Two modes:

- **Connector mode (default, phase 1).** Works with any MCP client by URL. The relay sees plaintext in memory per call and stores nothing. The threat model (§9) states what that exposes, and the consent page and privacy policy disclose it.
- **Sealed mode (optional, phase 2).** For true end-to-end, the user runs a small local stdio shim (`fire-bridge`) as their MCP server. The shim and the browser derive a key that the relay never sees: the browser shows a **pairing string** (its ephemeral ECDH P-256 public key plus a 128-bit random secret), the user pastes it into the shim, the shim sends its own ephemeral public key through the relay, and both sides compute `HKDF-SHA256(ECDH(shared) ‖ secret, info="fire-bridge/v1/sealed" ‖ sid)` into two directional AES-256-GCM keys. Because the secret travels out of band, a relay that swaps public keys cannot derive the keys. In this mode `CALL`/`RESULT` carry only ciphertext, and the relay sees metadata alone.

---

## 6. Session lifetime (C2)

| Item | Default | Enforced by |
|---|---|---|
| Pending authorization | 5 min | relay |
| Authorization code | 60 s, single use | relay |
| Session hard maximum (and access-token lifetime) | 60 min from approval (user may pick 15/30/60) | relay **and** browser |
| Idle timeout (no tool calls) | 10 min | relay **and** browser |
| Reconnect grace after the WebSocket drops | 30 s, then the session ends | relay |
| Client registration | 24 h, memory only | relay |

- The browser keeps its own copy of `expiresAt`, the idle timer and the granted scope, and refuses `CALL`s outside them even if the relay sends them.
- The app shows a "Connected agent" banner with the client name, time left, a live count of calls, and **Disconnect**. Disconnect sends `END`; the relay revokes the token at once.
- A relay restart ends every session. No state is persisted to recover them, by design.

### Failure behavior

| Situation | What the MCP client sees | What the user sees |
|---|---|---|
| Tab closed, browser offline, laptop asleep | Within grace: the call waits up to its deadline. After grace: `401 invalid_token`, so the client re-authorizes. | The session is gone when the tab returns, and a new connection needs consent. |
| Call deadline passes | Tool result with `isError: true`, "fire did not answer in time" | Nothing (the call is logged as timed out in the local activity log) |
| Several fire tabs open | No difference | One tab holds a Web Locks (`navigator.locks`) lock and hosts the bridge; the others show "Agent connected in another tab". If the host tab closes, the session ends (the key went with it). |
| Data changes mid-session | The next call reads the current `localStorage` state | Nothing |
| Rate or size limit hit | Tool error `rate_limited` / `result_too_large` | Shown in the activity log |
| Mobile tab suspended | Same as tab closed | Same |

---

## 7. Replay protection (C3)

| Layer | Threat | Control |
|---|---|---|
| OAuth | Code interception or reuse | PKCE `S256` required; codes single use, 60 s; `state` echoed; `redirect_uri` exact match against the registration |
| OAuth | Stolen access token reused later | Token lives at most as long as the session (≤ 60 min) and dies on disconnect, idle or browser loss; stored only hashed; TLS only |
| WebSocket auth | Replayed `PROVE` | Fresh 128-bit `nonce` per connect, 10 s expiry, signature covers relay origin and session id; a nonce is accepted once |
| `CALL` frames | Relay (or anything between) replays or reorders a call | Strictly increasing `seq` per session; the browser rejects `seq ≤ last`, an unknown `sid`, or a passed `deadline`; each `id` is answered at most once |
| `RESULT` frames | Late or duplicate answers | The relay accepts one `RESULT` per outstanding `id`, and drops any that arrive after the deadline or for an unknown `id` |
| Sealed mode | Ciphertext replay | AES-GCM with a 96-bit nonce built from a per-direction counter; AAD = `sid ‖ direction ‖ seq`; a counter that does not increase is rejected |

Even a successful replay could only re-run a read-only tool within the granted scope, and the browser still counts it against its rate limit and shows it in the activity log.

---

## 8. Data handling

- The browser runs the same `handleTool` against its in-memory state and applies the same output minimization as self-hosted MCP (identifier truncation, H-11 in [security-hardening.md](security-hardening.md)).
- The browser keeps a **local activity log** (timestamp, tool, bytes, outcome; no arguments or results) in `localStorage`, outside `fire_tracker_state`, capped at 200 entries. It is the hosted counterpart of `data/mcp-audit.log`.
- The relay holds, in memory only: client registrations, pending authorizations, token hashes, session ids, session public keys, and, for at most the call deadline, the in-flight `CALL`/`RESULT`. Nothing else.

---

## 9. Threat model (C5)

### Assets

1. The financial state in the browser (`fire_tracker_state`).
2. Tool results in flight.
3. Access tokens and authorization codes.
4. The browser session private key.
5. Metadata: who connects, when, which client, call counts and sizes.

### Trust boundaries

Browser profile (trusted, holds the data) · Relay process and its host (trusted to forward, **not** trusted with policy) · MCP client and the agent behind it (trusted only within the consented scope) · Network (untrusted) · Other websites (untrusted).

### What an attacker who holds only the relay can do

This is the question the issue asks directly. Assume full control of the relay code and memory, but not of the user's browser.

**Can:**

- In connector mode, **read the tool results of calls made during active sessions**, while they pass through.
- **Issue its own read-only tool calls** during an active session, within the scope the user granted, until the session's expiry. The browser accepts any `CALL` with a valid `seq`, so it cannot tell these from the agent's calls.
- Deny service: drop or delay calls, end sessions.
- See metadata: client names, redirect hosts, timing, sizes, tool names, client IPs.
- Run a fake consent flow for a client it controls, but only if the user approves it on the consent page.

**Cannot:**

- Read anything when no session is active, or read data at rest. There is none on the relay.
- Read the whole state at once. It is limited to what the granted tools return, in the browser's 256 KB result cap and 30 calls per minute.
- Write or change user data. There are no write tools, and the browser enforces that, not the relay.
- Widen scope, extend a session past the browser's own `expiresAt`, or skip the idle timeout. The browser enforces all three independently.
- Impersonate the browser to the client after the tab is gone, since it lacks the private key and the browser ends the session.
- In sealed mode, read calls or results at all. It sees metadata only.

**Mitigations for what it can do:** short sessions, scope selection on the consent page, the browser-side rate limit, the visible "Connected agent" banner with a live call counter and Disconnect, the local activity log (calls the agent did not make show up there), and sealed mode for users who need content confidentiality from the relay.

### Other threats

| Threat | Control | Residual |
|---|---|---|
| Network attacker | TLS on both hops; HSTS on the app | None beyond TLS |
| Malicious or prompt-injected agent | Read-only tools; scope selection; rate limit; session lifetime | It can read what the user granted, which is the purpose of the feature |
| Consent phishing (attacker registers a client and sends the user an authorize link) | The consent page shows the redirect host prominently and labels the client name as unverified; explicit click needed; pending request expires in 5 min | A user who approves an attacker's client leaks the granted scope for ≤ 60 min |
| Clickjacking the consent page | `frame-ancestors 'none'` (already set) | None |
| XSS in the fire app | Existing CSP; the bridge adds only the relay host to `connect-src` | XSS already has the whole state, so the bridge does not widen it, but it must not add a new script source |
| Stolen session id | `PROVE` with the non-extractable key on every connect | None |
| Stolen access token | Hashed at rest in memory, short life, ends with the session | Usable until the session ends |
| Hosting provider logs | No bodies or secrets logged; secrets kept out of URLs except the single-use code | Request metadata stays with the provider |
| Relay memory captured by the host | In-memory lifetime limited to each call's deadline | JavaScript cannot zero memory; sealed mode is the answer if this matters |
| Untrusted strings from the data reaching the LLM (account names) | Same truncation as self-hosted (H-11) | Same as self-hosted |
| Relay compromise used to push code to the browser | The relay only sends data frames; the browser never evaluates them and validates every frame against a schema | None |

---

## 10. Owner decisions before implementation

- **D1 — Connector mode disclosure.** Accept that in connector mode the relay handles plaintext in memory per call (§5.3), with disclosure on the consent page and in the privacy policy? *Recommendation: yes. It is the only way to work with connectors added by URL, which was the goal of #266. Sealed mode follows as phase 2.*
- **D2 — Relay host.** Cloudflare Workers + Durable Objects (recommended: no server to patch, per-session isolation) or a Node process on Fly.io or a VPS. Either needs an account and a deploy step that only the owner can set up.
- **D3 — Defaults.** 60 min maximum, 10 min idle, 30 s grace, 30 calls/min, 256 KB per result. Change any before children are briefed.

---

## 11. Proposed child issues (not yet created)

Each child is imp-sized, testable on its own, uses `Refs #341`, and must not change the self-hosted `/mcp` or stdio paths. Children 2–5 are pure code with tests, with no deploy. Child 8 waits for D2.

1. **Extract a browser-safe tool core.** Move `TOOLS` and `handleTool` from `app/mcp-server.mjs` into a module with no Node imports (no `fs`, no `db.js`), used by both the stdio server and the browser. Acceptance: stdio server unchanged; the read-only test covers the new module; a test imports it in a browser-like environment.
2. **Bridge protocol module.** Frame schemas, `seq`/`id`/`deadline` checks, the `PROVE` message format, and size limits as a pure shared module with test vectors (replayed `seq`, expired deadline, duplicate `id`, oversized result, bad signature).
3. **Relay: browser sessions.** WebSocket endpoint, `HELLO`/`CHALLENGE`/`PROVE`, ping, reconnect grace, idle and hard expiry, `END`, all in memory, tested with a fake clock. Includes the no-storage import test and the no-payload-logging test.
4. **Relay: Streamable HTTP `/mcp`.** `initialize`, `tools/list` (filtered to the session scope), `tools/call` forwarded as `CALL`, deadline, in-flight cap, rate limit, error mapping (§6 table), `GET` → `405`.
5. **Relay: OAuth authorization server.** Protected-resource and AS metadata, in-memory DCR, `/authorize` → consent redirect, `/authorize/complete`, `/token` with PKCE, revocation on session end, no refresh tokens. Tests for every row of the OAuth part of §7.
6. **Browser: bridge host.** Web Locks leader, session key generation (non-extractable), WebSocket client, independent scope/TTL/idle/rate checks, `seq` checks, local activity log, "Connected agent" banner with Disconnect.
7. **Browser: consent page.** `#/mcp-connect` route, `BroadcastChannel` handshake with the bridge host, scope selection, redirect-host display, "no data in this browser" state; add the relay host to `connect-src` in `app/_headers`.
8. **Deploy wiring (after D2).** Relay deploy config, Netlify `200` rewrites for `/mcp` and the OAuth well-known paths, body logging off at the host. Owner-gated: it creates an account and a deployment.
9. **Docs.** Privacy policy section for the hosted bridge (including the D1 disclosure), README "MCP Server" hosted section, and new rows in the security-hardening MCP checklist.
10. **Sealed mode (phase 2).** The local `fire-bridge` stdio shim, pairing string, HKDF key derivation and AES-GCM framing (§5.3, §7). Separate, optional, after phase 1 ships.
