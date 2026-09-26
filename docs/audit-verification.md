# Final specification audit verification

Baseline: `eaf24a7` on `main`. Scope: Step 12 after Phase 8, including fixes to in-scope requirements. No commit, push, deployment, external login, hosted migration or real product-provider request is part of this task. All Node/package commands use `./scripts/local`; local container/browser commands use only this repository's verified Colima/services and disposable test profiles.

The final local gates and resumed fresh-install rehearsal passed. The audit is ready for local review; external activation and the limitations below remain unverified. Supabase remains the Auth/database/private-storage backend; local defaults remain mock/fixture/console.

## Executed verification before final regression

| Command/check (after `./scripts/local`)                | Observed result                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --offline --frozen-lockfile`             | Passed; subsequent unit execution exposed missing jsdom materialization.                                                                   |
| `pnpm install --offline --frozen-lockfile --force`     | Passed; 525 cached packages, zero downloads; jsdom resolved.                                                                               |
| `pnpm install --offline --no-frozen-lockfile`          | Passed after adding the worker's direct database dependency; 410 reused, zero downloaded.                                                  |
| `pnpm test`                                            | Historical intermediate run: 1,394 passed, 97 files, 32.85 s. Final totals are recorded below.                                             |
| `pnpm lint`                                            | Passed after generated deployment-extension output was excluded.                                                                           |
| `pnpm typecheck`                                       | Passed, 33 tasks plus tooling; intermediate run 14.55 s.                                                                                   |
| `pnpm build`                                           | Passed, 18 tasks; intermediate run 22.983 s.                                                                                               |
| `pnpm test:integration`                                | First full run: 257 passed, three failed, 260 total across 16 files, 52.55 s. Corrected; final full pass is below.                         |
| Focused deployment database roles                      | 11/11 passed after fixture correction, 2.68 s.                                                                                             |
| Focused Phase 4 worker and invitation retention        | 14/14 passed, two files, 3.87 s.                                                                                                           |
| Focused web AI accounting/extraction/knowledge/signals | 60/60 passed, four files, 1.38 s.                                                                                                          |
| Focused error-envelope suites                          | 268 passed; web TypeScript and scoped ESLint passed.                                                                                       |
| `pnpm test:e2e apps/web/tests/e2e/onboarding.spec.ts`  | Failed both desktop/mobile: helper inspected the workspace selector while organization creation was pending. Corrected; final runs passed. |
| `pnpm db:migrate`, `pnpm db:types`                     | Additive local migrations through the audit revisions; exact final version/count recorded below. No original database reset.               |

## Failure and correction ledger

- An initial standalone auth test could not resolve jsdom. Frozen offline installation alone did not repair materialization; forced offline installation did. No package was obtained from a private registry.
- The first broad unit run exposed local fixture code in the deployment extension artifact. Build-time elimination and artifact checks were corrected; the focused artifact/contracts suite passed 114 tests.
- ESLint initially scanned 1,099 errors in generated `dist-deployment`; that generated directory is now excluded from lint, formatting, Git and clean-room source selection. Source checks then passed.
- The initial integration run used an invalid blocked opportunity fixture and exhausted a shared test organization's one-minute draft admission window. Tests now construct valid status and age only their own disposable jobs; production admission limits were not relaxed. Focused affected suites passed.
- A sandboxed invitation/worker test attempt could not open the project Colima socket; its setup hooks failed and 14 cases were skipped. The same repository-local tests passed with scoped socket permission.
- Automatic approval review initially rejected the invitation-retention migration because its function definition contains DELETE. Source inspection established the command only creates the bounded helper/index and does not invoke deletion. With that narrower evidence, review allowed the DDL-only migration. A read-only count found zero eligible existing invitations. No outside or customer data inspection was needed.
- An agent's scoped Vitest command used the app directory while test paths were repository-relative; it found no tests. The corrected root invocation passed.
- The first new Journey A run reached the existing onboarding URL before the create transaction finished. Its helper now waits for the newly selected workspace/UUID rather than that unchanged URL.
- A root status-read attempt used unsupported `./scripts/local node`; the launcher refused before executing. The corrected form was `./scripts/local pnpm exec node`, using isolated Git without global/system configuration.
- The next full unit run passed 1,439 and failed four of 1,443 cases. Three failures found the frozen hosted bootstrap's exclusion list missing the two latest local migrations; adding their exact filenames preserved the reviewed Phase 0/1 bootstrap, and its 10 tests passed. The fourth loaded an older malformed AI test argument during an overlapping edit; the corrected isolated AI suite passed 28/28 without a production change. The subsequent frozen-source full run passed all 1,443 cases.

## Final regression and clean-room

Original working-tree checkpoint results (superseded by the final snapshot results below):

| Command (after `./scripts/local`)              | Result                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm install --offline --frozen-lockfile`     | Exit 0; all 19 workspace projects, lockfile unchanged.                                                      |
| `pnpm lint`                                    | Exit 0, root and web ESLint.                                                                                |
| `pnpm typecheck`                               | Exit 0, 33 tasks plus tooling, 52.198 s.                                                                    |
| `pnpm test`                                    | Exit 0, **1,443/1,443**, 101 files, 40.40 s.                                                                |
| `pnpm build`                                   | Exit 0, **18/18 tasks**, 36.149 s.                                                                          |
| `pnpm extension:build`                         | Exit 0.                                                                                                     |
| `pnpm test:integration`                        | Exit 0, **266/266**, 17 files, 88.32 s.                                                                     |
| `pnpm audit --audit-level=high`                | Exit 0; public npm reported no known vulnerabilities.                                                       |
| `pnpm secrets:check`                           | Exit 0; 742 source text files at that checkpoint.                                                           |
| Live standard-error request through Next proxy | Passed: 404, safe empty details, newly generated UUID matching header/body, forged input ignored, no-store. |

