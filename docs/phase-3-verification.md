# Phase 3 verification

Date: 2026-09-15. Scope: local subreddit monitoring, read-only ingestion, scoring, and opportunity review. Phase 4 has not started. The existing personal hosted login remains separate; Phase 3 has not been migrated or enabled there.

Phase 3 is ready for local review. Web and worker are intentionally left running at http://127.0.0.1:3000 and port 3001. The existing hosted login view remains at http://localhost:3002.

## Commands and results

Commands run from the repository through `./scripts/local`, which clears inherited environment values and uses repository-owned tool configuration. Local database and browser commands use the verified Colima services. No root dotenv credential is loaded for Phase 3.

| Command                             | Final result                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --no-frozen-lockfile` | Passed after adding workspace dependencies; public npm only.                                                             |
| `pnpm install --frozen-lockfile`    | Passed; 17 workspace projects, lockfile current.                                                                         |
| `pnpm db:migrate`                   | Passed; applied the Phase 3 migration locally without resetting existing data.                                           |
| `pnpm seed`                         | Passed; named synthetic monitoring initialized once without undoing subsequent user edits.                               |
| `pnpm db:types`                     | Passed after the final schema changes.                                                                                   |
| `pnpm lint`                         | Passed.                                                                                                                  |
| `pnpm typecheck`                    | Passed; 26 Turborepo tasks plus tooling TypeScript.                                                                      |
| `pnpm test`                         | Passed; 478 tests in 48 files; 10.99 seconds.                                                                            |
| `pnpm build`                        | Passed; 16/16 tasks, including web, worker, and extension shell; 15.628 seconds.                                         |
| `pnpm test:integration`             | Passed; 83/83 tests in seven files, 11.65 seconds.                                                                       |
| Focused Phase 3 Playwright run      | Passed; desktop and mobile journeys, 2/2 tests in 28.3 seconds.                                                          |
| `pnpm test:e2e`                     | Passed; 20 tests, two intentional duplicate mobile skips, 1.5 minutes.                                                   |
| `pnpm db:lint`                      | Passed against the final reconciled schema and current-phase assertions.                                                 |
| `pnpm services:health`              | Passed; exact project-local Colima context/socket, Redis PONG, Supabase running.                                         |
| `pnpm format:check`                 | Passed; all matched files use Prettier formatting.                                                                       |
| `pnpm secrets:check`                | Passed across 397 text files; no tracked env/dependencies, supported secret patterns or operational employer references. |
| `git diff --check`                  | Passed.                                                                                                                  |

Focused verification also passed: 17 Phase 3 database tests, 16 Phase 3 worker tests, 66 provider/AI/scoring tests, and 51 selected web/API/UI tests before the final fix, followed by 35/35 Phase 3 API/UI tests including the new JSONB regression. These overlap the full-suite totals and are not additional tests.

`pnpm dev` started successfully; all shared watchers reported zero errors. `pnpm exec node .threadsignal/verification/phase3-runtime.mjs` passed: local homepage, web readiness, worker readiness, hosted homepage and hosted login all returned HTTP 200. Worker readiness included `opportunities: up`. The hosted Phase 3 API correctly returned HTTP 503 `LOCAL_ONLY` before user/database access. `git check-ignore` confirmed root/app node_modules, root dotenv, and the personal public profile are ignored.

The extension source was unchanged; its shell build is included in the successful root build. No extension product functionality or Reddit submission capability was added.

## Acceptance evidence

| Requirement                                           | Evidence                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mock posts become opportunities automatically         | Worker integration starts the actual pipeline, imports normalized fixtures, and asserts all four labels. Browser journeys create a brand, ingest knowledge, and monitor SaaS through the UI.                                                              |
| High, medium, low, blocked examples display correctly | Desktop/mobile Phase 3 journey verifies score badges, detail, and the blocked filter; blocked save is refused server-side.                                                                                                                                |
| Scoring is understandable                             | Six weighted components, penalties, reasons, product capabilities/gaps, competitor context and verified citations; 45 scoring unit tests.                                                                                                                 |
| Ingestion and rescoring are idempotent                | Unique post/opportunity identities, durable outbox deduplication, leases, stale-input fences and transactional allocation; replay/rescore tests preserve usage and review state.                                                                          |
| Communities and keywords are manageable               | Search/suggestions, monitor/pause/remove, rules/notes, explicit refresh, typed keywords/exclusions, preview and competitor alias/notes preservation; UI/API/SQL tests.                                                                                    |
| Plans and tenant boundaries hold                      | 17 Phase 3 SQL tests cover roles, RLS, foreign identities, atomic quotas and period rollover; API tests bind verified organization identity.                                                                                                              |
| Deletions and failures are safe                       | Worker tests cover provider identities, persisted retry deadlines, authorization pause, three-attempt bounds, stale leases, content expiry, deletion tombstones and non-resurrection.                                                                     |
| Real Reddit remains disabled                          | Explicit approved adapter construction, fixed read-only transport, conditional credential checks, injected HTTP tests; isolated runtime stays mock.                                                                                                       |
| Feed supports review and navigation                   | Cards/table, title search, date/community/brand/intent/status/risk/score/competitor filters, three sorts, cursor pagination, save/monitor/dismiss/bulk dismiss/archive/rescore. Real PostgREST 24+6 pagination and combined-filter browser checks passed. |
| Phase boundary and hygiene                            | SQL assertions require Phase 3 tables and reject Phase 4–6 business tables. No drafting, approvals, posting, attribution, cloud migration, commit, or push.                                                                                               |

Screenshots under ignored `.threadsignal/verification/phase3-*.png` were visually reviewed on desktop and mobile. They show actual synthetic local records, not fabricated customer activity. The viewport assertions check horizontal overflow.

## Failures encountered and resolved

- Frozen installation initially failed because new workspace dependencies were not yet in the lockfile. The public-registry installation updated it; the final frozen install passed.
- The sandbox initially denied access to the repository-owned Colima API for the read-only Phase 2 catalog capture. The scoped reviewed retry succeeded.
- Initial worker TypeScript errors in enum inference and queue event typing were fixed.
- Initial database tests exposed ambiguous PL/pgSQL identifiers in monitoring and subscription checks. The new Phase 3 SQL was corrected and reconciled locally. Test fixtures were corrected for PostgreSQL timestamp precision and composite foreign-key ordering. All 17 database tests pass.
- Initial provider/scorer checks found a preview-input type mismatch; it was corrected. Feedback tests were corrected to use the assessed alternative intent rather than recommendation. All 66 related tests pass.
- The initial worker label test lacked a visible SaaS hard-block fixture because an existing no-vendor example was excluded by the demo vocabulary. Added a distinct unsupported guaranteed-recovery request; the worker suite now has 16 passing tests.
- UI tests exposed selector/header assumptions and a partial-validation default that could reset community preferences on pause. The default behavior was fixed, with a regression test proving a pause-only patch contains only the status field.
- The first two browser journeys selected a hidden filter option instead of the visible High badge. The assertion now scopes to opportunity cards; both journeys passed on rerun.
- SQL lint initially enforced the previous phase's absence of Phase 3 tables. Assertions now require the eight Phase 3 tables while continuing to reject later-phase tables.
- Formatting initially reported three files; those were formatted before the final check.
- A final sandboxed rebuild failed when Turbopack's CSS processor could not bind its local port (`Operation not permitted`). The first approved retry retained the cached failure. Removed only apps/web/.next/cache through the repository path guard; the next approved isolated build passed 16/16 tasks.
- Two complete integration attempts ended with 82 passing tests and one older profile-equality failure. Keywords created in the same transaction have UUID-dependent row order; the contract does not specify vocabulary order. The assertion now compares sorted copies of both complete arrays, preserving values and duplicate counts, and still compares every other profile field. The final full run passed 83/83.
- The first complete browser suite finished with 17 passed, three failed, and two intentional duplicate skips. All three failures exposed the competitor filter sending PostgreSQL array syntax for a JSONB column, returning HTTP 500. The query now serializes its containment value as JSON. A regression using the installed Supabase client and intercepted HTTP transport failed before the fix and passed afterward; the final complete browser rerun passed 20 tests with two intentional duplicate skips.
- Node 25/Vitest emitted the existing `--localstorage-file` warning. It did not fail the checks; Node 24 remains externally unverified.

The migration was first applied locally, then same-phase corrections were reconciled through bounded SQL deltas without resets. Ignored reconciliation receipts are in `.threadsignal/verification/`. Original Phase 0–2 migrations were preserved. The pinned Phase 2 catalog reference allows its hosted checks to remain independent of newer local schema.

## Manual review and remaining boundaries

Follow [the local guide](phase-3-development.md) to sign into the separate synthetic local workspace, monitor SaaS, inspect all four labels, review score/citation details, change review status, and test keywords. See [the file inventory](phase-3-files.md), [provider behavior](phase-3-provider.md), and [database contracts](phase-3-contracts.md).

Not live-tested: real Reddit/commercial approval, real AI, Google OAuth, external email/billing/crawling, remote GitHub Actions, Node 24, or hosted Phase 3. The existing hosted Phase 2 schema has prior migration evidence; that does not establish a working hosted background pipeline. No existing customer accounts or rows were copied into local fixtures.

The historical Phase 0 Lima external temporary-path exception remains recorded in [its verification report](phase-0-verification.md); no outside-repository inspection or cleanup was performed during this work.

Automatic approval review rejected `pnpm worker:provision:hosted` before execution because creating a persistent cloud worker login conflicted with the earlier local-processing choice. Explicit approval for that operation remains pending. No hosted credential was created and the rejection was not bypassed. The prepared hosted smoke test also remains unrun because it requires separate approval for temporary Auth identities.

## Follow-up: hosted buttons and local sign-in

The owner reported that the hosted notices' local-workspace buttons opened login. Anonymous HTTP requests confirmed a 307 redirect for Brands, Knowledge, Opportunities, Communities and Keywords, with each original path preserved in `next`. This is the expected authentication boundary between hosted Supabase at localhost:3002 and local Supabase at 127.0.0.1:3000, not evidence that the hosted session failed.

The buttons now name the local destination, preserve the corresponding tab, and explain the separate account/data. Shared instructions identify the seeded demo account and local Mailpit inbox. The local login page repeats those instructions; its success state clarifies that no real email delivery occurs. Hosted detail IDs are never passed to the local database. The guide documents every tab and current availability. Auth, cookie handling, provider modes, and hosted access gates are unchanged.

Commands executed through `./scripts/local`:

| Command                                                                                                                     | Result                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Anonymous local HTTP probe                                                                                                  | All five protected feature paths: 307 to `/login`, original `next` retained. |
| `pnpm lint`                                                                                                                 | Exit 0.                                                                      |
| `pnpm typecheck`                                                                                                            | Exit 0; 26/26 tasks plus tooling, 20.524 seconds.                            |
| `pnpm test`                                                                                                                 | Exit 0; 483/483 tests in 48 files, 14.88 seconds.                            |
| `pnpm build`                                                                                                                | Exit 0; 16/16 tasks, 15.495 seconds.                                         |
| `pnpm test:e2e apps/web/tests/e2e/local-workspace.spec.ts apps/web/tests/e2e/auth.spec.ts apps/web/tests/e2e/shell.spec.ts` | Exit 0; 16/16 desktop/mobile tests, 22.1 seconds.                            |
| `pnpm dev`                                                                                                                  | Restored after browser tests for local review.                               |

The new browser journey uses a fresh browser context and the seeded local viewer. It checks login explanations and destination preservation, completes the local email exchange, opens all ten tabs with HTTP 200 and no repeat login, verifies viewport fit, then signs out that session only. No existing browser profile or hosted sign-in was used. The wider database integration and opportunity-processing suites were not repeated for these presentation/navigation changes; their earlier results remain recorded above. No test or build failed in this follow-up. Existing Node localStorage and pnpm native-binary-fallback warnings remain nonfatal.

Final follow-up checks: `pnpm format:check`, `pnpm secrets:check` (399 text files), and `git diff --check` passed. The runtime helper verified local home/web/worker readiness and hosted home/login HTTP 200; the hosted Phase 3 API remains 503 LOCAL_ONLY. Local development was left running. The updated mobile login screenshot was reviewed for readable instructions and viewport fit.
