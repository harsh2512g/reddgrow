# Phase 7 file map

This list identifies this phase's work in the existing uncommitted workspace. It does not imply that earlier phase files were committed.

## Supabase

- `supabase/migrations/20260922000000_billing_notifications.sql`: billing requests/events, subscription lifecycle, usage summaries, preferences/outbox, scheduler and RLS.
- `supabase/migrations/20260922010000_billing_permissions.sql`: trusted mock mutation bridge and provider selection.
- `supabase/migrations/20260922020000_billing_usage_meter.sql`: meter alignment and recipient/context fingerprint plus 23-hour retry boundary.
- `supabase/migrations/20260922030000_billing_checkout_binding.sql`: exact Checkout session binding, including late verified payments.
- `supabase/migrations/20260922040000_notification_lifecycle_freshness.sql`: suppress obsolete trial, payment and quota messages.
- `supabase/migrations/20260922050000_notification_digest_schedule.sql`: respect changed digest times and reject stale queued digest dates.
- `supabase/seed.sql`, `supabase/tests/foundation.sql`, `packages/database/src/database.types.ts`: synthetic preferences, schema assertions and regenerated public types.

## Providers and application

- `packages/billing/src/{index,contracts,mock,stripe}.ts`, package manifest and tests: typed mock/Stripe Checkout, Portal, subscription and webhook adapters.
- `packages/email/src/{index,contracts,resend,notifications}.ts` and tests: console/Resend delivery, ten templates, preference/timezone helpers.
- `apps/web/src/lib/phase7/{api,database,errors,server,webhook}.ts`: authenticated server operations, safe failures, Supabase bridge and verified raw webhook handling.
- `apps/web/src/app/api/billing/{checkout,portal,subscription,usage,webhook}/route.ts`, `billing/mock/complete/route.ts`: billing endpoints.
- `apps/web/src/app/api/notifications/{preferences,deliveries}/route.ts`: personal preferences and safe delivery history.
- `apps/web/src/components/phase7/`: billing dashboard, notification settings, confirmation dialog and runtime DTO schemas.
- `apps/web/src/app/app/settings/{billing,notifications}/page.tsx`, `apps/web/src/components/app-shell.tsx`: connected screens and navigation.
- `apps/web/src/components/phase4/{primitives,studio}.tsx`: quota upgrade links.
- `apps/web/src/app/app/actions.ts`: explicit email-provider configuration for the existing invitation workflow.
- `apps/worker/src/jobs/notifications.ts`, `apps/worker/src/runtime.ts`: durable delivery dispatch, bounded jobs and readiness.

## Verification and development

- `apps/web/tests/phase7-{api,webhook,ui}.test.*`, `apps/web/tests/e2e/{billing,roles}.spec.ts`: authorization, payload, signature, UI and Journey D regression tests, including member-safe billing reads and owner-only writes.
- `tests/integration/phase7-{billing,worker}.test.ts`, `tests/integration/services.test.ts`: real Supabase transaction and BullMQ tests.
- `package.json`, `apps/web/package.json`, `apps/worker/package.json`, `packages/billing/package.json`, `pnpm-lock.yaml`: workspace links and sufficient development-task concurrency; no new external package.
- `scripts/prepare-hosted-supabase.mjs`: explicitly exclude all Phase 7 migrations from the frozen hosted bootstrap.
- `README.md`, `DECISIONS.md`, `IMPLEMENTATION_STATUS.md`, and these Phase 7 guides: architecture, operation and verification evidence.

Existing `.env.example` names already cover Stripe and Resend; no secret value or new credential file was added. All generated logs and browser screenshots remain in ignored `.threadsignal/` paths.