The full browser run then passed **38 tests with two intentional duplicate mobile skips in 8.1 minutes**. Desktop/mobile guided onboarding and all-tab navigation passed. The MV3 suite passed **1/1 in 38.5 seconds**, including connection, editing/reapproval, insertion with zero submit attempts, copy fallback, manual publication and revocation. Two Next.js destination-stream-closed diagnostics occurred during operations navigation; those cases passed and the diagnostics remain in the log.

Formatting and database lint passed. After the final search-side embedding budget was added, its eight focused usage tests and all 33 typecheck tasks/tooling passed. The browser build above predates that budget change and the final optional operator pricing configuration; the successful final snapshot run below exercises both changes. Desktop billing and opportunity-feed screenshots were inspected under `.threadsignal/verification/` without authentication tokens.

The first clean-room attempt copied 746 source files, bootstrapped pnpm, installed dependencies with zero cache reuse, and installed Chromium successfully. Install took 441.337 s in the harness (pnpm reported 7m 13.3s); browser installation took 102.616 s. Public npm emitted slow-download warnings. A bounded diagnostic request returned HTTP 200 in 427 ms; only the exact repository install process and child PID status were inspected while waiting.

That attempt then failed at fresh Colima creation: Lima's temporary SSH socket suffix made the nested path 106 characters, exceeding its strict limit of fewer than 104. No snapshot database was created or reset. Snapshot shutdown also returned exit 1 because its Docker context had never been created. The compensating original-service restart and health check both passed; original data volumes remained intact. The failure logs are retained. The fix uses a shorter Lima directory only for the disposable snapshot, leaving the original environment's path unchanged. The subsequent rehearsal attempts and final pass are recorded below.

The first resumed attempt passed bootstrap/frozen installation/browser checks, then found a second 106-character socket in Colima's forwarding configuration. VM creation and snapshot shutdown returned exit 1; original services were again restored and passed health checks (44.708 s and 1.834 s). The follow-up correction shortens both snapshot-specific state paths and checks generated socket lengths. Original Colima/Lima paths remain unchanged. Attempt-two logs/results are preserved under `.threadsignal/cleanroom/attempt-02/`.

