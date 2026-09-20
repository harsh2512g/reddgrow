# Phase 8 file map

This phase extends an already uncommitted workspace. Files from earlier phases remain uncommitted; this map identifies the current work rather than claiming a clean base diff.

## Supabase and worker

- `supabase/migrations/20260923000000_platform_operations.sql`
- `supabase/migrations/20260923010000_privacy_lifecycle.sql`
- `supabase/migrations/20260923020000_platform_privacy_jobs.sql`
- `supabase/migrations/20260923030000_operations_lifecycle_guards.sql`
- `supabase/migrations/20260923040000_privacy_request_limits.sql`
- `supabase/migrations/20260923050000_operations_retention.sql`
- `supabase/migrations/20260923060000_feed_cursor_index.sql`
- `supabase/migrations/20260923070000_paused_cleanup_retry.sql`
- `supabase/migrations/20260923080000_privacy_bucket_boundary.sql`
- `supabase/migrations/20260923090000_knowledge_worker_organization_guard.sql`

- `packages/database/src/database.types.ts`, `supabase/tests/foundation.sql`: generated public RPC types and RLS/private-bucket assertions.
- `apps/worker/src/jobs/privacy.ts`, `apps/worker/src/runtime.ts`: durable export/deletion processing, retention, private Storage transport and readiness.
- `apps/worker/src/jobs/{knowledge,drafts}.ts`: organization pause/deletion fencing and consistent locking.
- `supabase/operations/`, restricted-worker bootstrap/verifier and permission tests: separately reviewed helper prerequisite; no hosted operation was executed.
- Worker/privacy tests and `tests/integration/phase8-{admin,privacy}.test.ts`, `tests/integration/services.test.ts`: transport, real SQL/Storage, permissions, concurrency and readiness.

## Application and security

- `apps/web/src/lib/phase8/`, `apps/web/src/components/phase8/`, `apps/web/src/app/internal/admin/`: typed admin operations, API input/response boundaries and metadata console.
- `apps/web/src/app/api/{internal,privacy,activity}/`, organization settings and `/app/activity`: safe retries, private archives, fresh deletion confirmation and tenant history.
- `apps/web/src/proxy.ts`, auth/security helpers, root layout and `instrumentation-client.ts`: CSP nonces, request IDs, exact admin auth destination and interpreted runtime validation.
- Existing knowledge/opportunity/draft context helpers and shared mutation limiter: authenticated limits before business work.
- `packages/shared/` observability/logger/metrics and AI/Reddit/Stripe/Resend transport call sites: safe bounded operation/provider measurements and defensive telemetry sinks.
- Extension validation initialization imports: interpreted validation under MV3 CSP; permissions and manual-only action model remain unchanged.
- Public pages, focusable main landmarks and application navigation: honest current capability copy, responsive marketing sections, keyboard entry and Activity navigation.
- `apps/web/tests/phase8-{api,ui}.test.*`, security/rate-limit tests, E2E `operations.spec.ts` and `accessibility.spec.ts`: regression evidence.

## Tooling and documentation

- `.github/workflows/ci.yml`: public-npm vulnerability audit gate.
- `scripts/prepare-hosted-supabase.mjs`: explicit exclusion of all ten Phase 8 migrations from the frozen hosted bootstrap.
- `README.md`, `IMPLEMENTATION_STATUS.md`, `DECISIONS.md`, credential/risk/architecture docs.
- New/completed API, route matrix, deployment, security, privacy flow, operations, backup/restore, incident response, release, extension and responsible-use guides.
- Phase 8 development, verification, security-review and query-plan records.

No secret value, hosted configuration or production credential is added. Generated logs, screenshots, test databases/artifacts and caches remain ignored.
