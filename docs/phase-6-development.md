# Phase 6: attribution and analytics

Supabase remains the only Auth, PostgreSQL and private-storage backend. This phase runs against the existing verified **local Supabase** project at `127.0.0.1:54321`; the application is `http://127.0.0.1:3000`. It does not migrate or enable the separate personal hosted project. No second database platform or in-memory substitute was introduced. Hosted activation still needs a reviewed schema/runtime/worker configuration; it is not established by local acceptance.

All commands use `./scripts/local pnpm …`. The launcher clears inherited credentials and uses repository-owned caches, the public npm registry, Colima and mock/console/fixture providers. Do not copy an administrator database credential into the browser or snippet.

## Using the screens

- **Overview** summarizes workspace activity and attributed outcomes for the last 30 UTC calendar days.
- **Analytics** adds date, brand, community, opportunity, event and intent filters, charts, tables and drilldowns. Competitor and draft-style breakdowns require Growth. The maximum date range is 90 inclusive UTC days. Revenue stays separate by currency.
- **Tracking** creates a short link for a current, verified and human-approved draft. Use an HTTPS URL on the brand website or an explicitly approved link domain. Existing destination UTM values are preserved unless overwrite is selected. Members can create/revoke links; viewers can read them.
- **Settings → Integrations** manages the organization attribution window, consent copy, public browser installation snippet and brand-scoped server keys. Only owners/admins change settings or keys. Browser conversions require Solo/Growth; server conversions require Growth. Rotation revokes the old key immediately; copy the replacement once into your own server secret storage.

These are additions to the existing brand, knowledge, communities, opportunities, draft-review and extension workflows. The extension still never submits Reddit comments. Billing and notifications remain Phase 7 work.

## Reproduce the synthetic journey

1. Start existing services with `./scripts/local pnpm services:start`, apply outstanding migrations with `./scripts/local pnpm db:migrate`, then run `./scripts/local pnpm dev`.
2. Sign into the seeded synthetic workspace using the local Auth email preview. Its existing demo entitlement permits conversions. `pnpm seed` is idempotent and preserves edits; it initializes settings but never invents clicks or revenue.
3. Use the ClarityScale AI fixture brand. Process its knowledge, monitor a fixture community, generate a reply, review its evidence/disclosure and approve the current version.
4. Use **Create tracked link** on the approved draft to open Tracking with that exact draft selected, then create a link to `https://clarityscale.example/pricing`. Open it. Only this reserved fixture domain is mapped to the local ClarityScale demo; customer destinations retain their approved HTTPS origin.
5. The redirect records one click. The demo page sends no conversion until its consent checkbox is selected and a person presses **Record demo signup** or **Record demo purchase**.
6. Record a signup and USD 99 purchase, then repeat the same purchase. Analytics should show one signup, one purchase and USD 99 attributed revenue. These are explicitly synthetic events; no payment or Reddit submission occurs.
7. Withdraw consent to clear the first-party attribution cookie and stop further browser events.

Automated Journey C creates its own disposable synthetic workspace and removes it afterward. Safe screenshots hide receipt parameters and never capture server keys.

## Browser installation

Copy the brand-specific snippet from Integrations. Initialize with `consent: false`; connect `window.threadSignal.setConsent(true)` to your consent manager. It reads only explicit attribution query parameters, scrubs them from the visible URL, and initially keeps them in memory. It reads/writes a host-only first-party cookie only after consent. It respects Do Not Track and Global Privacy Control and never automatically emits events.

After an actual customer action, call `window.threadSignal.track('signup', { externalId: 'opaque_signup_id' })` or `track('purchase', { externalId: 'opaque_order_id', value: 99, currency: 'USD' })`. Supported event types are `signup`, `lead`, `trial_started`, `purchase`, `custom`; custom requires `metadata.customName`. Only `metadata.plan` and `metadata.customName` are accepted. Do not send email, names, full URLs or arbitrary customer attributes.