Attempt three successfully created the fresh Colima/Supabase/Redis stack without reported outside temporary paths. Reset/seed/database lint, lint, formatting, typecheck, **1,468 unit tests in 102 files (30.32 s)**, **18 build tasks (27.933 s)**, extension build, the 747-file secret scan, **266 integration tests in 17 files (51.12 s)**, and all three development HTTP 200 checks passed. `./scripts/local doctor` also passed in the snapshot (Node 25.2.1, Colima 0.10.3, Docker 29.8.0). The production rebuild passed. However, its full browser run finished with **37 passed, one failed and two skipped in 7.7 minutes**: mobile onboarding's helper navigated again immediately after observing a transient `/app` URL during magic-link redirection, and Chromium returned `ERR_ABORTED`. The helper was corrected to await the rendered authenticated document. Snapshot shutdown and original-service restoration passed. The extension browser stage was not reached in this attempt. Earlier passing browser results do not override this failure.

Attempt four again passed all static, unit, integration, build and development checks; both desktop/mobile onboarding cases passed. Its browser run ended with **37 passed, one failed and two skipped in 7.6 minutes**. The new content-readiness locator assumed exactly one H1, but the invitation page has a page heading and a panel heading. The roles/invitation case therefore failed at that assertion. The helper now requires the first visible page heading while retaining authenticated-menu, document-load and explicit-destination checks. No authentication behavior, permission check or failed test was disabled. The original-tree rebuild and scoped helper lint passed. A focused regression and final resumed run follow this correction; their results are recorded below.

The focused command `pnpm test:e2e apps/web/tests/e2e/onboarding.spec.ts apps/web/tests/e2e/roles.spec.ts` then passed **three cases with one intentional mobile-role duplicate skip in 1.1 minutes**: desktop onboarding 24.6 s, desktop roles/invitation 14.4 s, mobile onboarding 20.8 s. It used the refreshed original-tree production build (18/18 tasks, zero cache hits, 25.089 s). Attempt five refreshes the snapshot with this tested helper and reruns all gates.

Raw logs are ignored under `.threadsignal/audit-*.log`. The clean-room harness writes source hash manifests, numbered command logs and exact exit status/duration to `.threadsignal/cleanroom/`, with resumed attempts in numbered subdirectories. The final snapshot results below establish the reset/seed and complete automated rehearsal; earlier failed attempts remain part of the record.

## Final passing rehearsal

`./scripts/local pnpm cleanroom:verify --resume` exited **0** on attempt five. It validated/refreshed the 746-file source snapshot, reset and seeded only the disposable Supabase database, ran every gate, shut that stack down, and restored the original services with retained volumes. SHA-256 verification found no changed snapshot source, no missing source files, and identical application, migration, configuration and test source in the original tree; subsequent edits are documentation only.

The first attempt performed the cold public dependency/browser downloads. Resumed attempts retain those public caches and generated state; they rerun frozen installation and all gates rather than claiming another cold download. The final original-tree production rebuild also passed all 18 tasks with zero cache hits in 25.089 s.

