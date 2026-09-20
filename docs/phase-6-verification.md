# Phase 6 verification

Scope: Supabase tracking links, privacy-minimized clicks, consent-controlled browser events, scoped server conversion keys, idempotent conversions, analytics and bounded aggregation. Local Supabase remains the backend. The personal hosted project, credentials and worker were not used or changed. Phase 7 remains unstarted.

All package commands below use `./scripts/local pnpm`. Generated files, logs and isolated browser profiles stay inside the repository. No existing browser session is used. Auth/receipt/key-bearing browser journeys disable traces, video and automatic screenshots.

## Results (2026-09-18)

| Command                                       | Result                                                                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --offline --no-frozen-lockfile` | Passed; 19 workspaces, zero downloads.                                                                                                                    |
| `pnpm install --frozen-lockfile --offline`    | Passed; lockfile current, 97 ms.                                                                                                                          |
| `pnpm db:migrate`                             | All six additive migrations verified in local Supabase; no reset.                                                                                         |
| `pnpm db:types`                               | Public Supabase types regenerated and package built.                                                                                                      |
| `pnpm db:lint`                                | Passed with Phase 6 RLS, credential-hash and raw-cache privilege assertions.                                                                              |
| `pnpm lint`                                   | Passed.                                                                                                                                                   |
| `pnpm typecheck`                              | 32/32 tasks plus tooling TypeScript passed, 5.401 seconds.                                                                                                |
| `pnpm test`                                   | 888/888 tests passed in 71 files, 59.77 seconds on the final implementation.                                                                              |
| `pnpm build`                                  | 18/18 tasks passed, 13.401 seconds on the final implementation.                                                                                           |
| `pnpm extension:build`                        | Passed.                                                                                                                                                   |
| `pnpm seed`                                   | Passed twice; existing data preserved.                                                                                                                    |
| Focused database integration                  | 29/29 passed, 5.79 seconds, including the real production SQL binding.                                                                                    |
| Focused tracking package tests                | 67/67 passed in three files, 0.997 seconds.                                                                                                               |
| Focused API/style/analytics tests             | 50/50 passed, 1.05 seconds.                                                                                                                               |
| Focused rate-limit tests                      | 19/19 passed, 1.32 seconds.                                                                                                                               |
| Focused UI tests                              | 23/23 passed across two files; the approved-draft action regression also passed within its 9-test file.                                                   |
| `pnpm format:check`                           | Passed.                                                                                                                                                   |
| `pnpm test:integration`                       | 172/172 tests passed in 11 files, 34.38 seconds.                                                                                                          |
| Focused Journey C                             | Desktop/mobile 2/2 passed; 28.4/27.5 seconds, 1.0 minute total. Later final-build mobile pass also verified readable summaries.                           |
| `pnpm test:e2e`                               | 26 passed, 2 intentional mobile duplicate skips; 5.5 minutes, exit 0.                                                                                     |
| `pnpm test:extension`                         | 1/1 real MV3 test passed; 38.7 seconds, 43.7 seconds total. No Reddit submission.                                                                         |
| `pnpm dev`                                    | Running at `http://127.0.0.1:3000`; homepage HTTP 200 with ThreadSignal content.                                                                          |
| Local web/worker readiness probes             | Both HTTP 200/ready. Web database/Redis ready; worker database, Redis, heartbeat, opportunities, drafts and analytics up. Actual aggregate job completed. |
| `pnpm services:health`, `pnpm secrets:check`  | Colima/Redis/Supabase health passed; hygiene passed across 566 text files.                                                                                |

## Failures and corrections

