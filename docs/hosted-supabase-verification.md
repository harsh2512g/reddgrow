# Personal hosted Supabase follow-up — 2026-09-15

This is a Phase 1 configuration follow-up. Phase 2 remains unimplemented. The owner explicitly identified the supplied project URL/publishable key as belonging to a newly created personal development project. No dashboard session, service-role key, database password, or account token was used. No hosted user was created, email sent, schema applied, or existing cloud data changed by the agent.

## Connection and database evidence

- `./scripts/local pnpm supabase:check`: initial sandbox run exited 1 with network unavailable; scoped network escalation then exited 0. Auth settings returned HTTP 200. The zero-row `plan_catalog` API query returned HTTP 404, meaning absent or not exposed; this does not establish that the entire project is empty. This command checks Auth connectivity only and explicitly leaves authenticated schema verification unresolved.
- `./scripts/local pnpm supabase:prepare`: exit 0. Generated ignored `.threadsignal/hosted/setup.sql` and `verify.sql` from the two unchanged Phase 0/1 migrations.
- The database agent ran the generated read-only verification against the existing owned local PostgreSQL: eight RLS tables, eleven restricted RPCs, pgvector, private bucket, profile trigger, and protected-column grants passed. The public-object detection query detected the initialized schema. Preflight refused the existing private schema inside a read-only transaction, then rolled back. Initial sandbox Docker socket access failed; the scoped local-service escalation passed.
- Fresh-project bootstrap success and hosted SQL execution are unverified. The public key cannot execute administrative SQL. Owner dashboard steps are in [the setup guide](hosted-supabase.md).

## Quality checks

All package commands use `./scripts/local pnpm` to clear inherited configuration and confine caches/state to the repository. No packages were added or installed for this follow-up.

| Command/check                  | Result                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`                         | Exit 0                                                                                                                                                           |
| `typecheck`                    | Exit 0; 19 Turbo tasks plus tooling TypeScript                                                                                                                   |
| `test`                         | Exit 0; 250 tests across 35 files, 9.00 seconds                                                                                                                  |
| `test:integration`             | Exit 0; 21 tests across 2 files, 5.91 seconds                                                                                                                    |
| `build`                        | Exit 0; 14 tasks, 11.082 seconds                                                                                                                                 |
| `build:hosted`                 | Exit 0; 11 shared-package builds and complete Next production build                                                                                              |
| `test:e2e`                     | Exit 0; 15 passed, 1 intentional duplicate mobile-role skip, 17.9 seconds                                                                                        |
| `services:health`              | Exit 0; exact repository Colima context/socket, Redis PONG, Supabase running                                                                                     |
| `format:check`                 | Exit 0; all matched files conform                                                                                                                                |
| `secrets:check`                | Exit 0; 265 repository text files checked                                                                                                                        |
| `git diff --check`             | Exit 0                                                                                                                                                           |
| Dedicated hosted browser smoke | Exit 0; homepage/login render, protected redirect, Google disabled, wrong-host HTTP 400, anonymous readiness HTTP 503 with database unconfigured and Redis ready |

Both web profiles and the local worker start successfully. The ordinary local web and worker readiness endpoints returned HTTP 200. The hosted process is intentionally available at `http://localhost:3002`; use that exact hostname, since `127.0.0.1:3002` is refused before hosted Auth receives cookies. Hosted smoke uses a fresh Playwright profile, GET requests only, and performs no login or email submission. Anonymous hosted readiness is intentionally not marked passed: checking the authenticated schema requires the owner's setup and sign-in.

The integration and E2E suites use only synthetic local Supabase accounts and repository-local browser profiles. They do not prove hosted signup or cross-tenant behavior against the new cloud project.

## Failures and corrections

- Initial unit run: 245 passed and one new proxy test failed. Next normalized the alternate loopback URL, so the first guard used the wrong host representation. The corrected guard checks the raw Host header before constructing any hosted Supabase client. The final complete suite above passed.
- Initial integration run: 17 passed; the four service tests could not start because the existing development worker already held port 3001. The development process was stopped, then the suite passed 21/21. This was a failed run, not a test skip accepted as verification.
- Initial sandbox network and local Docker checks failed as described above; scoped reruns passed.
- A patch invocation failed without changes and was corrected. Two exploratory file reads named nonexistent health module paths; subsequent repository searches located the actual modules.
- Node's existing local-storage warning and pnpm's native-binary fallback notice did not fail checks. No global tool change was made.

## Changed files and remaining verification

Main additions: `scripts/hosted-profile.mjs`, `scripts/hosted-supabase.mjs`, `scripts/prepare-hosted-supabase.mjs`, `apps/web/tsconfig.hosted.json`, dedicated profile/bootstrap/auth tests, and the hosted setup/verification guides.

Changes extend shared environment validation, the public client allowlist, server/proxy Auth guards, Redis rate-limit scoping, hosted readiness, profile-aware login/integration text, web build configuration, root scripts, ignores, README, implementation status, and ADR-012. Existing migrations, local seed, providers, and extension behavior are unchanged. Actual public settings and generated SQL are Git-ignored.

Pending owner steps: confirm the project is empty before applying the guarded SQL, configure the exact Auth redirect, then test magic-link delivery/sign-in and organization creation using the owner's personal email. Hosted two-user isolation and actual new-project bootstrap remain unverified. Google OAuth, real product providers, remote CI, and the historical Phase 0 isolation review remain outside this follow-up. No commit or push was created.
