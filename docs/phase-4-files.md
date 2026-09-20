# Phase 4 files

This manifest covers this phase, including essential predecessor lock-order fixes.
Earlier uncommitted Phase 0–3 files remain in the working tree. No commit was created.

## Shared draft and AI contracts

- `packages/drafts/package.json`
- `packages/drafts/src/pipeline.ts`
- `packages/drafts/src/schema.ts`
- `packages/drafts/tests/pipeline.test.ts`
- `packages/drafts/tsconfig.build.json`
- `packages/drafts/tsconfig.json`
- `packages/ai/src/index.ts`
- `packages/ai/src/openai.ts`
- `packages/ai/tests/provider.test.ts`
- `packages/ai/tests/openai.test.ts`

## Database and worker

- `supabase/migrations/20260919000000_draft_workflow.sql`
- `supabase/seed.sql`
- `supabase/tests/foundation.sql`
- `packages/database/src/database.types.ts`
- `apps/worker/src/jobs/drafts.ts`
- `apps/worker/src/jobs/reddit.ts`
- `apps/worker/src/runtime.ts`
- `apps/worker/src/config.ts`
- `apps/worker/tests/draft-policy.test.ts`
- `config/drafts-development.json`
- `scripts/worker.mjs`

## Application

- `apps/web/src/lib/database-read-diagnostics.ts`
- `apps/web/src/lib/organizations/server.ts`
- `apps/web/src/components/phase4/evidence.tsx`
- `apps/web/src/components/phase4/persona.tsx`
- `apps/web/src/components/phase4/primitives.tsx`
- `apps/web/src/components/phase4/studio.tsx`
- `apps/web/src/lib/phase4/api.ts`
- `apps/web/src/lib/phase4/client.ts`
- `apps/web/src/lib/phase4/editor.ts`
- `apps/web/src/lib/phase4/schema.ts`
- `apps/web/src/lib/phase4/server.ts`
- `apps/web/src/app/api/drafts/[id]/approve/route.ts`
- `apps/web/src/app/api/drafts/[id]/copy/route.ts`
- `apps/web/src/app/api/drafts/[id]/feedback/route.ts`
- `apps/web/src/app/api/drafts/[id]/regenerate/route.ts`
- `apps/web/src/app/api/drafts/[id]/reject/route.ts`
- `apps/web/src/app/api/drafts/[id]/restore/route.ts`
- `apps/web/src/app/api/drafts/[id]/route.ts`
- `apps/web/src/app/api/drafts/[id]/verify/route.ts`
- `apps/web/src/app/api/drafts/route.ts`
- `apps/web/src/app/app/drafts/[id]/loading.tsx`
- `apps/web/src/app/app/drafts/[id]/page.tsx`
- `apps/web/src/app/app/drafts/loading.tsx`
- `apps/web/src/app/app/drafts/page.tsx`
- `apps/web/src/app/app/settings/persona/loading.tsx`
- `apps/web/src/app/app/settings/persona/page.tsx`
- `apps/web/src/app/api/brands/[id]/persona/route.ts`
- `apps/web/src/app/api/opportunities/[id]/drafts/route.ts`
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/phase3/opportunities.tsx`
- `apps/web/src/components/phase3/primitives.tsx`

## Verification

- `apps/web/tests/database-read-diagnostics.test.ts`
- `tests/integration/phase4-database.test.ts`
- `tests/integration/phase4-worker.test.ts`
- `tests/integration/phase3-worker.test.ts`
- `tests/integration/services.test.ts`
- `apps/web/tests/phase4-api.test.ts`
- `apps/web/tests/phase4-editor.test.ts`
- `apps/web/tests/phase4-ui.test.tsx`
- `apps/web/tests/phase3-ui.test.tsx`
- `apps/web/tests/e2e/drafts.spec.ts`

## Workspace and documentation

- `package.json`
- `apps/worker/package.json`
- `apps/web/package.json`
- `pnpm-lock.yaml`
- `.env.example`
- `apps/worker/.env.example`
- `scripts/prepare-hosted-supabase.mjs`
- `README.md`
- `IMPLEMENTATION_STATUS.md`
- `DECISIONS.md`
- `docs/phase-4-contracts.md`
- `docs/phase-4-ai.md`
- `docs/phase-4-development.md`
- `docs/phase-4-verification.md`
- `docs/phase-4-files.md`