- The first focused database run passed 17/18. Its expired-subscription fixture set an end time before its start time, violating the existing constraint; corrected the fixture rather than weakening the constraint. Subsequent focused runs passed 22/22 and 24/24 before additional cases were added.
- The initial API suite passed 25/26. One unsafe URL was correctly rejected with HTTP 400, while the test expected 500; the assertion now checks the explicit safe failure outcome. Expanded API/style regressions passed afterward.
- The first full typecheck passed 31/32 tasks. A new Testing Library test used an unsupported `exact` option; an anchored name matcher corrected it. The next full typecheck passed.
- Cross-layer review found fixture query loss, old receipt parameters surviving preview redirects, floating-point representation disagreements with PostgreSQL and UUID-case discrepancies. All four were corrected with focused regressions before the complete unit run.
- A later database run found a cache-test assumption that one bounded batch would refresh its organization ahead of older stale workspaces. The test now waits through bounded refreshes instead of assuming scheduling priority.
- Review found contradictory external/idempotency identities could resolve to the oldest event. An additive migration now rejects identities referring to different receipts; a dedicated two-event regression covers it.
- Initial formatting check flagged two still-changing files (`IMPLEMENTATION_STATUS.md` and the Journey C test). Both were formatted before the final check.
- The first complete integration run passed 170/171 in 230.44 seconds. The idempotency fixture's host timestamp preceded its database click because local Supabase was measured 34–39 ms ahead of the host. Ordinary synthetic event timestamps now derive from their persisted click plus one millisecond. Explicit before-click/future/window-negative cases remain unchanged, and production validation was not relaxed. The focused 28-test rerun passed in 9.17 seconds.
- Final tooling verification exposed a test-helper UUID inference error; its first correction missed a declaration. The explicit declaration fixed it, and final checks passed.
- First browser invocation failed before assertions because the sandbox denied the local Next server socket (EPERM). The same isolated command was retried with explicit local-socket permission; outcome is recorded above when complete. The first approved attempt then remained silent for over three minutes and was interrupted (exit 130) before any assertions. The PTY retry revealed a stale nonresponsive listener on port 3000. Its working directory was verified as this repository’s `apps/web` before termination; the hosted process was untouched. Browser startup then proceeded.
- Both first actual desktop/mobile journeys reached the real redirect and recorded click, but failed on the consented signup. Diagnostic runs included a 240-second timeout; later bounded diagnostics confirmed an application HTTP 400 JSON response. The real PostgreSQL driver serializes strings bound to a `jsonb` parameter again, while the API had already serialized the event. The fixed statement now binds that string as text before casting to JSONB. A real-driver integration regression uses the exact production statement, covering the boundary that mocked API tests missed. Final browser outcomes follow above.
- The rebuild after that correction initially passed 17/18 tasks, with Next/Turbopack denied its internal local socket by the sandbox (`EPERM`). A permitted retry repeated that cached failure. A loopback-only bind/close probe succeeded; clearing only the generated Turbopack cache then produced a successful 18/18 build.
- The next browser run exposed a test selector mismatch on the draft dropdown before conversion. The test now selects the combobox by its accessible role/name. A subsequent run successfully recorded signup and purchase and verified revenue/funnel values, then failed a case-sensitive community assertion (`SaaS` versus canonical `saas`). That assertion now ignores display case. Neither correction weakened product behavior.
- The first full browser regression passed 25, failed 1 and intentionally skipped 2 in 3.5 minutes. It ran two workers against shared synthetic Reddit/community records, and a parallel context refresh correctly invalidated another journey's draft approval. Browser acceptance now defaults to one worker, preserving the stale-context gate rather than weakening it or blindly retrying approval. Final serial results are recorded above.
- The first serial full run passed 25, failed 1 and intentionally skipped 2 in 5.5 minutes. Both attribution journeys passed. Repeated runs had exhausted the existing navigation test's shared seeded viewer sign-in budget (five attempts per ten minutes). Navigation now uses and cleans up a disposable local identity/workspace, signs out, then verifies the requested destination on a fresh sign-in. The seeded role matrix and all production authentication limits remain unchanged; Redis is not broadly reset.
- The final development startup initially failed because the new workspace packages brought the persistent task count to 17, above the old Turborepo concurrency of 16. The root development script now uses the required minimum of 18; final startup/readiness results are recorded above.

## Acceptance evidence

Phase 6 is ready for local review. All required local acceptance checks passed; the application and worker remain running. Phase 7 is unstarted. Manual reproduction steps are in [the development guide](phase-6-development.md), and implementation paths are in [the file map](phase-6-files.md).

| Phase 6 criterion              | Evidence                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allowlisted tracked redirect   | Real browser link creation/HTTP 302; unit and SQL checks reject unsafe, unknown, revoked and mismatched destinations.                                                                    |
| Click appears in analytics     | Journey C asserts one Supabase click and matching dashboard/unique-receipt counts.                                                                                                       |
| Idempotent signup              | Real consented browser signup plus SQL/API retry and immutable-payload checks.                                                                                                           |
| USD 99 purchase and funnel     | Browser fixture, underlying Supabase rows, revenue, funnel and Overview reconcile.                                                                                                       |
| No repeated-event inflation    | Browser repeat suppressed; actual server API returns 201 then 200 with one stored lead. Contradictory identities are rejected.                                                           |
| Invalid/foreign input rejected | API and database suites cover malformed events, target/origin rules, keys, tenant IDs, roles, plan gates, precision and window boundaries. Revoked real-browser-created key returns 401. |
| Analytics reconciliation       | Database assertions cover currencies, event filters, tenant/plan access, cache invalidation and actual bounded BullMQ refresh.                                                           |
| Redirect timing                | Two focused local samples: 40.2 ms and 37.0 ms; redirect executes a restricted RPC without dashboard aggregation.                                                                        |

The focused real-browser redirects returned HTTP 302 in 40.2 ms and 37.0 ms (`Server-Timing`). These are two local samples, not a production load benchmark. Screenshots are captured with hidden server keys and scrubbed receipt URLs under `.threadsignal/verification/phase6-*.png`; desktop/mobile layouts were visually inspected.

The final full run measured HTTP 302 at 54.1 ms on desktop and 88.9 ms on mobile. Journey C passed in 29.1/31.5 seconds, and disposable navigation passed in 9.8/8.0 seconds. The full final run had no failures or server errors.

Journey C performs the actual draft handoff, link creation, redirect and compiled browser-script delivery. It verifies zero conversions before consent; a signup; one USD 99 purchase despite repeat delivery; reconciled database, funnel, revenue and Overview totals; readable conversation summaries; server lead HTTP 201 followed by duplicate HTTP 200; and revoked-key HTTP 401. It cleans up its disposable organization and Auth identity.

The two intentional mobile skips cover the viewport-independent API pagination case and the seeded-role matrix already exercised by the desktop case (which also opens a mobile navigation context). They do not skip the mobile attribution journey.

## External boundaries

Hosted Phase 6 migration/runtime, installation on a live customer domain, production scale, live provider integrations, remote CI and browser consent-manager compatibility have not been live-tested. Local browser testing cannot establish these. Historical isolation and hosted-worker review items remain recorded in earlier phase documentation.