Keep an opaque external ID stable across retries. If a request fails, `window.threadSignal.retry(result.idempotencyKey)` preserves the original timestamp and payload. A successful repeated call on the same page is suppressed locally; PostgreSQL independently deduplicates actual repeated delivery. The in-memory queue is bounded to 100 and requests time out after eight seconds. There is no automatic retry loop or persistent event queue. Reinitialization/revocation clears pending events; use your server integration for durable delivery.

The first-party cookie has an absolute lifetime (30 days by default, configurable 1–90). A new tracked visit replaces the receipt after consent. Existing cookie lifetime is not extended on later visits. The server always applies the organization's current attribution window, so changing it does not silently rewrite stored events. Withdrawing consent aborts requests where possible and removes future local tracking; it cannot undo a request the server has already committed.

## Server conversion API

Send JSON to `POST /api/v1/conversions` with `Authorization: Bearer <brand_conversion_api_key>`. Keys are never used in browser JavaScript. Cookie/Origin-bearing requests are refused on this endpoint.

```json
{
  "clickId": "00000000-0000-4000-8000-000000000001",
  "event": "purchase",
  "externalId": "opaque_order_123",
  "value": 99,
  "currency": "USD",
  "occurredAt": "2026-09-18T12:00:00Z",
  "metadata": { "plan": "pro" }
}
```

Use the actual recorded click UUID and event timestamp. Supply an external ID or UUID idempotency key (body `idempotencyKey` or `Idempotency-Key` header). Repeated identical delivery returns the original receipt with HTTP 200; a new event returns 201. Reusing an identity for changed event details is rejected. The event must occur after its click and within the configured window. Server delivery may arrive later; browser receipt delivery expires at the window boundary with five minutes of clock tolerance. Accepted values are nonnegative, at most 1,000,000,000, and use the currency's supported 0/2/3 minor-unit precision. The supported currency list is centralized in `packages/tracking/src/currency.ts`; no currency conversion is performed.

## Measurement and privacy rules

- Each qualifying GET produces a new click receipt. Refreshes and repeated human visits count as new clicks; there is deliberately no person-level deduplication without an identity signal. “Unique attributed clicks” means distinct receipts, not distinct people.
- HEAD, known bot/link-preview user agents and prefetch/prerender requests redirect without recording clicks or adding attribution identifiers. This heuristic is not proof that all other traffic is human.
- The server stores no raw IP, user agent, referrer, country or browser fingerprint. The optional anonymous visitor hash is unused. Rate limits use operation scopes and hashed opaque credentials, never IP-derived identity.
- A browser conversion requires a valid opaque click proof, brand binding, explicit consent flag and the exact approved destination origin. Only SHA-256 proof/key hashes are stored. CORS never grants credentials.
- Browser consent is supplied by the customer integration; it cannot prove the visitor understood the notice. Server events are supplied by the brand's trusted server. Attribution is a relationship to a click, not proof of causation or payment settlement.
- Period funnel stages count activity within the chosen period and need not form one cohort or decrease monotonically. Conversion rates use distinct attributed click receipts; zero denominators display a dash.
- Revenue includes purchase events only and remains separate by currency. Other event values do not inflate revenue. Draft style is captured on link creation; manual publication remains self-reported.
- Supabase RLS and scoped RPCs enforce tenant access. The application bridge assumes a NOLOGIN role with only three fixed private RPCs; it has no general table access. Credential hashes and raw aggregate cache are not client-selectable.
- The `aggregate-analytics` BullMQ job refreshes at most five stale organization caches per minute, with retries and safe count-only logs. Writes invalidate relevant caches; filtered/stale reads compute live results, so a delayed worker does not return stale totals. The common fresh unfiltered range may use cache.

## Verification commands

```bash
./scripts/local pnpm install --frozen-lockfile --offline
./scripts/local pnpm lint
./scripts/local pnpm format:check
./scripts/local pnpm typecheck
./scripts/local pnpm test
./scripts/local pnpm db:lint
./scripts/local pnpm test:integration
./scripts/local pnpm build
./scripts/local pnpm test:e2e
./scripts/local pnpm services:health
./scripts/local pnpm secrets:check
```

Stop the development processes before integration/E2E because those suites own ports 3000/3001. See [verification](phase-6-verification.md) for actual outcomes and [file map](phase-6-files.md) for implementation paths.
