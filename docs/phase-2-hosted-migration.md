# Phase 2 hosted database migration

The owner explicitly requested migration of their personal development Supabase project. The database migration committed on 2026-09-15 at 17:07:59 UTC. An independent read-only connection verified the committed schema at 17:08:45 UTC. Existing Phase 1 schema and permissions match the verified local baseline. No existing user/account/customer rows were read, copied, reset, or removed.

The eight new tables are `brands`, `brand_competitors`, `brand_personas`, `brand_keywords`, `knowledge_sources`, `knowledge_documents`, `knowledge_chunks`, and `knowledge_jobs`. Verification compares RLS, column types/defaults/nullability, table/column access, constraints, indexes, triggers, fourteen public/private routines, and the three knowledge Storage policies. The private bucket and pgvector are present. Hosted Auth continues to respond with HTTP 200.

Hosted processing is **not enabled**. The running worker accepts only the owned local database and the hosted app still denies Phase 2 workflows. A dedicated restricted worker connection, separate hosted queue namespace, Storage access, and live ingestion verification remain necessary before enabling those workflows. The supplied secret API key was not needed or read by this migration. No Phase 3, deployment, commit, or push occurred.

## Reproducible commands

Run from the repository, with its own Colima services available as the verified comparison database:

```sh
./scripts/local pnpm supabase:check:phase2
./scripts/local pnpm supabase:migrate:phase2
```

`check` performs read-only catalog queries. `apply` uses one guarded transaction and only the reviewed Phase 2 source. If the complete schema already matches, it verifies without reapplying. Mismatches fail rather than replacing existing objects. These commands target only the personal project specified in ignored `.threadsignal/hosted-supabase.json`, matched against the newly authorized `DATABASE_URL` in root `.env.local`. Do not supply credentials as CLI arguments or in chat.

The tool validates the URI and reads no other dotenv configuration. It trusts only Supabase's public CA downloaded from the URL in its official Studio source, with verified HTTPS, and retains PostgreSQL client CA/hostname verification. Certificate data stays in memory; no system trust store is changed. A literal unescaped percent sign in the supplied password is preserved in memory; `.env.local` is unchanged.

Source migration: `supabase/migrations/20260916000000_brand_knowledge.sql`, SHA-256 `63956c0008d46dcd4356b74b897baacf3d3eb1f005f1377404c2bddca8b0d86c`.

Verified Phase 1 schema hash: `889f1e903b04191dc0b07190d214111c6b328b7562177a218d1c388e24802514`.

Verified Phase 2 schema hash: `96272ceab7827ed92ed5ffafafbe7b0321b2c0edda8e61bc1f999bedf69b2f71`.

The ignored `.threadsignal/hosted/phase2-migration-result.json` records the latest result, project reference, timestamp, and hashes, with no secrets or customer data. Supabase CLI migration history is intentionally unchanged because Phase 1 was initialized through SQL Editor. Do not run an unreviewed `db push`, `setup.sql`, or reset against this database.

## Executed checks and failures

| Command or check                                                       | Result                                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial scoped DATABASE_URL parsing/connection probes                  | Exit 1; malformed percent escape identified without printing the value. In-memory literal-percent handling fixed parsing.                                                                                  |
| Read-only connection with default CA trust                             | Exit 1, `SELF_SIGNED_CERT_IN_CHAIN`; no certificate-verification bypass used.                                                                                                                              |
| Public certificate lookup at `supabase.com/downloads/prod-ca-2021.crt` | HTTP 404; rejected. Official Studio source lookup identified the valid Supabase download URL.                                                                                                              |
| Read-only connection with official CA                                  | Exit 0; authenticated as project database administrator, Phase 1 present and Phase 2 absent. Client certificate and hostname verification enabled. The pooler's separate backend SSL flag was false.       |
| Initial `supabase:check:phase2`                                        | Exit 0, `ready-to-apply`; Phase 1 baseline matched.                                                                                                                                                        |
| First three `supabase:migrate:phase2` attempts                         | Exit 1, column comparison mismatch; each transaction rolled back. Diagnostics identified only the physical position of `knowledge_chunks.section_heading`, documented in the earlier local reconciliation. |
| Final `supabase:migrate:phase2`                                        | Exit 0, `applied-and-verified`; comparison by column name retained all definition and permission checks.                                                                                                   |
| Independent `supabase:check:phase2`                                    | Exit 0, `already-applied-and-verified`; matching hashes read after commit.                                                                                                                                 |
| `supabase:check`                                                       | Exit 0; Auth HTTP 200, anonymous Phase 1 REST access HTTP 401 as expected.                                                                                                                                 |
| Focused hosted tooling tests, initial run                              | 20 passed, 1 failed: the test's unquoted `#fragment` was correctly parsed as a dotenv comment. Quoted the fixture to test URI fragments.                                                                   |
| Focused hosted tooling tests, corrected run                            | 21/21 passed in three files.                                                                                                                                                                               |
| `./scripts/local pnpm lint`                                            | Exit 0.                                                                                                                                                                                                    |
| `./scripts/local pnpm typecheck`                                       | Exit 0; 23/23 Turbo tasks and tooling TypeScript check.                                                                                                                                                    |
| `./scripts/local pnpm test`                                            | Exit 0; 329/329 tests in 41 files. Existing Node localStorage warning appeared; tests passed.                                                                                                              |
| `./scripts/local pnpm build`                                           | Exit 0; 15/15 tasks, 14 cached and web rebuilt.                                                                                                                                                            |

Additional final checks:

- `./scripts/local pnpm exec vitest run --config vitest.integration.config.ts tests/integration/phase2-database.test.ts`: exit 0, 14/14 tests against the owned local database.
- Scoped HTTP checks of `http://localhost:3002/`, `/login`, and `/api/health`: all HTTP 200, without cookies or a browser session.
- `./scripts/local pnpm format:check`: exit 0.
- `./scripts/local pnpm secrets:check`: exit 0, 327 repository text files checked.
- `git -c core.fsmonitor=false diff --check`: exit 0. `git check-ignore` confirmed `.env.local`, `node_modules`, and the migration receipt remain ignored.

Files added: `scripts/hosted-database-config.mjs`, `scripts/migrate-hosted-phase2.mjs`, `tests/tooling/hosted-database.test.ts`, and this document. Files changed: `package.json`, `IMPLEMENTATION_STATUS.md`, `DECISIONS.md`, and `docs/hosted-supabase.md`. The source migrations, application runtime, worker, and user credential file were not edited. The ignored receipt was generated locally.

The existing local E2E evidence remains in `phase-2-verification.md`; E2E was not rerun for this migration-only tooling change. This migration's catalog comparisons do not establish hosted two-user isolation or a hosted authenticated browser/ingestion journey. Existing sign-in success remains owner-reported; no login email or browser session was used for this migration.
