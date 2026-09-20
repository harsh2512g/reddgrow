# Phase 5 verification

Scope: local MV3 extension, scoped connection/revocation, approved-draft handoff and self-reported publication. Phase 6 remains unstarted. All package commands use `./scripts/local pnpm`; inherited credentials are cleared and caches/profiles stay in this repository. The personal hosted project and its credentials were not used.

## Final local results (2026-09-18)

| Command                                       | Result                                                                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --offline --no-frozen-lockfile` | Passed for 19 workspaces, zero downloads.                                                                                                      |
| `pnpm install --frozen-lockfile --offline`    | Passed; lockfile current.                                                                                                                      |
| `pnpm db:migrate`                             | Three local Phase 5 migrations applied without resetting data.                                                                                 |
| `pnpm db:types`                               | Generated public types refreshed.                                                                                                              |
| `pnpm db:lint`                                | Passed, including Phase 5 RLS/hash privilege assertions.                                                                                       |
| `pnpm lint`                                   | Passed.                                                                                                                                        |
| `pnpm format:check`                           | Passed; final documentation formatting also checked.                                                                                           |
| `pnpm typecheck`                              | 30/30 tasks passed and tooling TypeScript passed.                                                                                              |
| `pnpm test`                                   | 731/731 passed in 64 files, 19.79 seconds, including browser fetch, Next host handling, recoverable error codes, rate limits and fixture URLs. |
| `pnpm test:integration`                       | 143/143 passed in 10 files, 26.86 seconds.                                                                                                     |
| `pnpm build`                                  | 18/18 tasks passed, 1.105 seconds (17 cached); final build includes browser fixes, local history links and recovery messages.                  |
| `pnpm extension:build`                        | Passed; stable local identity and MV3 artifacts generated.                                                                                     |
| `pnpm test:extension`                         | 1/1 actual MV3 journey passed, 47.4 seconds on final build/schema (earlier pass: 54.4 seconds); zero submit attempts.                          |
| `pnpm test:e2e`                               | 24 passed, two intentional duplicate mobile skips (roles and pagination), 2.9 minutes.                                                         |
| `pnpm services:health`                        | Exact project Colima context/socket verified; Redis PONG; Supabase running.                                                                    |
| `pnpm secrets:check`                          | 502 repository text files passed; ignored dotenv/dependencies remain excluded from Git.                                                        |

The integration suite includes 21 Phase 5 database checks: one-time codes, expiry, single-use races, token origin/tenant/role/plan binding, safe session metadata, hash/table privilege denial, role revocation, stale approval, exact version edits, insertion/publication idempotency, purge, cleanup and bounded inactive history with active-session visibility. Other suites preserve prior phase regression coverage.

## Failures and corrections

- Initial offline install refused the changed workspace lockfile. Repeating with `--no-frozen-lockfile --offline` updated only existing workspace links and the lockfile; frozen install then passed.
- The first Phase 5 database run had 2 passes and 18 failures because the local Supabase administrator could not assume the newly created restricted role. An additive migration grants only SET authority without inheritance. The next run had 19 passes and one test-only quoted-identifier failure. Corrected test: 20/20 passed, then the full 142-test integration suite passed.
- Early extension typechecks caught DOMRect fixture typing, an iterator and Chrome optional-tab typing. The first eight panel tests resolved a repository fixture through the wrong jsdom URL; their path handling was corrected. All 52 extension unit tests passed afterward.
- The first focused web UI run had 10 failures and 8 passes: an icon unavailable in the installed library and a Phase 4 assertion that predated the new disabled manual-record control. A supported icon and an assertion that still prohibits actual submission fixed both. Final focused UI run: 19/19 passed, including the local fixture history link.
- Worker typecheck caught an incompatible union of BullMQ event overloads. Separate queue/worker registrations fixed it; the complete typecheck passed.
- The first production build failed because the sandbox denied the compiler's local worker socket. An escalated retry replayed that persisted Turbopack failure. Removing only the generated `apps/web/.next/cache/turbopack` cache and retrying with permitted local sockets passed. No source workaround or framework change was needed.
- Two later full-unit runs experienced long stalls: 649 passes/1 timeout/4 pool-start errors over 1026.53 seconds, then 652 passes/1 timeout/3 pool-start errors over 4233.16 seconds. The captured second timeout was the unchanged Phase 2 empty-search UI test; the pool could not start three unrelated files. These are not accepted as passing. Timeouts and assertions remained unchanged. Machine suspension is suspected from elapsed times, but not proven. A subsequent unrestricted-concurrency run completed in 17.71 seconds with 683 passes and seven failures across five UI suites, including timeout fallout into following tests. Capping concurrent Vitest workers at two removed that contention; the full suite then passed 690/690 in 42.76 seconds.

- The first extension test command timed out in automatic approval review before any process launched; the tool-authorized retry ran. The first actual MV3 run failed during a competing onboarding navigation (12.6 seconds). Waiting for the already-started redirect fixed the harness. The next run reached human approval but exposed a real mock URL/provider-ID mismatch (38.6 seconds). Shared local-only normalization now reconciles `fixture001` with stored `fixture_001`, and UI/shared regressions cover it. No real-provider identifier is changed.
- Subsequent MV3 attempts failed waiting for the code input (51.3 seconds; cause unproven and not reproduced after two HTTP 200 code responses), waiting five seconds for a connection whose request timeout was twelve seconds (31 seconds), then reporting a transport failure (46.4 seconds). Native worker `fetch` was called with the API class as its receiver; invoking the stored function without that receiver fixes the browser API contract, with a regression test.
- A direct worker fetch probe then reached the API but returned 403 (2.9 seconds). Next canonicalizes loopback URLs to `localhost`, so checking only the URL against `127.0.0.1` rejected the legitimate request. The policy now requires the incoming Host to be exactly `127.0.0.1:3000` and accepts only its expected original/normalized URL origins. Six new tests exercise the real NextRequest normalization and reject alternate hosts. No API origin, permission or credential boundary was broadened.

- A final schema-lint invocation without socket permission failed at `docker info` before SQL execution. It was retried with explicit access to the repository-owned Colima socket; the result is recorded in the command table.

- Final review found that extension recovery-message aliases differed from actual server error codes. Added fixed messages for all 28 recoverable codes, rejected inherited object keys from the error whitelist, and added 32 regression cases. Focused extension API tests passed 41/41.

## Acceptance and remaining boundaries

- [x] Secure hashed expiring codes and revocable sessions, with membership and organization enforcement.
- [x] Side panel, URL lookup, current approved draft, evidence and rules.
- [x] Local editing returns through verification and human approval.
- [x] Explicit text insertion, copy fallback and no submission code path; behavioral unit tests pass.
- [x] Explicit matching-comment publication records and session revocation UI.
- [x] Minimal permissions, trusted storage, bounded API requests, atomic rate limits and expiry cleanup.
- [x] Real MV3 fixture journey proves insertion and zero submit attempts.
- [x] All final required checks pass together; Phase 5 is ready for local review.
- [x] Installation, permission/data-use and manual compatibility documentation exists.

Live Reddit editor compatibility, native Chrome side-panel UI, hosted processing, remote GitHub CI and Chrome Web Store release have not been live-tested or deployed. Public fixtures cannot prove real Reddit DOM compatibility. Publication records are human declarations, not verified Reddit events. The historical Phase 0 isolation exception and hosted-worker approval remain as documented in earlier phase records. No new outside-repository operation, commit or push is requested.

## Browser evidence

The actual MV3 test uses an isolated repository-owned Chromium profile. It verifies connection, current opportunity/evidence, editing and reapproval, textarea/contenteditable insertion, unchanged nonempty editors, unknown/ambiguous editor fallback, clipboard handoff, explicit manual publication, web revocation and extension disconnect. The submit-attempt sentinel remains zero throughout. Final safe screenshots were visually inspected: `.threadsignal/verification/phase5-extension-approved.png`, `phase5-fixture-inserted.png`, and `phase5-connected-settings.png`. They contain only synthetic local data; connection codes are hidden before capture.

## Development left running

`./scripts/local pnpm dev` started successfully. Read-only HTTP probes returned 200 for `http://127.0.0.1:3000/`, web readiness and worker readiness. Web checks report database/Redis ready; worker checks report database, Redis, heartbeat, opportunities and drafts up. An anonymous request to Integrations returns 307 with `/login?next=%2Fapp%2Fsettings%2Fintegrations`, preserving the destination. Local app and worker remain running on ports 3000/3001 with mock/console/fixture providers. Colima health confirms the exact project socket, Redis PONG and Supabase running. No hosted credential or service was used or changed.
