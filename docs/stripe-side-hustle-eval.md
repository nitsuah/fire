# Stripe for the Side-Hustle Hub: evaluation

> 🧭 [fire](../README.md) · [Integrations](./integrations.md) · [Status matrix](./integration-status-matrix.md) · [Overlap audit](./stripe-overlap-audit.md) · [Canonical transactions](./canonical-transactions.md) · **Stripe evaluation** <!-- nav -->

Closes out the evaluation in #261. Status of every child was checked against the code on `main` on 2026-11-24.

## Recommendation

**Keep Stripe as a read-only income source. Do not integrate payments.**

- Fire reports income; it does not take money. Checkout, Billing, Connect, Payment Links, refunds issued from the app and any write-scoped key add PCI and fraud scope, a second privacy-policy story and a webhook attack surface, and buy a personal-finance app nothing.
- The read-only connector that already shipped is the right size: a restricted key with balance-transaction read only, stored encrypted on the self-hosted server, imported through one idempotent sync route.
- Build only the two small gaps below (duplicate candidates and an account-scoped key). The hosted deploy gap is a security decision for the owner, not an imp task.

## What is already built

| Piece | Where | State |
| --- | --- | --- |
| Overlap audit and counting rules | `docs/stripe-overlap-audit.md` | done (#342) |
| Pure balance-transaction mapper | `app/lib/stripe-canonical.js` | done (#343, #422) |
| Credential and status API (restricted key, AES-256-GCM, `SYNC_MASTER_KEY`) | `app/server.js`, `app/lib/stripe-status.js` | done (#345) |
| Read-only client | `app/lib/stripe-connector.js` | done (#346, #451); a test fails if a write method or a non-GET request appears (`stripe-read-only-boundary.test.mjs`) |
| Idempotent sync route | `/api/sync/stripe` | done (#347, #453) |
| Webhook with signature check, replay window and event-id retention | `app/lib/stripe-webhook-*.js` | done (#348) |
| Connection card and status matrix | Side Hustle Hub, `docs/integration-status-matrix.md` | done (#349, #483, #486) |
| Live-provider acceptance with a real restricted key | owner's account | manual, not run in CI |

## Source of truth and deduplication

Each provider owns its own rows, and a row is identified only by its provider id (`stripe-<balance txn>`, `ebay-<order>`, `etsy-<receipt>`). Rows from different providers are never merged by amount and date: a coincidence of amount and date is common for small sales and merging would silently delete real income.

What does overlap in practice:

1. **A manual ledger row entered for a sale Stripe later imports.** This is the real double-count risk. eBay and Etsy pay out through their own systems, so their sales never appear in a seller's Stripe account.
2. **Stripe payouts seen as bank deposits** by Plaid or a CSV import. Those rows are in `spendingTransactions`, which is not summed as income, and the mapper already skips payouts. Any future feature that reads deposits as income must keep excluding them.
3. **The same Stripe sale fetched twice** (re-sync plus webhook). Solved by the row id and first-wins collapse.

Recommendation: surface likely duplicates as **candidates for the user to confirm**, never auto-merge. That fits the existing CoinTracker pattern for manual-wallet duplicates.

## Parts worth building

1. **Cross-provider duplicate candidates (pure helper).** A function that takes the ledger and returns pairs of a Stripe row and a manual row with the same gross within a date window. Output only; no ledger mutation. Filed as #596.
2. **Account-scoped canonical key.** The audit defines `stripe:<account id>:<balance txn id>` but the mapper has no account input, so the key is not available to later reconciliation. Add an optional `accountId` argument that records the key on the row without changing the row id. Filed as #597.
3. **Hosted (Cloudflare Pages) read-only Stripe.** Today Stripe is self-hosted only. Etsy, eBay and Plaid keep their grants in an HttpOnly, `SameSite=Strict` cookie. A Stripe key would be a long-lived secret with direct access to a business's balance history, so putting it in a cookie, even sealed, is a decision for the owner. Filed as #598, owner-gated and not briefed for an imp.

## Not worth building

- Any payments, subscriptions, invoices or Connect flow.
- A write-scoped or full secret key (`sk_…`), ever. The status route already rejects it.
- Automatic merging across providers.
- Multi-currency conversion before there is a user with a non-USD Stripe account; the mapper skips non-USD and reports it.

## Acceptance (what "done" means for #261)

- [x] Evaluation written with a recommendation (this page).
- [x] Narrow follow-ups filed for the parts worth building.
- [ ] Live-provider acceptance with a real restricted key, run by the owner. Never use production credentials in CI or in chat.
