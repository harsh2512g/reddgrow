# Phase 3 implementation files

Phase 3 changes are uncommitted and preserve the earlier uncommitted foundation. The important entry points are:

| Area                                 | Files                                                                                                                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL schema and permissions           | `supabase/migrations/20260918000000_opportunity_pipeline.sql`                                                                                                                                        |
| Seed, assertions, generated types    | `supabase/seed.sql`, `supabase/tests/foundation.sql`, `packages/database/src/database.types.ts`                                                                                                      |
| Reddit provider                      | `packages/reddit/src/index.ts`, `types.ts`, `mock.ts`, `fixtures.ts`, `oauth.ts`; provider/OAuth tests                                                                                               |
| AI analysis                          | `packages/ai/src/index.ts`, `opportunity.ts`; AI provider tests                                                                                                                                      |
| Shared scoring                       | `packages/opportunities/package.json`, TypeScript configs, `src/schema.ts`, `src/scoring.ts`, `tests/scoring.test.ts`                                                                                |
| Worker processing                    | `apps/worker/src/jobs/reddit.ts`, `src/runtime.ts`, `src/config.ts`, `tests/reddit-policy.test.ts`, `package.json`, `.env.example`                                                                   |
| Worker policy and launcher           | `config/reddit-development.json`, `scripts/worker.mjs`                                                                                                                                               |
| Web UI                               | `apps/web/src/components/phase3/{communities,keywords,opportunities,primitives}.tsx`; `/app/subreddits`, `/app/keywords`, `/app/opportunities`, `/app/opportunities/[id]` pages and loading states   |
| Web authorization/data access        | `apps/web/src/lib/phase3/{api,client,schema,server}.ts`                                                                                                                                              |
| APIs                                 | `/api/subreddits/search`; brand community/keyword routes; community update/refresh routes; keyword update routes; opportunity list/detail/status/save/dismiss/rescore/bulk routes                    |
| Existing shell/profile prerequisites | Navigation and dashboard entry points; brand competitor notes and alias labels; `packages/knowledge/src/schema.ts`                                                                                   |
| Verification                         | `tests/integration/phase3-database.test.ts`, `tests/integration/phase3-worker.test.ts`, `tests/integration/services.test.ts`; web Phase 3 API/UI tests; `apps/web/tests/e2e/opportunities.spec.ts`   |
| Workspace                            | Root `package.json`, `pnpm-lock.yaml`, `.env.example`, `.prettierignore`; web package dependencies                                                                                                   |
| Hosted baseline preservation         | `supabase/reference/phase2-schema.json`, `scripts/migrate-hosted-phase2.mjs`, `scripts/hosted-worker.mjs`, `scripts/prepare-hosted-supabase.mjs`                                                     |
| Documentation                        | `README.md`, `IMPLEMENTATION_STATUS.md`, `DECISIONS.md`, `docs/phase-3-{contracts,development,provider,verification,files}.md`, `docs/phase-2-development.md`, `docs/phase-2-worker-verification.md` |

The separate Phase 2 worker follow-up is prepared but not provisioned in the cloud. Its role operation, isolated profile/access launchers, environment gates, and verification are recorded in `docs/phase-2-worker-verification.md`. The checksum-pinned Phase 2 schema reference contains catalog structure and privileges only. No original reviewed migration was edited.

Additional regression coverage is in `apps/web/tests/e2e/opportunity-pagination.spec.ts` (real PostgREST cursor ties and combined filters) and `tests/integration/phase2-database.test.ts` (complete vocabulary equality independent of row order).

Browser screenshots and scoped local migration reconciliation receipts are ignored under `.threadsignal/verification/`. No credential, `.env.local`, build output, or `node_modules` belongs in Git.

The local-login navigation follow-up adds `apps/web/src/components/phase1/local-account-help.tsx` and `apps/web/tests/e2e/local-workspace.spec.ts`; updates login, Phase 2/3 notice components, matching page destinations, existing UI tests, the local guide, verification/status, and ADR-021. Authentication and database code are unchanged.