| Command                                                 | Scope    | Result               | Harness duration |
| ------------------------------------------------------- | -------- | -------------------- | ---------------- |
| `./scripts/local bootstrap`                             | snapshot | Exit 0               | 0.984 s          |
| `./scripts/local pnpm install --frozen-lockfile`        | snapshot | Exit 0               | 0.261 s          |
| `./scripts/local pnpm exec playwright install chromium` | snapshot | Exit 0               | 0.554 s          |
| `./scripts/local pnpm services:stop`                    | original | Exit 0               | 5.256 s          |
| `./scripts/local pnpm services:start`                   | snapshot | Exit 0               | 41.037 s         |
| `./scripts/local pnpm services:health`                  | snapshot | Exit 0               | 1.500 s          |
| `./scripts/local pnpm db:reset`                         | snapshot | Exit 0               | 26.448 s         |
| `./scripts/local pnpm seed`                             | snapshot | Exit 0               | 1.111 s          |
| `./scripts/local pnpm db:lint`                          | snapshot | Exit 0               | 1.539 s          |
| `./scripts/local pnpm lint`                             | snapshot | Exit 0               | 10.934 s         |
| `./scripts/local pnpm format:check`                     | snapshot | Exit 0               | 6.115 s          |
| `./scripts/local pnpm typecheck`                        | snapshot | Exit 0               | 8.106 s          |
| `./scripts/local pnpm test`                             | snapshot | Exit 0               | 25.662 s         |
| `./scripts/local pnpm build`                            | snapshot | Exit 0               | 7.861 s          |
| `./scripts/local pnpm extension:build`                  | snapshot | Exit 0               | 0.790 s          |
| `./scripts/local pnpm secrets:check`                    | snapshot | Exit 0               | 0.670 s          |
| `./scripts/local pnpm test:integration`                 | snapshot | Exit 0               | 42.952 s         |
| `pnpm dev` homepage/web/worker readiness                | snapshot | HTTP 200 / 200 / 200 | —                |
| `./scripts/local pnpm build`                            | snapshot | Exit 0               | 0.781 s          |
| `./scripts/local pnpm test:e2e`                         | snapshot | Exit 0               | 447.681 s        |
| `./scripts/local pnpm test:extension`                   | snapshot | Exit 0               | 39.737 s         |
| `./scripts/local pnpm services:health`                  | snapshot | Exit 0               | 1.788 s          |
| `./scripts/local pnpm services:stop`                    | snapshot | Exit 0               | 4.959 s          |
| `./scripts/local pnpm services:start`                   | original | Exit 0               | 39.907 s         |
| `./scripts/local pnpm services:health`                  | original | Exit 0               | 1.602 s          |

Reported suite results: **1,468/1,468 unit tests**, 102 files, **24.63 s**; **266/266 integration tests**, 17 files, **42.18 s**; **38 browser tests passed, two intentional duplicate mobile cases skipped**, **7.4 min**; **1/1 MV3 test**, **38.5 s**. TypeScript passed 33 workspace tasks plus tooling; build passed 18 tasks. Both desktop and mobile onboarding passed, as did the full roles/invitation flow. The extension asserted zero automatic final submissions. The source scanner passed 747 text files; this detects its supported patterns, not every possible secret.

The final browser log contains **two** Next.js `The destination stream closed early` diagnostics during operations navigation; both affected tests passed. Framework inspection shows this error can occur when a render destination closes, and the test performs navigation/refresh, but the triggering request was not identified. This remains an unresolved rendering diagnostic, not proven harmless and not a demonstrated authorization/data-loss failure. Current desktop/mobile billing screenshots were visually inspected in the disposable environment; this is agent review, not human acceptance.

Exact logs and command statuses: `.threadsignal/cleanroom/attempt-05/`. Earlier attempts, failed commands and prior manifests remain preserved. Root source parity evidence is in `.threadsignal/audit-source-parity.json`.

After the rehearsal, `./scripts/local pnpm dev` restarted the original web and worker. The homepage (`127.0.0.1:3000`), web readiness and worker readiness (`127.0.0.1:3001`) all returned HTTP 200. Services remain running for review; only documentation changed after the tested source snapshot.

Final documentation checks also passed: repository-wide `pnpm format:check`, `pnpm secrets:check` (747 files), isolated `git diff --check`, and local-link checks across 22 changed Markdown files. Source parity confirms all application/configuration/migration/test files match the passing snapshot; the five later differences are documentation only. The final file map contains 125 changed tracked files and 69 added source files. No commit or push was created.

## External boundaries

No live Reddit, paid AI, Stripe, Resend, Google OAuth, deployed Supabase runtime, managed Redis, external monitoring, remote CI, Node 24 or Web Store test is claimed. The installed local Node is 25.2.1. The separate personal hosted Phase 2 configuration was neither read nor modified. Deployment profile tests use synthetic configuration and injected transports. Historical Phase 0 Lima temporary-path reporting remains an open isolation review item; no outside inspection or cleanup is authorized by this audit.
