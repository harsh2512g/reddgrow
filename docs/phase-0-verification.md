# Phase 0 verification record

Date: 2026-09-13. Scope: repository foundation only. No commit or push was created. The pre-existing `AGENTS.md` edit was preserved. Root `.env.local` was not read or loaded.

## Command convention

Every package command below was executed through `./scripts/local`, for example `./scripts/local pnpm lint`. This is the isolation boundary: it clears inherited configuration before Node starts and keeps package/tool state under the repository. Local network/container commands needed execution-sandbox access but did not authorize other accounts or machine configuration. No external login or deployment command ran.

## Final command results

Live service verification completed; no service remains intentionally running. All commands use the prefix described above. All functional quality and startup gates passed. Full Phase 0 acceptance is withheld pending review of the recorded isolation exception.

| Command after `./scripts/local`                     | Result                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                    | PASS, exit 0; all 15 workspace projects; pnpm 12.4.1                                                                     |
| `pnpm lint`                                         | PASS, exit 0                                                                                                             |
| `pnpm typecheck`                                    | PASS, exit 0; 17 Turbo tasks plus tooling TypeScript check                                                               |
| `pnpm test`                                         | PASS, exit 0; 130 tests across 22 files, final run 4.24s                                                                 |
| `pnpm build`                                        | PASS, exit 0; final build 14 successful Turbo tasks (11 cached, 3 executed), 4.838s                                      |
| `pnpm extension:build`                              | PASS, exit 0                                                                                                             |
| `pnpm db:reset`                                     | PASS, exit 0; regression rerun also refreshed replacement-container ownership                                            |
| `pnpm seed`                                         | PASS, exit 0; succeeds after reset                                                                                       |
| `pnpm db:types`                                     | PASS, exit 0; generated from local Supabase                                                                              |
| `pnpm db:lint`                                      | PASS, exit 0; migration assertions and Supabase lint                                                                     |
| `pnpm services:start`                               | PASS, exit 0; final restricted-forwarding startup                                                                        |
| `pnpm services:health`                              | PASS, exit 0; exact project socket/context colima, Redis PONG, Supabase running                                          |
| `pnpm services:stop`                                | PASS, exit 0; final VM stopped and local data retained                                                                   |
| `pnpm test:integration`                             | PASS, exit 0; 4 tests, 1 file; none skipped, 1.23s                                                                       |
| `pnpm test:e2e`                                     | PASS, exit 0; 10 tests across desktop/mobile Chromium, final run 5.4s                                                    |
| `pnpm exec node apps/web/tests/extension-smoke.mjs` | PASS, exit 0; fresh-profile MV3 background, panel and manual-only shell                                                  |
| `pnpm dev`                                          | PASS startup/HTTP smoke: page and both readiness endpoints HTTP 200; intentionally stopped with Ctrl-C (wrapper exit 1)  |
| `pnpm format`                                       | PASS, exit 0                                                                                                             |
| `pnpm format:check`                                 | PASS, exit 0; all matched files use Prettier style                                                                       |
| `pnpm secrets:check`                                | PASS, exit 0; 192 text files; no tracked env/dependencies, supported secret patterns, or operational employer references |

## Failed attempts and corrections

Failures below are retained rather than presented as successful checks.

| Attempt                                       | Observed result                                                      | Correction / disposition                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Public npm lookup in restricted sandbox       | DNS `ENOTFOUND`                                                      | Repeated with authorized network access to public npm only                                                 |
| Node 24 platform-package lookup               | No matching package                                                  | Kept installed Node 25.2.1; no global installation; Node 24 remains unverified locally                     |
| Initial pnpm bootstrap                        | Wrong `.cjs` entry point                                             | Updated to pinned pnpm's actual `.mjs` entry point                                                         |
| Initial frozen install after manifest changes | Lockfile mismatch                                                    | Regenerated lockfile; final frozen install passes                                                          |
| Package test scripts from app directories     | No tests found                                                       | Corrected repository root resolution                                                                       |
| Initial logging contract tests                | 1 redaction test failed                                              | Sanitized Pino child/setBindings metadata; final contract tests pass                                       |
| Initial web lint/types                        | Link handler type and effect errors                                  | Corrected typed event and async state handling                                                             |
| Initial Next production build                 | Five shared source `.js` resolution errors                           | Export compiled package output; enforce build dependencies                                                 |
| Restricted Next build                         | Local worker port binding denied                                     | Cleared generated build cache and reran with local sandbox access; production build passes                 |
| Initial root lint                             | Unused schema/import                                                 | Used runtime schema and removed unused import                                                              |
| Initial Colima startup                        | Missing HOME / startup failure                                       | Passed actual HOME only to isolated Colima, keeping state overrides and disabling host SSH/mount access    |
| Colima startup with longer Lima path          | UNIX socket path 106 bytes exceeded 104-byte limit                   | Moved generated Lima state to shorter repository `.local/lima`                                             |
| Docker context check                          | Reported `default` despite environment                               | Added explicit repository config and `--context colima` arguments                                          |
| Fresh Docker configuration inspection         | Automatically selected platform credential store                     | Replaced it before image downloads with a denying repository helper; no Keychain credentials used          |
| Compose-based Redis startup                   | Docker reported unknown Compose option; exit 125                     | Replaced with guarded native Docker commands consuming validated Compose configuration                     |
| Seed/types/lint immediately after reset       | Ownership verification failed; each exit 1                           | Reset replaces the DB container; refresh verified ownership after reset                                    |
| First real integration suite                  | 1 failed suite; all 4 tests skipped because setup failed             | Raw local Redis PING confirmed protected-mode DENIED through Docker NAT; changed local Redis configuration |
| First loopback forwarding override restart    | Duplicate Unix socket forwards removed Docker socket; startup exit 1 | Preserve inherited socket rules instead of duplicating them; restrict network rules to project ports       |
| Cleanup after that partial startup            | `services:stop` exit 1 because Docker verification failed            | Guard refused container mutations; finally block successfully stopped the dedicated Colima VM              |

