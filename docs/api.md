# API reference

Route inventory for the current implementation. Supabase owns Auth, authorization, tenant records and job state. JSON mutations use runtime schemas, bounded request bodies, origin checks where cookie-authenticated, and applicable Redis/SQL limits. Responses containing customer data are private/no-store. Never send database administrator, service-role or provider keys from a browser.

JSON failures use `{ "error": { "code": "INVALID_INPUT", "message": "Check the fields and try again.", "details": {}, "requestId": "<server-generated UUID>" } }` and preserve the route's HTTP status. `X-Request-ID` matches the body; client-supplied IDs are not echoed or trusted. Messages come from safe feature mappings, never raw database/provider exceptions, submitted text or secrets. `details` remains empty when an operation has no safe structured details; quota limits or usage counters are not invented. Existing CORS and applicable `Retry-After` headers remain in place. Health/readiness status payloads, successful redirects and Auth callback redirects retain their specialized response contracts.

Phase-specific payloads: [knowledge](phase-2-development.md), [opportunities](phase-3-contracts.md), [drafts](phase-4-contracts.md), [extension](extension.md), [attribution](phase-6-development.md), [billing](phase-7-development.md).

## Brand, knowledge and monitoring reads

`GET /api/brands` lists the active workspace's authorized brands; `GET /api/brands/:id` returns one authorized brand. `GET /api/brands/:id/knowledge` lists its knowledge sources; `GET /api/knowledge/:id` returns an authorized source with its documents. `GET /api/brands/:id/subreddits` and `GET /api/brands/:id/keywords` list saved monitoring configuration. List routes accept `limit` (1–100, default 25) and an optional UUID `after` cursor, returning `next_cursor` or null. Invalid pagination returns 400; malformed knowledge database output remains a private server failure. Organization isolation is enforced before reading tenant data and by Supabase RLS.

`DELETE /api/brands/:id` is an archive alias using the same authorized SQL operation and fresh workspace binding as archive through PATCH. It preserves the brand and historical records; it is not permanent deletion. `POST /api/brands/:id/extract-product` returns evidence-backed suggestions for explicit human review, with fresh source checksums; it does not save the brand. Source-specific upload, retry, download and document inclusion routes below preserve the established ingestion API described in ADR 014.

## Phase 8 operations

`GET /api/internal/jobs` accepts bounded `limit` (1–50), optional `family`, `status`, `organizationId`, and paired `before`/`beforeId` cursor. It returns safe job metadata with a current retry-eligibility hint. `POST /api/internal/jobs/:id/retry` takes `{family, reason, requestId}`; reasons are enumerated and the UUID makes retries idempotent. The database rechecks eligibility, freshness and usage before accepting. `POST /api/internal/organizations/:id/status` takes `{paused, reason, requestId}`. No input may choose an actor or SQL role.

`GET /api/activity?organizationId=...` uses the same paired date/ID cursor and tenant membership, without platform privileges. Metadata does not contain knowledge, replies or credential values.

`POST /api/privacy/requests` takes `{kind:"export", organizationId}` or `{kind:"deletion", organizationId, confirmation}`. Cookie-authenticated writes must also bind `X-ThreadSignal-Organization` and the trusted Origin. Deletion confirmation is the exact workspace slug. `GET /api/privacy/requests?organizationId=...` returns owner-safe current statuses. `GET /api/privacy/requests/:id/download` returns an authenticated attachment, never a public object URL. `POST /api/privacy/requests/:id/revoke` takes `{organizationId}` and immediately removes download authority. Response receipts preserve SQL names: kind `export`/`delete`, status `requested`/`processing`/`completed`/`failed`/`expired`/`revoked`/`canceled`.

## Route inventory

