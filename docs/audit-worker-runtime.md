# Worker deployment runtime completion audit

The final MVP audit found that real provider adapters existed but the worker entrypoint and job factories always selected local mocks. This change adds an explicit deployment profile while preserving the isolated local profile and the older personal-development knowledge-only worker.

## Runtime boundary

`parseWorkerConfig` delegates the deployment boundary to shared `parseDeploymentRuntime`. It requires the production environment, explicit deployment approval and worker runtime role, the exact Supabase project endpoint, its restricted `threadsignal_runtime_worker` PostgreSQL login, a supplied public database CA with certificate/hostname checking, and authenticated TLS Redis. Database administration credentials and mixed local/deployment settings are rejected. Errors retain neither Zod input nor parser causes.

The worker entrypoint accepts deployment only through this validation. Before any queues start, `verifyDeploymentDatabaseAuthority` checks the actual database role and grants. Every queue and consumer receives the same project-specific namespace and Redis TLS options. All processing subsystems start for this profile. Deployment health binds its configured port on the container interface; local and legacy personal-development health remain loopback-only. The deployment platform must keep worker health on its private network.

Supabase remains Auth/PostgreSQL/private Storage. Deployment Storage uses only the supplied server secret key against the exact project endpoint, with fixed buckets, path validation, time/size limits and redirects refused. Modern Supabase secret keys are sent as `apikey`, never incorrectly as a bearer JWT. The old local privacy constructor still refuses all remote configurations.

## Providers and usage

Worker provider factories receive explicit parsed configuration. Local and legacy profiles reject real Reddit/AI/email/crawler selections. The deployment profile can construct the implemented Reddit OAuth, OpenAI-compatible, Resend and simple crawler adapters; missing matching configuration fails closed. Constructing an adapter performs no external request. Reddit commercial approval remains mandatory. Notification URLs derive from the validated HTTPS application origin.

The existing SQL reservation remains the authority for draft quotas. An `AsyncLocalStorage` scope captures the real adapter's usage receipts for each concurrent operation, including retrieval embedding requests. The adapter emits one receipt per actual HTTP attempt, including retries and model fallback. Usage fields are validated independently of model output, so malformed output does not discard reported tokens. Missing upstream usage remains `NULL`, with the configured model retained. Aggregate totals remain unknown if any constituent receipt omits that field; mock receipts remain deterministic zero. No prices are invented and this is not external invoice reconciliation.

The additive `20260924010000_ai_usage_actuals.sql` migration preserves successful draft-job publication and receipt idempotency. Migration `20260924050000_general_ai_usage.sql` extends the same RLS-protected usage table for knowledge embeddings, opportunity evaluations and web search/suggestions/profile extraction. Worker knowledge/scoring attempts persist in a `finally` scope, including reported usage preceding a failure. Each durable lease UUID identifies one attempt; duplicate delivery cannot create a second receipt. Cached or filtered operations without AI calls create no usage row. The frozen personal-development Phase 2 worker retains its previous database surface.

The general recorder validates bounded metadata, matching organization/brand identity, an explicit task allowlist and complete receipt replay equality. Worker access is limited to worker tasks. The web billing bridge requires a verified user identity, current matching organization membership and a web task; anonymous/authenticated clients cannot call this global helper directly. Existing privacy exports and administrative organization/task metrics use the extended table.

Operators may optionally set server-only `AI_MODEL_COSTS_JSON` to a JSON object keyed by the exact configured model names. Each value must contain finite, nonnegative `inputPerMillion` and `outputPerMillion` numbers in USD per million tokens. These are owner-supplied estimates, not bundled current provider prices. At most 50 model entries, 150 characters per model name and 16,384 JSON characters are accepted. Both web and worker pass these rates to the adapter; absent model rates or missing usage keep cost unknown. Mock development requires no rate configuration. For example, a synthetic configuration shape is `{"example-model":{"inputPerMillion":2,"outputPerMillion":4}}`; replace the example rates with your own reviewed estimates.

## Embedding model changes

The `20260924030000_knowledge_embedding_identity.sql` migration adds provider/model/dimensions/version identities to documents and chunks. Existing data is labeled `mock:deterministic:512:v1`, matching its producer. Real identity is `openai:<configured model>:512:v1`.

