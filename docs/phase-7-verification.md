# Phase 7 verification

Date: 2026-09-19. Work is limited to the ThreadSignal repository and its verified local Supabase/Redis services under Colima. Supabase remains the authentication, database and storage backend. No commit, push, deployment, hosted migration, external payment or external email was performed. The historical Phase 0 isolation record remains unchanged.

## Implementation

Owner-confirmed mock billing, real Stripe adapter contracts, plan/usage meters, private billing-event processing, notification preferences, ten email categories and durable delivery jobs are implemented. Six additive migrations preserve existing customer data. See the [file map](phase-7-files.md), [development guide](phase-7-development.md) and ADR-028–030 in `DECISIONS.md`.

## Command results

Commands use `./scripts/local` from the repository root. Commands requiring local sockets were approved for the exact repository-owned services. All logs use ignored `.threadsignal/phase7-*.log` paths.

| Command                                       | Result                                                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --offline --no-frozen-lockfile` | Passed; existing package cache only, workspace links updated, no external package added.                                                             |
| `pnpm install --offline --frozen-lockfile`    | Final check passed; all 19 workspace projects, lockfile current, 40 ms.                                                                              |
| `pnpm db:migrate`                             | Six additive local migrations applied successfully; no reset.                                                                                        |
| `pnpm db:types`                               | Passed; generated public types refreshed.                                                                                                            |
| `pnpm db:lint`                                | Migration foundation assertions and database lint passed.                                                                                            |
| `pnpm seed`                                   | Passed twice; idempotent preferences foundation, no fabricated payments.                                                                             |
| `pnpm lint`                                   | Passed.                                                                                                                                              |
| `pnpm typecheck`                              | **33/33 tasks plus tooling TypeScript passed**, 4.125 seconds.                                                                                       |
| `pnpm format:check`                           | Passed, including final documentation.                                                                                                               |
| `pnpm test`                                   | **1,026 passed**, 76 files, 21.32 seconds.                                                                                                           |
| `pnpm test:integration`                       | **199 passed**, 13 files, 55.68 seconds.                                                                                                             |
| `pnpm build`                                  | **18/18 tasks passed**, 7.991 seconds.                                                                                                               |
| `pnpm extension:build`                        | Passed; extension behavior unchanged and manual-only.                                                                                                |
| `pnpm test:e2e`                               | **28 passed, 2 intentional duplicate mobile skips**, 5.8 minutes.                                                                                    |
| `pnpm secrets:check`                          | Passed: 607 repository text files; no tracked env/dependencies, supported secret patterns or operational employer references.                        |
| `pnpm services:health`                        | Exact project-local Colima context/socket verified; Redis PONG and Supabase running.                                                                 |
| `pnpm dev`                                    | Web and worker started; all package watchers reported zero errors. Left running for review.                                                          |
| Local HTTP smoke                              | Homepage, web readiness and worker readiness returned **200**; database, Redis, heartbeat, opportunities, drafts, analytics and notifications ready. |

Focused checks additionally passed: billing/email provider fixtures, 24 webhook-boundary tests, UI/role/confirmation regressions, real SQL notification retry tests and real BullMQ quiet-hour rescheduling. Full suites above include those cases. The 22 Phase 7 billing database cases cover cross-tenant access, mock privilege denial, usage preservation, duplicate and stale events, late verified checkout, terminal replacement, grace, preferences, source freshness, score, digest schedule and retry fences. Five worker cases exercise actual PostgreSQL leases with injected provider failures and a real local Redis queue.

## Acceptance evidence

- [x] Mock subscription lifecycle persists in Supabase, preserving consumed units and customer data.
- [x] Owner checks and restricted bridge prevent clients from granting entitlements directly.
- [x] Existing server-side capacity gates remain authoritative; prior integration suites pass.
- [x] Verified raw webhook signatures, exact Checkout-session binding, duplicate events and current subscription snapshots are tested.
- [x] Grace, expiry, cancellation, renewal and downgrade behavior have database coverage.
- [x] User/org preferences, organization timezone, minimum score, quiet hours and digest eligibility are enforced before dispatch.
- [x] Delivery retries use leases, stable identity, changed-context suppression and a 23-hour bound.
- [x] Console delivery records suppression without recipients, bodies or upstream errors in logs.
- [x] Journey D passed on desktop (28.1 seconds) and mobile (29.8 seconds); all four billing/preferences screenshots inspected, no clipping or horizontal overflow.
- [x] Final lint, typecheck, formatting, hygiene, database and running-app smoke checks complete.
- [x] Real-provider adapters require secrets only when explicitly selected; local commands require none.
- [x] Supabase remains the backend; Phase 8 is not implemented.

## Failures and corrections

No failed check is treated as a pass:

1. The initial offline install stopped with `ERR_PNPM_OUTDATED_LOCKFILE` after adding workspace links. A repository-local offline lockfile update passed. A later migration invocation stopped at the same dependency preflight when the billing package added its config link; no SQL ran in that attempt. Reinstall and migration succeeded.
2. Provider typecheck initially inferred a widened `provider: string`; explicit interface return types fixed it. Focused provider lint then found unused mock arguments; those were fixed.
3. The first database run, before the permissions migration, had 8 passes and 6 failures because the intended trusted mock RPC grants were not applied yet. The additive permission migration fixed the boundary. Subsequent full integration runs passed.
4. The first worker typecheck rejected calling a union of BullMQ Queue/Worker listener overloads. Separate listener registration fixed it. A later tooling check found an over-narrow UUID-inferred default in a test helper used for digest dates; its string parameter is now explicit.
5. Initial webhook tests had 22 passes and 2 failures: TextDecoder removed a BOM before signature checking, and malformed UTF-8 returned 500. Exact-byte decoding now preserves the BOM and returns a controlled 400 for invalid UTF-8; all 24 pass.
6. Review found expired paid Checkout notifications could lose initial binding, stale lifecycle/digest messages could ignore changed conditions, and quiet-hour deferral could reuse a retained completed BullMQ ID. Additive SQL corrections and due-time queue IDs now cover these cases with real integration tests.
7. Email template review fixed inviter-versus-invitee wording, count labels, empty-digest claims and fractional scores; all template tests passed afterward.
8. The first browser run found the existing auth journey's plan-heading expectation no longer matched the new billing screen. The heading now explicitly names the plan. Its old role test also expected all nonowner billing reads to return 403; Phase 7 deliberately permits a safe plan summary. The test now checks a 200 response with null sensitive fields and explicitly confirms nonowner checkout remains 403. The first full run had 25 passes, 3 failures and 2 intentional skips. The final full rerun passed all 28 tests with the same 2 intentional skips. Both logs are preserved separately.

## Manual review and external limits

Use **Settings → Plan & usage** to confirm a mock upgrade/cancel/resume, then **Settings → Notifications** to save preferences. Reload each screen and compare usage with the workspace. No card is collected and no email is sent in this runtime. The full steps are in the [development guide](phase-7-development.md).

Live Stripe, Billing Portal configuration, Resend sender delivery, external webhook transport, hosted Phase 7 RLS/migrations and remote GitHub Actions remain unverified. Existing credentials and the personal hosted project were not accessed. Current local runtime guards deliberately block real-provider activation; it requires a separate reviewed profile and live test, rather than an environment-variable flip. Earlier live Reddit/OAuth and historical isolation boundaries remain unchanged. An old retired Stripe subscription event can safely fail identity checks and be retried by the provider; it cannot change the active subscription.

Phase 7 is implemented and ready for local review. Live provider and hosted activation acceptance remain unverified; Phase 8 has not started. No permission is needed to review local changes; external activation remains a separate owner decision.
