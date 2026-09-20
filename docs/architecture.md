# ThreadSignal architecture

The pnpm/Turborepo workspace preserves the Next.js App Router application, adds a separate Node worker, and builds a connected Manifest V3 side panel with explicit manual draft handoff. Shared strict TypeScript, ESLint, formatting and test configuration live at the root.

The worker uses Redis/BullMQ for heartbeat, private knowledge ingestion, fixture opportunity discovery, draft generation/verification, extension credential cleanup and bounded analytics aggregation. Jobs are retryable and duplicate-safe with bounded retained history. Readiness checks PostgreSQL, Redis and the active processing components. The extension can insert or copy reviewed text, but never submit it.

Shared packages separate configuration, redacted logging/observability, UI, database types, and the five provider boundaries. Crawler and billing have their own packages in addition to the master specification's directory sketch. Analytics contains runtime report/filter contracts; tracking contains URL, currency and conversion contracts plus the consent-controlled browser snippet. Supabase remains the sole Auth, relational-data and private-storage backend.

Private workspace packages export `dist/index.js` for runtime imports and `dist/index.d.ts` for TypeScript. Turborepo orders dependency builds; `pnpm dev` first builds the required packages and then runs their `tsc` watchers alongside the web and worker applications. Unit tests also build shared packages before execution. These emitted JavaScript entrypoints work consistently with Next.js, Vitest and the bundled worker. No Prisma is used.

Local services run only in a dedicated Colima configuration inside the repository. Supabase configuration/migrations are copied into a separate generated CLI workdir so the existing root environment file cannot be discovered. Redis configuration lives in `docker-compose.yml`; `scripts/redis.mjs` validates that file and translates its supported fields into native Docker CLI operations. The launcher verifies the Colima context, project socket, container identities and published ports before supplying connection settings. Docker Compose is not a runtime prerequisite. The historical Lima temporary-path exception remains recorded in the Phase 0 verification report; this architecture does not claim that earlier exception was cleaned up.

## Authentication and organization boundary

Phase 1 uses real local Supabase Auth for email magic links, verified sessions, refresh and logout. Auth email stays in the repository's local Supabase inbox. Application invitation email uses the console provider, which suppresses recipient and message content; the authorized inviter receives a private local sharing link. Google OAuth has a guarded entry point and remains disabled locally without separately authorized personal provider configuration.

The Next.js proxy refreshes session cookies. Server components, server actions and API handlers verify the user with Supabase Auth before accessing organization data. Session cookies are HttpOnly and SameSite=Lax; HTTPS uses Secure cookies, with an explicit verified-local HTTP exception. Mutation requests check their origin, and sign-in requests use Redis rate limits. Protected `/app` routes have no anonymous preview bypass.

The web data-access layer uses a Supabase client carrying the verified user's session. Ordinary workspace operations do not use a service-role client. The public extension/tracking bridges execute fixed private functions after assuming distinct restricted NOLOGIN PostgreSQL roles; they cannot choose SQL or read tables directly. A workspace cookie selects a preference; current membership determines access. Organization actions bind the rendered organization ID, validate it, and recheck membership, preventing a workspace switch in another tab from silently changing the mutation target.

PostgreSQL enables RLS on all eight Phase 1 tables. Direct tenant mutations are denied to application roles; narrowly scoped SQL RPCs enforce role, active membership and organization status. Private membership helpers avoid recursive RLS queries and derive the user from `auth.uid()`. Billing details remain owner-only; other members receive a limited plan summary and a settings response with no billing contact. See [database contracts and permissions](phase-1-database.md).

## Plans and phase boundaries

`packages/config/src/plans.ts` defines Trial, Solo and Growth pricing, limits and feature flags. The migration mirrors those values in `plan_catalog`, and integration tests check every value for drift. Organization creation atomically creates the owner membership and seven-day mock trial. Parent-row locks serialize membership changes and invitation seat reservations. Expiry blocks new allocations while retaining existing data and read access.

Phase 1 adds organization onboarding, role management, settings and a billing skeleton. Export/deletion requests are recorded and audited; fulfillment is not available in this release. Stripe checkout, billing portal and real subscription synchronization remain later work. Phases 2–6 add tenant-isolated brands, private knowledge sources/chunks, opportunities, draft review, manual extension receipts, tracking links/clicks and conversion analytics. Private uploads have ownership policies and original-file handling. Every phase retains its migrations, tests and acceptance record. Phase 7 billing and notifications have not started.

CI separates hosted quality/build/public-browser checks from live services and authenticated journeys on a dedicated personal self-hosted Colima runner. The workflow does not provision or connect that runner. Remote CI and external providers are not established by local test results; consult [implementation status](../IMPLEMENTATION_STATUS.md) for current verification.

## Attribution boundary

Phase 6 uses allowlisted approved-draft destinations, random click receipts, consent-bound browser proofs and hash-only brand conversion keys. Currency-aware immutable event receipts make retries idempotent. Supabase computes tenant reports and maintains invalidated aggregate caches; a bounded BullMQ job refreshes them while stale/filtered reads remain accurate through live queries. The redirect uses only throttling and narrow click SQL, without rendering a dashboard or refreshing an Auth session.

Development remains on the verified local Supabase runtime. The personal hosted project's existing Auth/Phase 2 schema is separate and does not inherit later migrations or worker access automatically. See [attribution rules and local demonstration](phase-6-development.md), [architecture decisions](../DECISIONS.md) and [current verification](phase-6-verification.md).

## Phase 8 operations and privacy

Platform administration uses the same server-verified Supabase user sessions but independent database authority. Organization ownership never grants platform access. Authenticated SQL RPCs expose bounded metadata and audit access; no service key is sent to the web browser. Safe retries preserve usage and provider idempotency. The member-facing activity feed remains tenant-scoped.

The privacy worker consumes IDs from a durable Supabase outbox through BullMQ. Confirmed exports use a repeatable-read snapshot with explicit field allowlists and private gzip artifacts. Current owner permissions, Storage RLS, expiration and revocation control downloads. Confirmed deletion revokes access first, removes object bytes through Storage, then cascades tenant records. Organization-first locks fence ingestion, notification publication and cleanup. Existing hosted gates remain unchanged.

See [Phase 8 development](phase-8-development.md), [privacy data flow](privacy-data-flow.md), [security](security.md) and [operations](operations-runbook.md).