Additional diagnostics and corrections:

- A narrowed Lima override first failed validation because `guestIPMustBeZero` was set for IPv6. It is now set only for `0.0.0.0`; the corrected startup passed.
- Initial `pnpm dev` exited 1 because ten persistent tasks exhausted Turbo’s default concurrency. Concurrency 16 fixed startup.
- Review found Turbo filtering out tool/cache/temp paths; explicit passthrough and a regression test preserve the launcher boundary in child tasks.
- Process-scoped `lsof` diagnostics returned exit 1/no matching service listeners. The separate project network process showed its loopback VM-management listener only. Project service forwarding is evidenced by Lima runtime logs and successful local connections; an independent complete OS listener inventory was not established.
- The development wrapper returned exit 1 after each intentional Ctrl-C shutdown; these were controlled stops after successful HTTP checks.

Package installation also reported the selected ESLint release as deprecated. Development tasks also warned that pnpm was using its Node.js fallback because the native-install script was skipped; they still started successfully. Toolchain compatibility is pinned and documented; this did not fail installation or quality gates. Optional unused native build scripts are explicitly disabled.

## Isolation exception observed

During the first loopback override restart, Lima logged attempted host forwarding sockets under `/tmp/lima-psl-127.0.0.1-53-3727000647/sock` and `/tmp/lima-psl-127.0.0.1-53-20515128/sock`. The process had repository-local temporary-directory settings, but the broad forwarding rule reached privileged guest DNS port 53 and the tool reported these external temporary paths. It logged stopping both forwards after a bind failure. No files at those paths were inspected or manually removed. This is an explicit exception to the requested confinement; absolute absence of outside writes cannot be claimed. The VM was stopped, and the corrected rules exclude nonproject ports. Final runtime logs explicitly show DNS port 53 not forwarded and project ports 54321/54322/54324/56379 forwarded to `127.0.0.1`; no new `lima-psl` entry appeared in that startup log. Any inspection or cleanup outside the repository requires the owner's separate approval.

## Scope and external verification limits

- Real Reddit, AI, email, billing, and crawler services were not used. Real adapters and business workflows belong to later phases.
- No authentication flow, organizations, memberships, trial subscriptions, or other Phase 1 business tables were implemented.
- The extension has no Reddit host permission, content script, or submission capability. Browser verification uses a fresh repository-local Chromium profile.
- Hosted GitHub Actions and the personal Colima runner were not executed remotely. A personal runner must be provisioned separately before its service job can run.
- Node 24 is the CI target; actual local checks used Node 25.2.1.
- The hygiene scan can identify tracked credentials and known patterns; it cannot prove that every arbitrary string is nonsecret. Real dotenv files were deliberately not opened.

## Additional commands executed

Setup also used `./scripts/local bootstrap`, public-npm metadata lookups with `./scripts/local registry`, `./scripts/local pnpm install --no-frozen-lockfile`, and `./scripts/local pnpm exec playwright install chromium`. Focused Vitest, TypeScript, ESLint, and Prettier commands were run while resolving failures. The temporary dependency-pinning helper was removed after final exact versions were selected. Repository inspection used `rg`, file reads, and Git status/diff/name queries with no commit, push, or credential operation. Generated local Supabase/Docker status output was filtered so local keys were not displayed.

## Reproduction

Follow [local development](local-development.md) for setup and service ports. After services start, run reset, seed, database lint, all static gates, integration, and browser tests. Use `pnpm dev` for manual web/worker verification; stop it before tests using the same ports. End with `pnpm services:stop`. See [architecture decisions](../DECISIONS.md) for local-only design choices.

## Files and runtime evidence

The [complete changed-file inventory](phase-0-files.md) records all 184 worktree entries, including the preserved pre-existing instruction edit. The migration is `supabase/migrations/20260913000000_foundation.sql`. Screenshots from fresh desktop/mobile browser runs are in ignored `.threadsignal/verification/screenshots/`.

The final development smoke returned HTTP 200 for `/`, web `/api/health/ready` (database and Redis ready), and worker `/api/health/ready` (database, Redis and heartbeat up). Integration checked pgvector, the private bucket, absence of Phase 1 tables, real queue processing, and all five local providers. Browser tests checked rendering, protected-route redirects, keyboard navigation, health headers and accessible 404 states.
