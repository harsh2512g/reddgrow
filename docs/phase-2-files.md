# Phase 2 implementation files

This list describes Phase 2 changes within the existing uncommitted workspace. Earlier Phase 0/1 changes are preserved; no commit or push was created.

## Database and ingestion

- `supabase/migrations/20260916000000_brand_knowledge.sql`: eight RLS tables, private Storage policies, allocation, source lifecycle, and search functions.
- `supabase/seed.sql`, `supabase/tests/foundation.sql`: idempotent synthetic brand/source and Phase 2 schema assertions.
- `packages/database/src/database.types.ts`: regenerated public types.
- `packages/knowledge/package.json`, `tsconfig.json`, `tsconfig.build.json`, `src/schema.ts`, `src/files.ts`, `src/pipeline.ts`, `tests/pipeline.test.ts`: shared validation, safe extraction, chunking, and embedding reuse.
- `packages/crawler/src/index.ts`, `src/fixtures.ts`, `tests/provider.test.ts`: approved fixture discovery and URL boundary.
- `packages/ai/src/index.ts`, `tests/provider.test.ts`: deterministic lexical mock embeddings.
- `fixtures/knowledge/pdf.ts`: synthetic PDF fixture factory.
- `apps/worker/src/jobs/knowledge.ts`, `src/storage.ts`, `src/config.ts`, `src/runtime.ts`, `scripts/build.mjs`, `package.json`, `.env.example`, `README.md`, and worker tests: durable ingestion and private Storage processing.
- `scripts/worker.mjs`, `scripts/worker-storage.mjs`: isolated worker-only local Storage access.

## Web application

- `apps/web/src/lib/knowledge/{server,api,http}.ts`: authenticated loaders, mutation authorization, bounded request bodies, upload compensation, and safe errors.
- `apps/web/src/app/api/brands/**`: brand creation/update, approved page discovery, source creation and upload.
- `apps/web/src/app/api/knowledge/**`: retries, deletion, inclusion, search, private downloads.
- `apps/web/src/components/phase2/*`: brand forms/library/detail, knowledge/source/search screens, shared states and API validation.
- `apps/web/src/app/app/brands/**`, `apps/web/src/app/app/knowledge/**`, `apps/web/src/app/app/settings/brand/page.tsx`: Phase 2 routes and loading states.
- `apps/web/src/components/app-shell.tsx`, `components/phase1/dashboard.tsx`, `app/app/page.tsx`: navigation and local knowledge entry points.
- `apps/web/package.json`, `apps/web/README.md`: shared dependencies and local documentation.

## Verification, tooling, and documentation

- `tests/integration/phase2-database.test.ts`, `phase2-worker.test.ts`, updated `services.test.ts`: tenant, quota, Storage, lease, retry, and Phase 3 absence checks.
- `apps/web/tests/knowledge-api.test.ts`, `knowledge-http.test.ts`, `phase2-ui.test.tsx`, `e2e/knowledge.spec.ts`: API isolation and complete desktop/mobile knowledge journeys.
- `playwright.config.ts`: starts the owned local worker for authenticated browser runs.
- `scripts/database.mjs`, root `package.json`: non-destructive `db:migrate` and shared dependencies.
- `scripts/prepare-hosted-supabase.mjs`, `tests/tooling/hosted-supabase.test.ts`: keep the hosted bootstrap pinned to Phase 0/1.
- `pnpm-lock.yaml`: pinned public-npm dependency resolution.
- `README.md`, `DECISIONS.md`, `IMPLEMENTATION_STATUS.md`, `docs/phase-2-development.md`, this inventory, and `docs/phase-2-verification.md`: current scope, decisions, instructions, and evidence.

Screenshots and local runtime state remain ignored under `.threadsignal/`. `node_modules`, environment files, public hosted configuration, and local service credentials are not tracked.
