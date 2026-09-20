# Phase 2 verification — 2026-09-15

Phase 2 is implemented for the repository-owned local Supabase/Redis stack. The owner explicitly selected local processing. Hosted Phase 1 sign-in was reported successful by the owner; hosted Phase 2 schema and worker processing are not enabled. Phase 3 has not started. No commit, push, deployment, or external login was performed.

## Implementation and acceptance evidence

| Criterion                                              | Evidence                                                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Create, view, edit, select, archive and restore brands | Validated profile forms, user-scoped loaders, owner/admin SQL RPCs, plan locks, component/API/database tests                            |
| Full product context and honest affiliation            | Product/audience/use-case/competitor/vocabulary/tone/real-role/disclosure fields and completion checklist                               |
| Ingest the demo website                                | Six explicitly approved ClarityScale fixture pages processed by the real local worker; desktop/mobile browser journeys                  |
| Private PDF, Markdown, text and manual knowledge       | Browser upload and download byte checks for all three file formats, manual-note processing, actual private Storage integration tests    |
| Safe extraction and useful chunks                      | MIME/signature/size checks, encrypted/unreadable PDF tests, isolated PDF thread, bounded chunks with overlap and source metadata        |
| Search knowledge and show provenance                   | pgvector retrieval with deterministic 512-dimensional vectors; source titles, URLs and PDF page numbers; browser evidence search        |
| Retry without duplicate content                        | Concurrent claims, expired/wrong leases, generation fencing, unchanged chunk-ID/checksum comparison after real browser re-crawl         |
| Exclude and delete content                             | Search exclusion/re-inclusion tested; immediate content purge; private-file cleanup; deletion race and retry tests                      |
| Tenant, role and allocation isolation                  | Cross-organization reads/mutations/search/Storage, manager roles, concurrent brand/page limits, composite identity checks               |
| Hosted profile remains isolated                        | Sixteen API/loader tests include hosted refusal before workspace/database access and hosted loaders returning no Phase 2 queries        |
| Interesting, accessible responsive UI                  | Desktop/mobile brand, source and search screenshots reviewed; actual counts; visible states; overflow checks; seventeen component tests |
| Development isolation and scope                        | Colima ownership/health check; five local providers retained; repository hygiene; no Phase 3 tables                                     |

## Commands and outcomes

All package commands use `./scripts/local`, which clears inherited configuration and uses repository-local state. The runtime tested here is Node 25.2.1; Node 24 remains the CI target.

