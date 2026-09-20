# Phase 2 worker follow-up

The hosted Phase 2 schema migration remains applied and verified. Restricted worker provisioning is prepared but **has not run**: automatic approval review rejected creating a persistent hosted database login because the owner had previously selected local processing. An explicit approval question is pending. No hosted worker password, login, or smoke-test Auth accounts were created.

The reviewed operation creates a narrowly scoped worker role with thirteen worker-only RLS policies and no bypass-RLS, role membership, administrative role switching, Auth table access, or persistent schema creation. Its local verification role is restored to `NOLOGIN` with a null password. The launcher generates a new password, stores it in an ignored mode-0600 local profile, verifies TLS and effective privileges, and never forwards the administrator connection to the worker or web app. Hosted web knowledge access defaults off and requires matching worker readiness. Phase 3 processing remains local and grants no additional hosted permissions.

All commands below used `./scripts/local` and repository-owned Colima services.

| Command/check                  | Result                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`                    | Passed                                                                                                                                                       |
| `pnpm format:check`            | Passed                                                                                                                                                       |
| `pnpm typecheck`               | 23/23 tasks and tooling passed                                                                                                                               |
| `pnpm test`                    | 383 tests in 43 files passed                                                                                                                                 |
| `pnpm build`                   | 15/15 tasks passed; 14 cached                                                                                                                                |
| `pnpm test:integration`        | 50 tests in 5 files passed                                                                                                                                   |
| `pnpm test:e2e`                | 17 passed, one intentional duplicate mobile-role skip                                                                                                        |
| `pnpm secrets:check`           | 335 text files passed                                                                                                                                        |
| `pnpm worker:prepare:local`    | Passed; scoped role remains NOLOGIN                                                                                                                          |
| Restricted local login probe   | Correct password authenticated; wrong password rejected (28P01); administrator/authenticated/service-role switching rejected; restored NOLOGIN/null password |
| `pnpm supabase:check:phase2`   | Read-only hosted schema comparison passed; Phase 1 baseline unchanged                                                                                        |
| `pnpm worker:provision:hosted` | Automatic approval review rejected before execution; no cloud changes                                                                                        |
| Hosted knowledge smoke script  | Syntax/lint/format passed; execution requires separate approval for two temporary Auth accounts                                                              |

Failures were corrected and rerun: two worker schema tests needed optional undefined fields; permission fixtures initially used an overlong slug and lacked a rollback-only SET-role grant; a restricted-login probe resolved a protected schema name and was changed to catalog OID inspection. The first build encountered sandbox EPERM while binding a Turbopack port; its cached error persisted on retry. Removing only the generated in-repository Turbopack cache and rerunning with reviewed execution passed. An E2E attempt before that successful build failed for missing BUILD_ID; the final complete browser suite passed. An explicit Prettier invocation on `.env.example` exited 2 because that format has no parser; the complete format check and names-only secret checks passed. The previous development process was intentionally interrupted to free the worker for integration tests.

Cloud processing, hosted worker startup, private hosted Storage ingestion, and hosted end-to-end customer flows remain unverified. Existing hosted login at localhost:3002 does not imply those checks passed.
