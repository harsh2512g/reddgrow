# Phase 5 file map

This phase builds the Chrome extension and its local application connection. Existing uncommitted Phase 0–4 work is preserved.

| Area            | Added or changed files                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MV3 extension   | `apps/extension/manifest.json`, `scripts/build.mjs`, `package.json`, `README.md`; `src/background/*`, `src/content/insert-composer.ts`, `src/shared/messages.ts`, `src/sidepanel/*`; seven extension test files                             |
| Shared boundary | New `packages/extension-contracts/{package.json,tsconfig*.json,src/index.ts,tests/urls.test.ts}` and public `config/extension-development.json`                                                                                             |
| Web API         | New `apps/web/src/lib/phase5/*`; `app/api/extension/{connection-code,sessions,revoke,exchange,current,disconnect}/route.ts`; draft edit/prepare/inserted/published extension routes; `app/api/drafts/[id]/mark-published/route.ts`          |
| Web UI          | `components/phase5/{connections,handoff,discussion-fixture}.tsx`; settings Integrations page/loading; Phase 4 studio/schema/server metadata; local `app/extension-fixture/reddit/r/[subreddit]/comments/[postId]/fixture/page.tsx`          |
| Database        | `supabase/migrations/20260920000000_extension_workflow.sql`, `20260920010000_extension_role_activation.sql`, `20260920020000_extension_session_history.sql`; generated `packages/database/src/database.types.ts`; foundation SQL assertions |
| Worker          | `apps/worker/src/jobs/extension-cleanup.ts`, `apps/worker/src/runtime.ts`                                                                                                                                                                   |
| Verification    | `tests/integration/phase5-database.test.ts`, service schema assertions; `apps/web/tests/phase5-{api,ui,rate-limit}.test.*`, Phase 4 UI expectation; `tests/extension/manual-handoff.spec.ts`, `playwright.extension.config.ts`              |
| Tooling/docs    | Root/web/extension package manifests, `pnpm-lock.yaml`, `tsconfig.tooling.json`, GitHub CI, hosted-bootstrap exclusion list, README, DECISIONS, IMPLEMENTATION_STATUS, `docs/extension.md`, Phase 5 file/verification records               |

Additional regression/tooling changes: `vitest.config.ts` caps concurrent workers at two; `apps/web/tests/e2e/drafts.spec.ts` distinguishes an explicit manual publication record from a Reddit submission action. Extension API tests cover native browser fetch invocation; web API tests cover Next's loopback URL normalization while preserving exact incoming host validation.

No Phase 6 feature, hosted migration, external login, commit or push is included.