The worker reuses cached embeddings only from the same identity. Re-crawling unchanged content after a model change replaces vectors and chunk identifiers; re-crawling with the same identity preserves unchanged chunks. Knowledge search, draft retrieval and opportunity evidence select the current identity. The new four-argument search RPC remains an RLS-protected invoker function; the compatible three-argument RPC searches only mock vectors. Legacy personal-development worker operations retain their old column surface until that project is deliberately upgraded.

After changing embedding provider/model, re-ingest sources before searching or drafting. Mixed vector spaces are excluded instead of silently producing misleading similarity scores. This does not change the existing 512-dimensional database requirement.

## Invitation retention

The existing privacy scheduler calls `private.cleanup_expired_invitations(100)`; no additional queue or customer operation is introduced. Migration `20260924040000_invitation_retention.sql` adds an indexed, atomic sweep that locks at most 100 candidates, skips busy rows and deletes only invitations whose terminal history is older than 30 days. The retention clock uses the latest acceptance/revocation timestamp, or expiration when neither exists. Live invitations and recent terminal records remain. Expiration already denies access immediately, independently of physical cleanup.

The helper has an empty search path and no anonymous/authenticated execution grant. The restricted worker receives only explicit helper execution, never direct invitation deletion or token-hash access. Rollback-only integration fixtures verify retention boundaries, batching, replay and browser-role denial.

## Verification

Focused commands, all through `./scripts/local`:

```sh
pnpm install --no-frozen-lockfile --offline
pnpm --filter @threadsignal/config build
pnpm --filter @threadsignal/database build
pnpm --filter @threadsignal/ai build
pnpm --filter @threadsignal/worker typecheck
pnpm --filter @threadsignal/worker lint
pnpm exec vitest run apps/worker/tests packages/ai/tests/identity.test.ts
```

The last focused run passed **109/109 tests across 10 files in 2.16 seconds**; worker typecheck/lint passed. It covers profile refusal, real factory construction with synthetic inputs, unchanged local and legacy startup, managed Redis TLS on every queue, refusal before queue creation when database authority fails, private Storage header/endpoint boundaries, concurrent AI receipt isolation and embedding-identity validation. No external connections were made by these tests.

The worker's new direct database-package dependency required a lockfile update: an intermediate command failed with the expected outdated-lockfile error; the offline installation then completed with zero downloaded packages. Earlier typecheck failed while that dependency was absent; it passed after installation. Integration cases were added to `phase2-worker.test.ts` and `phase4-worker.test.ts`; the final audit verification report records their executed database results and the complete regression gates.

The first full integration run reported two Phase 4 failures after the additional usage test exhausted that suite's shared one-minute admission window. Fixture setup now ages only its own disposable organization's prior jobs before each test case; runtime admission limits are unchanged.

After applying the invitation migration locally, `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/invitation-retention.test.ts tests/integration/phase4-worker.test.ts` passed **14/14 tests across two files in 3.87 seconds** (11 drafting cases, three invitation-retention cases). The first sandboxed attempt could not access the repository-owned Colima socket: both setup hooks failed and all 14 cases were skipped. The same local-only command passed with the approved socket access. Worker lint/typecheck and the tooling TypeScript check also passed after these changes. The root verification report records complete regression gates and restricted-role results.

After general usage accounting, `pnpm exec vitest run packages/ai/tests/openai.test.ts apps/worker/tests/ai-usage.test.ts packages/crawler/tests/simple.test.ts` passed **128/128 tests across three files in 1.64 seconds**. This includes receipt preservation on malformed output, retry/fallback unknown usage, mixed known/unknown totals, failed worker operations and bounded landing-page-only discovery. AI build/typecheck/lint and worker typecheck/lint passed. The new fixture initially called `embed` with the wrong input shape and was corrected; an earlier test-spy lint failure for unused parameters was also corrected. Migration/type generation completed locally without a reset.

No deployment, credential creation, hosted migration, external login, paid AI request, Reddit request or email delivery was performed. Live provider behavior, deployed TLS/egress, provider retention terms and production operability still require separately authorized verification with new personal project configuration.
