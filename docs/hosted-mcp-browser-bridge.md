# Hosted MCP Browser Bridge — Design

> 🧭 [fire](../README.md) · [Features](./FEATURES.md) · [Roadmap](./ROADMAP.md) · [Tasks](./TASKS.md) · [Changelog](./CHANGELOG.md) · [Metrics](./METRICS.md) <!-- nav -->
>
> **Status:** Proposed; owner decisions D1–D3 recorded 2026-11-19 (§10). This is a design for review, not an implementation brief (#341).
> **Last updated:** 2026-11-19
> **Parent:** #266 (remote MCP). The self-hosted half is #492.
> **See also:** [security-hardening.md](security-hardening.md), [privacy-policy.md](privacy-policy.md), [prod-plan.md](prod-plan.md#mcp-security-model)

---

## 1. Goal and constraints

A remote agent (for example a Claude connector added by URL) should be able to use fire's read-only MCP tools against the **hosted** deploy (fire.nitsuah.io). On the hosted deploy the financial state lives only in the user's browser (`fire_tracker_state` in `localStorage`). The server has no copy and must not get one. The browser tab is the data source, and the server only relays messages in flight.

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

**Relay host (decided, D2 in §10):** **Cloudflare Workers + one Durable Object per bridge session**, using in-memory fields only. It must not call the Durable Object Storage API (alarms included, since they are stored).

Durable Object lifecycle rules, because in-memory state is lost when an object hibernates or is evicted:

- The session object accepts the browser socket with the **standard WebSocket API** (`ws.accept()`), never the hibernation API. An object holding a standard WebSocket is not hibernated, so the session key, token hash, nonce and `seq` state stay in memory while the browser is connected. The cost is that the object bills for the whole time the socket is open (D2).
- During the 30 s reconnect grace no socket is open. Cloudflare evicts an idle object only after roughly 70–140 s without requests, so state normally survives the grace. If it does not (eviction, deploy, crash), the reconnect fails closed: the `sid` is unknown, `PROVE` cannot succeed, the browser ends the session (§6), and the client's next call gets `401 invalid_token`.
- **Nothing that exists before a session is kept in a Durable Object.** Client registrations and pending authorizations are not stored anywhere: they are self-contained, integrity-protected values (§5.2) signed with a relay HMAC key held as a Worker secret. That key is relay configuration, not user data; rotating it invalidates every registration and pending authorization, which clients recover from by registering again. Authorization codes and access tokens are minted by the session object and carry the session id as a routing prefix (`<sid>.<random>`), so the Worker routes `/token` and `/mcp` to the right object without a shared table.

A single Node process (on Fly.io or a small VPS) is the fallback if Cloudflare does not work out. The protocol core (§4, §7) is a host-agnostic module, so either host, or later the self-hosted Express server, can run it.

Relay rules that make C1 testable:

- No storage API, file, database or cache writes. A unit test fails if the relay module imports one.
- No request or response bodies, tokens or frame payloads in logs. Logs carry only counters and coarse events (`session_opened`, `call_timeout`), with no session id, client IP or tool arguments. A test greps the relay source for logging calls that take payload variables, and a runtime test checks captured logs after a full call.
- Hosting-provider request logs see only paths. No secret goes in a URL except the standard single-use, 60-second OAuth `code` on the client's redirect.

---

## 4. Bridge protocol (hop 2)

All frames are JSON over the WebSocket. Every frame has `v` (protocol version, `1`), `type`, and `sid` (session id).

| Frame | Direction | Fields | Purpose |
|---|---|---|---|
| `HELLO` | browser → relay | `pub` (session public key, JWK); on open only: `pendingAuth`, `scope` (the approved tool groups), `expiresAt` | Open or resume a session |
| `CHALLENGE` | relay → browser | `nonce` (128-bit random), `exp` | Proof of possession |
| `PROVE` | browser → relay | `sig` over `"fire-bridge/v1" ‖ relayOrigin ‖ sid ‖ nonce ‖ scope ‖ expiresAt` | Answers the challenge and binds the approved scope and expiry to the key |
| `READY` | relay → browser | `expiresAt`, `idleTimeout`, `scope` (echo) | Session live. Informational only: the browser checks the echo against its own values and ends the session on any mismatch (§6) |
| `CALL` | relay → browser | `seq`, `id` (128-bit random), `deadline`, `tool`, `args` | One tool call |
| `RESULT` | browser → relay | `id`, `ok`, `content` or `error` | Answer to exactly one `CALL` |
| `END` | either | `reason` | Session over (user disconnect, expiry, revoke) |

Limits (decided defaults, D3 in §10): 15 s per call deadline, 4 calls in flight per session, 256 KB per `RESULT` (see paging below; child 1 measures real result sizes first), 30 calls per minute per session. The relay sends WebSocket ping frames every 20 s. The browser answers pings at the protocol level, so background-tab timer throttling does not drop the connection.

**Paging within the 256 KB cap.** The browser, not the relay, keeps results under the cap, because only the browser can measure them. `get_transactions` already takes `from`/`to` date filters and a `limit` (default 200, maximum 1000) and returns rows newest first with a `matched` count. Child 1 adds one optional argument, `offset` (rows to skip in that order). Without `offset` the stdio output is unchanged. In the bridge, if the serialized result would exceed the cap, the browser drops rows from the end of the page until it fits and sets `truncated: true`. `truncated` means only that: rows were removed to fit the cap. Separately, `nextOffset` (= `offset` + rows returned) is present whenever `matched` is greater than `offset` + rows returned, whether the page ended at `limit` or at the cap. The agent asks for the next page with `offset = nextOffset` (or narrows the dates).

Each call reads the current state (§6), so rows can be added or deleted between pages. Paging therefore fails rather than silently repeating or skipping rows: every paged response carries `pagingKey`, a hash of the matched row ids in order (stable ids, not positions). A call with `offset` > 0 must pass the `pagingKey` it was given. If the current matches hash differently, the call fails with `stale_offset` and a message telling the agent to restart the query from `offset` 0. `nextOffset` is only valid with the `pagingKey` returned alongside it. Nothing is held between calls.

The `byCategory` totals cover every matching row, so dropping rows cannot shrink them. If not even one row fits next to the full `byCategory`, the browser keeps the 50 categories with the largest absolute totals, moves the rest out of `byCategory` into a separate field, `otherCategories: { count, total }` (so a real category named `other` stays distinct), sets `byCategoryTruncated: true`, and fits the rows again. `total` and `matched` stay exact. A successful page always makes progress: when `matched` > `offset`, it returns at least one row. If rows remain but not even one fits after bounding `byCategory`, the call fails with `result_too_large` and a message telling the agent to narrow the query by date or category, rather than returning an empty page with `nextOffset` equal to `offset`. Every other tool returns aggregates. If child 1 finds one that can exceed the cap, it gets the same `offset`/`nextOffset` rule; `result_too_large` remains only as a last-resort error for a single row too large to send.

---

## 5. Keys and authentication

### 5.1 Browser session key (C4)

- When the user approves a connection, the bridge host tab generates an **ECDSA P-256 key pair** with WebCrypto, `extractable: false`. The private key never leaves the browser, is never put in `localStorage` or `fire_tracker_state`, and so never lands in JSON or Drive backups. It lives only in the bridge host tab's memory, is never written to IndexedDB, and is gone when the tab closes or reloads.
- The relay stores only the **public** key, in memory, mapped to the session id. Every WebSocket (re)connect proves possession through `CHALLENGE`/`PROVE`, so stealing a session id alone does not let anyone attach a fake browser.
- One key per session. Ending the session deletes the key, so there is no long-term browser identity to steal.
- **A reload ends the session.** The browser-owned policy (approved scope, `expiresAt`, the idle deadline, the disconnect timestamp) lives in the same tab memory as the key, so nothing has to be restored and nothing can be taken from the relay instead. After a reload the tab has no key and no policy, sends `END` if it can, and shows the session as ended; a new connection needs consent again. This is the same rule as closing the host tab (§6).

### 5.2 OAuth binding (hop 1)

The relay is both the MCP resource server and the OAuth authorization server. It follows the MCP authorization spec: protected-resource metadata, authorization-server metadata, dynamic client registration (the returned `client_id` is itself the signed registration, so the relay keeps no registration table; it expires after 24 h, and a client that gets `invalid_client` registers again), PKCE `S256` required, and the `resource` parameter checked against the MCP URL.

1. The MCP client calls `POST /mcp` without a token and gets `401` with `WWW-Authenticate: Bearer resource_metadata=…`.
2. The client discovers the endpoints, registers, and sends the user to `GET /authorize?client_id…&code_challenge…&state…&scope…`.
3. The relay validates the request, packs it into a **pending authorization**: a self-contained value (client id, redirect URI, PKCE challenge, `state`, requested scope, 5 min expiry) signed with the relay's HMAC key, so no relay instance has to hold it while the user reads the consent page. It redirects to the app's consent page with that value in the URL fragment, which browsers never send to a server: `https://fire.nitsuah.io/#/mcp-connect?req=<value>`. The user lands in **their own browser, where the data lives**. If that profile has no fire data, the page says so and stops.
4. The consent page shows the client name (labelled as self-asserted), the **redirect URI host** (the trustworthy part), the requested tool groups (the user can untick any; **transactions start unticked** and must be opted into, per D1), and the session length (30 min by default). It is `frame-ancestors 'none'`, as the whole app already is.
5. On **Approve**, the user's selection becomes the **approved scope**: the ticked tool groups, which must be a subset of the requested scope, plus the chosen session length. The consent tab passes the pending authorization, the approved scope and the length over a same-origin `BroadcastChannel` to the bridge host tab. If no fire tab is open, the consent tab becomes the bridge host itself and tells the user to keep it open. The bridge host computes `expiresAt` itself, keeps the approved scope and `expiresAt` in its own memory (its copy is the one it enforces), generates the session key, connects, and sends `HELLO` with `pendingAuth`, `scope` and `expiresAt`. `PROVE` signs both values.
   The relay verifies the pending authorization's signature and expiry, rejects a `scope` that is not a subset of the requested one or an `expiresAt` beyond the allowed maximum, and stores the approved scope on the session. From then on the relay uses only the approved scope: the token response's `scope` and the `tools/list` filter come from it. The requested scope is never a fallback on either side.
6. The relay mints a single-use **authorization code** (60 s TTL) bound to the pending authorization **and** the now-live session id, then the consent tab navigates to the relay's `/authorize/complete`, which `302`s to the registered `redirect_uri` with `code` and `state`.
7. The client exchanges the code (with the PKCE verifier) at `/token` for an **opaque access token** (256-bit random; the relay keeps only its SHA-256 in memory) whose lifetime is the session's remaining lifetime. **No refresh tokens are issued.** When the session ends, the token is dead, and the client must run the flow again, which again needs the browser.

Binding summary: access token → session id → browser public key → a live, proven WebSocket. Any of the three ending ends the others.

### 5.3 What "end-to-end" can and cannot mean (decided, D1 in §10)

A standard MCP client terminates TLS at the relay and expects plaintext JSON-RPC back. **So with stock MCP clients the relay necessarily handles tool calls and results in plaintext, in memory, for the duration of each call.** No browser-held key can change that, because the client holds no matching key. The design states this rather than adding a cosmetic encryption layer that the relay itself would decrypt.

Two modes:

- **Connector mode (default, phase 1).** Works with any MCP client by URL. The relay sees plaintext in memory per call and stores nothing. The threat model (§9) states what that exposes, and the consent page and privacy policy disclose it.
- **Sealed mode (optional, phase 2).** For true end-to-end, the user runs a small local stdio shim (`fire-bridge`) as their MCP server. The shim and the browser derive a key that the relay never sees: the browser shows a **pairing string** (its ephemeral ECDH P-256 public key plus a 128-bit random secret), the user pastes it into the shim, the shim sends its own ephemeral public key through the relay, and both sides compute `HKDF-SHA256(ECDH(shared) ‖ secret, info="fire-bridge/v1/sealed" ‖ sid)` into two directional AES-256-GCM keys. Because the secret travels out of band, a relay that swaps public keys cannot derive the keys. In this mode `CALL`/`RESULT` carry only ciphertext, and the relay sees metadata alone.

---

## 6. Session lifetime (C2)

| Item | Default | Enforced by |
|---|---|---|
| Pending authorization | 5 min (signed expiry) | relay |
| Authorization code | 60 s, single use | relay |
| Session hard maximum (and access-token lifetime) | 30 min from approval by default; the user may pick 15, 30 or 60 | relay **and** browser |
| Idle timeout (no tool calls) | 10 min | relay **and** browser |
| Reconnect grace after the WebSocket drops | 30 s, then the session ends | relay **and** browser |
| Client registration | 24 h (signed expiry, nothing stored) | relay |

- The browser keeps its own copy of `expiresAt`, the idle timer and the approved scope, all set at consent (§5.2), and refuses `CALL`s outside them even if the relay sends them. It never takes these values from the relay: if `READY` disagrees with them, the browser ends the session.
- The browser also enforces the reconnect grace. When the socket drops it records the time; if it has not completed a new `PROVE` within 30 s, it ends the session locally (deletes the key and policy, refuses any later `CALL`) and does not try to resume.
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
| OAuth | Stolen access token reused later | Token lives at most as long as the session (30 min by default, 60 at most) and dies on disconnect, idle or browser loss; stored only hashed; TLS only |
| WebSocket auth | Replayed `PROVE` | Fresh 128-bit `nonce` per connect, 10 s expiry, signature covers relay origin and session id; a nonce is accepted once |
| `CALL` frames | Relay (or anything between) replays or reorders a call | Strictly increasing `seq` per session; the browser rejects `seq ≤ last`, an unknown `sid`, or a passed `deadline`; each `id` is answered at most once |
| `RESULT` frames | Late or duplicate answers | The relay accepts one `RESULT` per outstanding `id`, and drops any that arrive after the deadline or for an unknown `id` |
| Sealed mode | Ciphertext replay | AES-GCM with a 96-bit nonce built from a per-direction counter; AAD = `sid ‖ direction ‖ seq`; a counter that does not increase is rejected |

Even a successful replay could only re-run a read-only tool within the granted scope, and the browser still counts it against its rate limit and shows it in the activity log.

---

## 8. Data handling

- The browser runs the same `handleTool` against its in-memory state and applies the same output minimization as self-hosted MCP (identifier truncation, H-11 in [security-hardening.md](security-hardening.md)).
- The browser keeps a **local activity log** (timestamp, tool, bytes, outcome; no arguments or results) in `localStorage`, outside `fire_tracker_state`, capped at 200 entries. It is the hosted counterpart of `data/mcp-audit.log`.
- The relay holds, in memory only: token and code hashes, session ids, session public keys, and, for at most the call deadline, the in-flight `CALL`/`RESULT`. Nothing else.

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
- In connector mode, **return fabricated or altered tool results to the MCP client**, during a session or after the tab is gone, for as long as the client keeps trusting and contacting the relay. Token expiry does not bound this, because a compromised relay decides whether a token is valid. The browser key authenticates the browser to the relay; nothing signs results for the client, and stock MCP clients could not check such a signature anyway. The agent could therefore be shown false balances or transactions.
- **Issue its own read-only tool calls** during an active session, within the scope the user granted, until the session's expiry. The browser accepts any `CALL` with a valid `seq`, so it cannot tell these from the agent's calls.
- Deny service: drop or delay calls, end sessions.
- See metadata: client names, redirect hosts, timing, sizes, tool names, client IPs.
- Run a fake consent flow for a client it controls, but only if the user approves it on the consent page.

**Cannot:**

- Read anything when no session is active, or read data at rest. There is none on the relay.
- Read the whole state at once. It is limited to what the granted tools return, in the browser's 256 KB result cap and 30 calls per minute.
- Write or change user data. There are no write tools, and the browser enforces that, not the relay.
- Widen scope, extend a session past the browser's own `expiresAt`, or skip the idle timeout. The browser enforces all three independently.
- Attach a fake browser to a session, since it lacks the private key. (This does not stop it answering the client itself, as listed above.)
- Change what the user's own browser shows: fabricated results reach only the agent.
- In sealed mode, read calls or results at all. It sees metadata only.

**Mitigations for what it can do:** the two forms of result tampering differ in what the user can see.

- *Invented calls:* a result for a call the browser never received has no matching entry in the local activity log. A mismatch between the log and what the agent reports is a possible signal, not a guarantee: the user has to look, and the agent may not say which calls it made.
- *Altered results:* if the relay forwards a real call and changes the answer on the way back, the log shows a matching call. The log records no result content, so it cannot reveal the change. Nothing in connector mode detects this.

Sealed mode removes both, because the relay cannot produce or alter valid ciphertext. Also: short sessions, scope selection on the consent page, the browser-side rate limit, the visible "Connected agent" banner with a live call counter and Disconnect, the local activity log (calls the agent did not make show up there), and sealed mode for users who need content confidentiality from the relay.

### Other threats

| Threat | Control | Residual |
|---|---|---|
| Network attacker | TLS on both hops; HSTS on the app | None beyond TLS |
| Malicious or prompt-injected agent | Read-only tools; scope selection; rate limit; session lifetime | It can read what the user granted, which is the purpose of the feature |
| Consent phishing (attacker registers a client and sends the user an authorize link) | The consent page shows the redirect host prominently and labels the client name as unverified; explicit click needed; pending request expires in 5 min | A user who approves an attacker's client leaks the granted scope for the session length (30 min by default, 60 at most) |
| Clickjacking the consent page | `frame-ancestors 'none'` (already set) | None |
| XSS in the fire app | Existing CSP; the bridge adds only the relay host to `connect-src` | XSS already has the whole state, so the bridge does not widen it, but it must not add a new script source |
| Stolen session id | `PROVE` with the non-extractable key on every connect | None |
| Stolen access token | Hashed at rest in memory, short life, ends with the session | Usable until the session ends |
| Hosting provider logs | No bodies or secrets logged; secrets kept out of URLs except the single-use code | Request metadata stays with the provider |
| Relay memory captured by the host | In-memory lifetime limited to each call's deadline | JavaScript cannot zero memory; sealed mode is the answer if this matters |
| Untrusted strings from the data reaching the LLM (account names) | Same truncation as self-hosted (H-11) | Same as self-hosted |
| Relay compromise used to push code to the browser | The relay only sends data frames; the browser never evaluates them and validates every frame against a schema | None |

---

## 10. Owner decisions

Decided by the owner on 2026-11-19. Children are briefed against these.

- **D1 — Connector mode: accepted, with disclosure.** In connector mode the relay handles plaintext in memory for each call (§5.3). This is the only way to work with connectors added by URL, which was the goal of #266. It is the same trust the hosted deploy already places in Netlify Functions, which pass Plaid, Etsy and CoinTracker responses through in plaintext. The consent page and the privacy policy say so plainly. **Transactions start unticked** on the consent page, because they are the most detailed data and most agent questions (net worth, runway, FIRE date) do not need them. Sealed mode (§5.3) stays in the design but is built only when someone needs it.
  *Residual risk found in review, accepted by the owner on 2026-11-19:* in connector mode a compromised relay can also feed the agent fabricated or altered tool results for as long as the client keeps using it, and altered answers to real calls are undetectable (§9). The design accepts this under D1 for the same reason, because no stock MCP client can verify results; sealed mode is the path if result integrity matters.
- **D2 — Relay host: Cloudflare Workers + Durable Objects.** There is no server to patch, each session is isolated in its own object, and WebSockets and in-memory state are native. A Node process on Fly.io would hold every session in one process on a machine that needs patching. Costs: a new Cloudflare account that only the owner can create, and Durable Objects bill for the time a WebSocket stays open, so child 8 confirms current pricing before deploying. Fly.io stays the fallback.
- **D3 — Defaults.** Session length **30 min by default**, with 15 or 60 selectable on the consent page (a shorter session limits what a stolen token or a compromised relay can do). 10 min idle, 30 s reconnect grace, 30 calls per minute, 256 KB per result. The 256 KB cap is not yet checked against real data: child 1 measures each tool's output on the demo seed and a large ledger, and any tool that can exceed it (likely `get_transactions`) gets paging in child 4.

---

## 11. Proposed child issues (not yet created)

Each child is imp-sized, testable on its own, uses `Refs #341`, and must not change the self-hosted `/mcp` or stdio paths. Children 2–5 are pure code with tests, with no deploy. Child 8 needs the owner's Cloudflare account (D2).

1. **Extract a browser-safe tool core.** Measure each tool's output size on the demo seed and a large ledger (D3), add the optional `offset` and `pagingKey` arguments to `get_transactions` with the `stale_offset` rule (§4; stdio output unchanged without them), then move `TOOLS` and `handleTool` from `app/mcp-server.mjs` into a module with no Node imports (no `fs`, no `db.js`), used by both the stdio server and the browser. Acceptance: stdio server unchanged; the read-only test covers the new module; a test imports it in a browser-like environment.
2. **Bridge protocol module.** Frame schemas, `seq`/`id`/`deadline` checks, the `PROVE` message format, and size limits as a pure shared module with test vectors (replayed `seq`, expired deadline, duplicate `id`, oversized result, bad signature).
3. **Relay: browser sessions.** Standard (non-hibernating) WebSocket endpoint, `HELLO`/`CHALLENGE`/`PROVE`, ping, reconnect grace, idle and hard expiry, `END`, all in memory, tested with a fake clock. Includes the approved-scope and `expiresAt` checks on `HELLO`, the fail-closed path for an unknown `sid`, the no-storage import test and the no-payload-logging test.
4. **Relay: Streamable HTTP `/mcp`.** `initialize`, `tools/list` (filtered to the session scope), `tools/call` forwarded as `CALL`, deadline, in-flight cap, rate limit, error mapping (§6 table), `GET` → `405`.
5. **Relay: OAuth authorization server.** Protected-resource and AS metadata, the relay HMAC key, signed `client_id` registrations, signed pending authorizations, `/authorize` → consent redirect, `/authorize/complete`, `/token` with PKCE, revocation on session end, no refresh tokens. Tests for every row of the OAuth part of §7.
6. **Browser: bridge host.** Web Locks leader, session key generation (non-extractable, memory only), WebSocket client, independent scope/TTL/idle/grace/rate checks, `READY` mismatch → end, reload → end, result trimming with `nextOffset`, `seq` checks, local activity log, "Connected agent" banner with Disconnect.
7. **Browser: consent page.** `#/mcp-connect` route, `BroadcastChannel` handshake passing the approved scope and length to the bridge host, scope selection (transactions unticked), redirect-host display, "no data in this browser" state; add the relay host to `connect-src` in `app/_headers`.
8. **Deploy wiring (Cloudflare, D2).** Confirm current Durable Objects pricing for open WebSockets before deploying. Wrangler config for the relay, Netlify `200` rewrites for `/mcp` and the OAuth well-known paths, body logging off at the host. Owner-gated: it creates an account and a deployment.
9. **Docs.** Privacy policy section for the hosted bridge (including the D1 disclosure), README "MCP Server" hosted section, and new rows in the security-hardening MCP checklist.
10. **Sealed mode (phase 2).** The local `fire-bridge` stdio shim, pairing string, HKDF key derivation and AES-GCM framing (§5.3, §7). Separate, optional, after phase 1 ships.

### Tool core loading (#508)

`app/mcp-tools.mjs` is the shared tool core. It has no Node built-ins and reads no `process.env`, but the `app/lib` helpers it imports (`finance-calcs.js`, `aggregates.js`, `cointracker-merge.js` and others) are CommonJS. The browser host must bundle them or provide ESM builds; a native browser cannot evaluate them as-is. Paging (`get_transactions` `offset`/`pagingKey`) requires an injected SHA-256 hasher: Node `crypto` in the stdio server, Web Crypto in the browser. `get_side_gig_income` caps its `entries` list (default 200, max 1000) so a `RESULT` stays within the 256 KB frame limit; its totals always cover the whole ledger.