| Command                                                                                 | Observed result                                                                                                                                                |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./scripts/local registry pdfjs-dist`                                                   | Public npm metadata resolved version 6.3.289                                                                                                                   |
| `./scripts/local pnpm install --no-frozen-lockfile`                                     | Exit 0; 16 workspace projects; three packages added                                                                                                            |
| `./scripts/local pnpm install --frozen-lockfile`                                        | Exit 0; lockfile current, no resolution changes                                                                                                                |
| `./scripts/local pnpm db:migrate`                                                       | Exit 0; pending local migration applied without reset                                                                                                          |
| Local reconciliation via `pnpm exec node --input-type=module -e …`                      | Exit 0; added chunk section metadata and replaced deletion-retry function to match the finalized development migration. Temporary SQL helper removed after use |
| `./scripts/local pnpm db:types`                                                         | Exit 0, run again after reconciliation                                                                                                                         |
| `./scripts/local pnpm seed`                                                             | Exit 0; idempotent synthetic ClarityScale brand/source seed                                                                                                    |
| `./scripts/local pnpm db:lint`                                                          | Exit 0; foundation assertions and PostgreSQL lint passed                                                                                                       |
| `./scripts/local pnpm lint`                                                             | Final exit 0                                                                                                                                                   |
| `./scripts/local pnpm format:check`                                                     | Exit 0; final repository formatting check passed                                                                                                               |
| `./scripts/local pnpm typecheck`                                                        | Exit 0; 23/23 Turbo tasks and tooling TypeScript passed                                                                                                        |
| `./scripts/local pnpm test`                                                             | Exit 0; 322 tests across 40 files passed in 12.61 s                                                                                                            |
| `./scripts/local pnpm build`                                                            | Final exit 0; 15/15 tasks, including web, worker and unchanged extension build; 9.535 s                                                                        |
| `./scripts/local pnpm test:integration`                                                 | Exit 0; 42/42 tests across four files, 12.06 s                                                                                                                 |
| `./scripts/local pnpm test:e2e apps/web/tests/e2e/knowledge.spec.ts --project=chromium` | Exit 0; full Phase 2 journey passed, 47.4 s including startup                                                                                                  |
| `./scripts/local pnpm test:e2e`                                                         | Exit 0; 17 passed, one intentional duplicate mobile-role skip, 1.3 min                                                                                         |
| `./scripts/local pnpm test:e2e apps/web/tests/e2e/knowledge.spec.ts`                    | Exit 0; final-build desktop/mobile both passed, 55.4 s                                                                                                         |
| `./scripts/local pnpm build:hosted`                                                     | Exit 0; shared packages and hosted Next.js build passed                                                                                                        |
| `./scripts/local pnpm services:health`                                                  | Exit 0; context `colima`, project-local socket, Redis PONG, Supabase running                                                                                   |
| `./scripts/local pnpm secrets:check`                                                    | Exit 0; 322 text files at the initial check; final inventory check recorded below                                                                              |
| `git diff --check` with cleared Git configuration                                       | Exit 0; no whitespace errors                                                                                                                                   |

Targeted runs also passed: 14 Phase 2 database integration tests; seven worker integration tests; sixteen web API isolation/upload tests; seventeen UI tests; eighteen final extraction/chunking tests. Relevant files are listed in [Phase 2 files](phase-2-files.md). The existing CI service job runs the extended integration suite and Playwright configuration; Playwright now starts the owned local worker when services are verified.

## Failures and corrections

- Initial targeted database/worker integration attempts could not access the Docker API within the sandbox. The scoped requests for the owned local Colima stack were approved; reruns passed. No denied action remains blocked.
- One database test constructed a SQL identifier incorrectly (`public` instead of `public.table`). The test helper was corrected; all fourteen tests then passed.
- Initial lint found a control-character regular expression in intentional text normalization. The local exception is justified next to that sanitation code; lint subsequently passed.
- Initial web TypeScript found a generic Zod envelope inference error in the new client API helper. Explicitly parsing the envelope before the payload fixed it.
- The new E2E helper initially used an incorrect relative import, then lacked a declaration for the JavaScript service helper. It now validates the isolated runner's local database URL directly. A build failed on that type error, and the browser attempt immediately afterward correctly refused to start without a completed production build. Subsequent builds and browser runs passed.
- Initial formatting check found five new/edited files. They were formatted, and the check passed. Documentation is checked again at completion.
- An upload audit found a long-filename path could fail validation after storage, and thrown RPC errors could skip compensation. Input validation now happens before upload, filenames retain their supported extension within the path bound, and both returned and thrown RPC failures trigger private-file cleanup. Regression tests pass.
- A successful source deletion could race the detail page refresh. The UI now returns to the library after deletion; final browser checks cover that behavior.
- A unit run emitted Node's existing `--localstorage-file` warning; tests passed. A read-only Git whitespace check emitted a macOS temporary-directory fallback warning mentioning `/tmp`. No outside-repository file inspection or cleanup was performed; no outside write is established by that warning. The historical Phase 0 Lima isolation exception remains separately recorded, not erased by these results.

Routine read-only file-discovery misses and an unapplied patch-context mismatch were corrected without changing unrelated work.

## Manual review and external boundaries

Open the local app at <http://127.0.0.1:3000/app/brands>. Request a magic link for `owner@threadsignal.test` and open it from the local inbox at <http://127.0.0.1:54324> in the same browser. Review the seeded ClarityScale brand, open its library, and search for `batch image processing`. For a new workspace, choose **Use synthetic demo** in the brand form, then explicitly approve website pages. See [the complete guide](phase-2-development.md).

The existing hosted profile remains <http://localhost:3002>. It uses a separate login and data set. Phase 2 screens explain the local-only boundary. No hosted Phase 2 migration, hosted worker credential, real crawler/AI/Reddit/billing/email call, Google OAuth login, deployment, remote CI run, or Node 24 runtime test was performed.

The worker's local Storage key is read from the verified owned stack into the worker process only. It is not persisted or supplied to web. Supported secret-pattern scanning is not a proof that every possible secret format is absent; tracked environment/dependency checks and configuration isolation also pass.

A process crash between object upload and source-record creation can leave an uncommitted private object, because PostgreSQL and object storage do not share a transaction. Normal failures compensate; a simultaneous Storage failure is reported explicitly. Hosted processing and any external credentials require a separate future review. No new approval is required for the authorized local Phase 2 workflow.

## Final checkpoint

- Final-build Phase 2 E2E rerun: **2/2 passed**, desktop and mobile, 55.4 seconds including startup. This includes the corrected deletion navigation.
- `./scripts/local pnpm build:hosted`: **exit 0**, twelve shared package builds and the hosted Next.js build passed; no hosted database changes.
- `./scripts/local pnpm dev` and `./scripts/local pnpm dev:hosted`: started successfully and remain running. Local web became ready in 1.638 seconds; hosted web in 428 ms. All shared-package watchers reported zero errors; the background worker started on port 3001.
- `./scripts/local pnpm exec node .threadsignal/verification/phase2-runtime.mjs`: **exit 0**. Local homepage, web readiness, worker readiness, hosted homepage and hosted login each returned HTTP 200. A hosted Phase 2 mutation returned the expected HTTP 503 `LOCAL_ONLY` before accessing Phase 2 data.
- Final hygiene check: **323 repository text files**, exit 0. Environment files, node_modules and local runtime state remain ignored.
- Development startup emitted the expected pnpm Node-launcher/native-binary notice; no reinstall or machine-wide change was performed.

Phase 2 is ready for local review. No Phase 3 work or new approval is needed for this local workflow. The historical isolation exception and external verification limits remain as stated above.