| Methods            | Route                                      | Authority                                                            |
| ------------------ | ------------------------------------------ | -------------------------------------------------------------------- |
| `GET`              | `/api/activity`                            | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/analytics/all`                       | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/analytics/funnel`                    | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/analytics/opportunities`             | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/analytics/subreddits`                | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/analytics/summary`                   | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/analytics/timeseries`                | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/auth/google`                         | Origin/redirect validation; bounded auth rate limits                 |
| `POST`             | `/api/auth/logout`                         | Origin/redirect validation; bounded auth rate limits                 |
| `POST`             | `/api/auth/magic-link`                     | Origin/redirect validation; bounded auth rate limits                 |
| `POST`             | `/api/billing/checkout`                    | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/billing/mock/complete`               | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/billing/portal`                      | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/billing/subscription`                | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/billing/usage`                       | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/billing/webhook`                     | Raw-body signature verification; provider snapshot + idempotency     |
| `POST`             | `/api/brand-subreddits/[id]/refresh`       | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/brand-subreddits/[id]/refresh-rules` | Verified Supabase user; tenant RLS and role/plan checks              |
| `DELETE,PATCH`     | `/api/brand-subreddits/[id]`               | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/brands/[id]/keywords/preview`        | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET,POST`         | `/api/brands/[id]/keywords`                | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/brands/[id]/keywords/suggest`        | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/brands/[id]/knowledge/pages`         | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET,POST`         | `/api/brands/[id]/knowledge`               | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/brands/[id]/knowledge/upload`        | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET,PATCH`        | `/api/brands/[id]/persona`                 | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET,PATCH,DELETE` | `/api/brands/[id]`                         | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/brands/[id]/extract-product`         | Owner/admin; current included knowledge; human review before save    |
| `GET,POST`         | `/api/brands/[id]/subreddits`              | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/brands/[id]/subreddits/suggest`      | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET,POST`         | `/api/brands`                              | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/conversion-keys/[id]/revoke`         | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET,POST`         | `/api/conversion-keys`                     | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/drafts/[id]/approve`                 | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/drafts/[id]/copy`                    | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/drafts/[id]/feedback`                | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/drafts/[id]/mark-published`          | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/drafts/[id]/regenerate`              | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/drafts/[id]/reject`                  | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/drafts/[id]/restore`                 | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET,PATCH`        | `/api/drafts/[id]`                         | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/drafts/[id]/verify`                  | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/drafts`                              | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/extension/connection-code`           | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET,OPTIONS`      | `/api/extension/current`                   | Revocable scoped extension bearer; fixed origin and fresh approval   |
| `OPTIONS,POST`     | `/api/extension/disconnect`                | Revocable scoped extension bearer; fixed origin and fresh approval   |
| `OPTIONS,POST`     | `/api/extension/drafts/[id]/inserted`      | Revocable scoped extension bearer; fixed origin and fresh approval   |
| `OPTIONS,POST`     | `/api/extension/drafts/[id]/prepare`       | Revocable scoped extension bearer; fixed origin and fresh approval   |
| `OPTIONS,POST`     | `/api/extension/drafts/[id]/published`     | Revocable scoped extension bearer; fixed origin and fresh approval   |
| `OPTIONS,PATCH`    | `/api/extension/drafts/[id]`               | Revocable scoped extension bearer; fixed origin and fresh approval   |
| `OPTIONS,POST`     | `/api/extension/exchange`                  | One-use code + configured extension origin                           |
| `POST`             | `/api/extension/revoke`                    | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/extension/sessions`                  | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/health/ready`                        | Public safe readiness; no secrets                                    |
| `GET`              | `/api/health`                              | Public safe readiness; no secrets                                    |
| `POST`             | `/api/internal/jobs/[id]/retry`            | Verified Supabase user + independent platform-admin SQL authority    |
| `GET`              | `/api/internal/jobs`                       | Verified Supabase user + independent platform-admin SQL authority    |
| `GET`              | `/api/internal/organizations/[id]`         | Verified Supabase user + independent platform-admin SQL authority    |
| `POST`             | `/api/internal/organizations/[id]/status`  | Verified Supabase user + independent platform-admin SQL authority    |
| `GET`              | `/api/internal/organizations`              | Verified Supabase user + independent platform-admin SQL authority    |
| `GET`              | `/api/internal/overview`                   | Verified Supabase user + independent platform-admin SQL authority    |
| `GET`              | `/api/internal/providers`                  | Verified Supabase user + independent platform-admin SQL authority    |
| `DELETE,PATCH`     | `/api/keywords/[id]`                       | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/knowledge/[id]/download`             | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/knowledge/[id]/retry`                | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET,DELETE`       | `/api/knowledge/[id]`                      | Verified Supabase user; tenant RLS and role/plan checks              |
| `PATCH`            | `/api/knowledge/documents/[id]`            | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/knowledge/search`                    | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/notifications/deliveries`            | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET,PATCH`        | `/api/notifications/preferences`           | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/opportunities/[id]/dismiss`          | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/opportunities/[id]/drafts`           | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/opportunities/[id]/rescore`          | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/opportunities/[id]`                  | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/opportunities/[id]/save`             | Verified Supabase user; tenant RLS and role/plan checks              |
| `PATCH`            | `/api/opportunities/[id]/status`           | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/opportunities/dismiss`               | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/opportunities`                       | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET,PATCH`        | `/api/organizations/[id]`                  | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET`              | `/api/privacy/requests/[id]/download`      | Current organization owner; private Storage RLS; origin on mutations |
| `POST`             | `/api/privacy/requests/[id]/revoke`        | Current organization owner; private Storage RLS; origin on mutations |
| `GET,POST`         | `/api/privacy/requests`                    | Current organization owner; private Storage RLS; origin on mutations |
| `GET`              | `/api/subreddits/search`                   | Verified Supabase user; tenant RLS and role/plan checks              |
| `POST`             | `/api/tracking-links/[id]/revoke`          | Verified Supabase user; tenant RLS and role/plan checks              |
| `GET,POST`         | `/api/tracking-links`                      | Verified Supabase user; tenant RLS and role/plan checks              |
| `PATCH`            | `/api/tracking-settings`                   | Verified Supabase user; tenant RLS and role/plan checks              |
| `OPTIONS,POST`     | `/api/v1/browser-events`                   | Brand-scoped bearer or click proof; origin + quota + deduplication   |
| `POST`             | `/api/v1/conversions`                      | Brand-scoped bearer or click proof; origin + quota + deduplication   |

The tracked redirect is `/go/[code]`, outside `/api`: it enforces destination allowlists, minimizes click data and excludes previews/prefetches. Auth callback routes validate a single supported exchange and safe destination. Local/hosted profile gates apply in addition to the authority above; this inventory does not assert hosted activation.
