# Deployment and provider activation

This is a release preparation guide, not authorization to create accounts, migrate a hosted project or deploy. The specification audit adds an explicit deployment profile while preserving the isolated local launcher and the separate personal Phase 2 profile. Supabase remains Auth, PostgreSQL/pgvector and private Storage. Local contract tests do not prove a hosted launch; see the final audit verification record.

## Runtime boundaries implemented in the audit

| Component      | Implemented boundary                                                                                                                                                            | External acceptance still required                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Web/API        | Explicit `deployment` mode, exact HTTPS Supabase/app identity, conditional providers, TLS Redis, restricted `threadsignal_runtime_web` login and fixed bridge-role transactions | Provision the reviewed roles and additive schema on an authorized personal project; verify the actual host and network         |
| Worker         | Separate deployment configuration, restricted `threadsignal_runtime_worker`, certificate-verified PostgreSQL/Redis, server-only Storage and all queue subsystems                | Supervise the compiled worker and verify real queues, shutdown, persistence and private health endpoints                       |
| Database roles | `supabase/operations/deployment-runtime-roles.sql` creates NOLOGIN roles with explicit column/RLS/function grants; startup checks reject privilege drift                        | Owner must separately authorize role provisioning and a new runtime credential; no administrator DB URL is accepted by runtime |
| Local launcher | Continues to supply only mock/console/fixture providers and project-owned Colima endpoints                                                                                      | No change required; never use this launcher to activate real providers                                                         |
| Providers      | Explicit runtime factories for OAuth Reddit, AI, Stripe, Resend and simple crawler; credentials required only for selected modes                                                | New personal credentials, approval and live test-mode acceptance for each selected provider                                    |
| Crawler        | Public-address DNS pinning, redirect/domain revalidation, robots, bounded responses/time and approved-page preview/selection                                                    | Test approved customer sites; no Reddit scraping fallback and no authenticated-page crawling                                   |
| Extension      | Separate explicit HTTPS public build profile with matching public key/Chrome ID; no-submit permissions preserved                                                                | Authorize the selected app origin and manually verify Chrome/native Reddit compatibility                                       |

The deployment profile is not enabled by a boolean alone: the full environment contract and PostgreSQL authority checks must pass. Existing hosted bootstrap and Phase 2 catalog hashes stay preserved. Later migrations require schema/history reconciliation, not blanket replay or reset. The role operation is tested in rollback-only local transactions and has not been executed on hosted Supabase.

## Vercel web build settings

The initial Vercel deployment stopped at `scripts/check-install.mjs` because the guard accepted only the local launcher. The guard now also accepts Vercel build markers (`VERCEL=1`, `CI=1`, `VERCEL_ENV=preview` or `production`), while refusing a mixed local/Vercel environment and non-public npm registry overrides. These markers select the install policy; they are not credentials or runtime authorization.

Use the following settings for the personal Vercel project:

| Setting                                     | Value                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Framework Preset                            | Next.js                                                                                                                                          |
| Root Directory                              | `apps/web`                                                                                                                                       |
| Include source files outside Root Directory | Enabled, so shared workspace packages are available                                                                                              |
| Node.js version                             | 24.x                                                                                                                                             |
| Environment variable                        | `ENABLE_EXPERIMENTAL_COREPACK=1`, for the pinned `pnpm@12.4.1`                                                                                   |
| System environment variables                | Enable access so Vercel supplies its build markers                                                                                               |
| Install Command                             | Use checked-in `apps/web/vercel.json`: `cd ../.. && corepack pnpm install --frozen-lockfile --prod=false --registry=https://registry.npmjs.org/` |
| Build Command                               | Use checked-in configuration: `cd ../.. && pnpm --version && pnpm build:web`                                                                     |
| Output Directory                            | Framework default (`.next` under `apps/web`); no override                                                                                        |

`build:web` builds the web workspace and its dependencies in topological order through pnpm. It preserves hosting-provided environment variables rather than passing the Next build through the local launcher or Turbo's local environment filter/cache. It excludes the extension and worker applications. Next's file tracing includes the repository root so deployed server functions can include shared compiled packages.

The build calls the environment's `pnpm` directly and logs its version first. The owner reported that installation completed with 12.4.1, but explicitly invoking Corepack again for the build selected 12.2.1 and failed with `ERR_PNPM_BAD_PM_VERSION`. Keep `packageManager: pnpm@12.4.1` in both manifests and retain the working install command; do not ignore or downgrade the version check. The new build log should show `12.4.1` before compilation. If a dashboard Build Command override still contains `corepack pnpm build:web`, remove that override or set it to the checked-in command above. Keep the Root Directory at `apps/web`.

Do not set `THREADSIGNAL_LOCAL=1` or use `./scripts/local` in Vercel as a workaround. The launcher intentionally replaces inherited credentials, app URLs and provider choices with isolated local values. Do not disable lifecycle scripts to skip the guard. No Supabase migration, provider activation or worker deployment occurs during dependency installation or web compilation.

The install/build fix does not configure hosted runtime services. Before accepting traffic, supply the validated **web deployment profile** described below, including the restricted web database role, database CA and managed TLS Redis. A Supabase URL and publishable key alone are insufficient for this application's full hosted runtime. The existing `personal-development` profile is pinned to `http://localhost:3002` and is not a Vercel profile. Keep Reddit/AI/billing mocked, email console and crawling fixtures while provisioning is incomplete. Run the worker separately as the long-lived service described below; the Vercel web build does not start it.

Official references checked for this fix: [Vercel build settings and Corepack](https://vercel.com/docs/builds/configure-a-build), [system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables), and [shared monorepo sources](https://vercel.com/docs/monorepos/monorepo-faq). Hosted installation, deployed HTTPS/Auth and runtime services still require verification on the owner's Vercel project.

### Local verification of the install fix — 2026-09-26

Checks use `./scripts/local` and the existing project-owned Supabase/Redis services. Local Node is 25.2.1; the owner's reported Vercel Node 24.21.0 environment has not been reproduced remotely. No hosted credentials, migrations, login or deployment were used.

| Command or check                                                                                                                                                     | Result                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Pinned pnpm `install --frozen-lockfile --offline --prod=false --registry=https://registry.npmjs.org/`, with only simulated Vercel markers and the local flag removed | Exit 0; all 19 workspaces, unchanged lockfile, zero downloads. Reused the existing public-npm cache; this is not a fresh cloud installation. |
| Pinned pnpm `run preinstall` in the same isolated simulated Vercel environment                                                                                       | Exit 0. Run explicitly because the cached install did not rerun its lifecycle.                                                               |
| `pnpm exec vitest run tests/tooling/install-policy.test.ts tests/tooling/isolation.test.ts`                                                                          | Exit 0; 21 tests across 2 files, including 15 install-policy cases.                                                                          |
| `pnpm lint`                                                                                                                                                          | Exit 0.                                                                                                                                      |
| `pnpm typecheck`                                                                                                                                                     | Exit 0; 33 tasks plus tooling TypeScript.                                                                                                    |
| `pnpm test`                                                                                                                                                          | Exit 0; 1,506 tests across 105 files.                                                                                                        |
| `pnpm build`                                                                                                                                                         | Exit 0; 18 tasks.                                                                                                                            |
| `pnpm build:web`                                                                                                                                                     | Exit 0; 16 workspace builds. Repeated successfully after stopping the leftover dev server, before browser verification.                      |
| `pnpm test:e2e apps/web/tests/e2e/shell.spec.ts apps/web/tests/e2e/accessibility.spec.ts`                                                                            | Final exit 0; 16 desktop/mobile tests, no skips, in 33.9 seconds.                                                                            |
| Generated Next output inspection                                                                                                                                     | Exit 0; repository tracing root, bundled shared deployment validation, 137 trace files and zero references to private repository state.      |

The first browser command exited 1 before running tests because a leftover repository Next dev process held port 3000. Its repository ownership was verified before stopping it and rebuilding. Two early artifact probes also exited 1: one incorrectly expected raw shared-package paths even though Next bundles that code, and the other compared a directory path without normalizing its trailing slash. Corrected checks verified the generated configuration and bundled code; no product guard was relaxed. Shell discovery also encountered two absent guessed paths and a sandbox denial for a narrowly scoped `ps`; the correct paths and approved inspection of the known repository process resolved those checks.

Final `pnpm format:check` and `pnpm secrets:check` both exited 0; hygiene checked 756 repository text files. Development web and worker were restored with `./scripts/local pnpm dev`; the homepage, web readiness and worker readiness each returned HTTP 200.

Full database integration and extension suites were not rerun for this install/build-only change; their previous release evidence remains historical. Hosted runtime, Node 24, real providers and remote CI remain unverified. No commit or push is part of this fix. Ignored execution logs are under `.threadsignal/vercel-fix-*.log`.

### pnpm build selection follow-up — 2026-09-26

The only executable configuration change is removal of the explicit Corepack build invocation and addition of the version diagnostic. Both `packageManager` pins, the lockfile, install command and strict checks remain unchanged. This addresses the owner's reported 12.2.1/12.4.1 mismatch; that remote mismatch was not independently reproduced.

Executed the literal `buildCommand` read from `apps/web/vercel.json` with `/bin/sh -c`, starting in `apps/web`, under `./scripts/local pnpm exec node`'s isolated mock environment. It printed **12.4.1** and exited **0** after all **16 web/dependency builds**. `./scripts/local pnpm lint`, `./scripts/local pnpm format:check`, and `./scripts/local pnpm exec vitest run tests/tooling/install-policy.test.ts tests/tooling/isolation.test.ts` also exited **0** (**21 tests across 2 files**). The local dev process was intentionally stopped for the build; subsequent process lookups returned no matching process. Discovery of two older CLI paths found no files; the actual package-local pnpm executable was used successfully.

`pnpm secrets:check` exited 0 across 756 repository text files. Development web and worker were restored, and the homepage plus both readiness endpoints returned HTTP 200.

No new dependency was installed, version enforcement bypassed or cloud setting changed. The full unit/integration/browser/extension suites and standalone typecheck were not rerun for this command-only follow-up; earlier counts above remain historical. Local build success does not prove Vercel's PATH or runtime. Push the changed configuration and redeploy; verify that the new build-command line and `12.4.1` appear before compilation. Ignored follow-up logs are `.threadsignal/vercel-pnpm-*.log`.

## Separate runtime configuration

For Google and magic-link setup, canonical app/callback URLs, email delivery and Vercel protection troubleshooting, see [hosted authentication](hosted-authentication.md).

Use `THREADSIGNAL_SUPABASE_MODE=deployment`, `THREADSIGNAL_DEPLOYMENT_APPROVED=true`, `NODE_ENV=production`, and `THREADSIGNAL_RUNTIME_ROLE=web` or `worker`. The worker additionally requires `THREADSIGNAL_WORKER_MODE=deployment`. Do not set `THREADSIGNAL_LOCAL`; it cannot be combined with this profile. Keep all five provider modes at their documented defaults until each real provider has separate approval.

Both processes need the same exact project reference, `https://<project-ref>.supabase.co`, HTTPS application origin and authenticated `rediss://` endpoint. Supply a trusted PostgreSQL CA PEM as `THREADSIGNAL_DATABASE_CA`; TLS always checks the certificate chain and hostname. `DATABASE_URL` must use the appropriate runtime username, port 5432, database `postgres`, and that project's direct host or session pooler. Pooler usernames include `.<project-ref>`. Administrator users and transaction-pooler port 6543 are rejected. Redis requires verified TLS and an explicit credential; no local Redis URL is accepted in deployment mode.

Web uses only the public Supabase publishable key and `EXTENSION_ALLOWED_ORIGINS=chrome-extension://<exact-32-character-id>`. It rejects Supabase Storage/service-role secrets. Worker alone receives a new `SUPABASE_SECRET_KEY` for private Storage; it never exposes this to the browser. The separate database credential is restricted by the reviewed runtime role, not by that Storage key.

After the operation's preflight and privilege review, an authorized administrator can enable LOGIN and configure a newly generated credential for each existing runtime role. Do not grant administrator membership or inherited bridge privileges. On every startup the application checks catalog identity, role flags, ownership, memberships, table/column access and helper execution. Unexpected authority stops startup.

Use `./scripts/local pnpm build` only for the isolated local demo. Hosted web builds use the pinned package manager and `pnpm build:web` with the separately approved hosting environment; Vercel settings are above. Supply required server configuration through the hosting environment store at build/runtime as needed by Next's validation, never build arguments, source control or browser settings. The following are process entry points, not deployment commands executed by this audit:

```bash
# Web: run with the validated web runtime environment, from apps/web.
node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 3000
# Worker: run with the validated worker runtime environment, from repository root.
node apps/worker/dist/index.js
```

The web validates its SQL role at startup; the worker validates before opening queues. Both readiness endpoints probe only their explicitly configured services. Expose worker readiness only to the hosting health checker. Run at least one worker; web readiness alone does not establish background processing health.

The updated Phase 2 knowledge worker also requires the reviewed additive operation `supabase/operations/phase2-worker-organization-guard.sql`, which matches local migration `20260923090000_knowledge_worker_organization_guard.sql`. It adds only the two worker-only eligibility/dispatch helpers; it does not grant organization table access, enable LOGIN or activate later phases. A new-role bootstrap includes this prerequisite. An existing hosted worker startup instead refuses missing helpers with `WORKER_ORGANIZATION_GUARD_REQUIRES_REVIEWED_ADDITIVE_OPERATION`; it never applies a cloud change automatically. Before restarting such a worker, obtain explicit authorization to apply that exact additive operation to the intended personal project, then verify its effective grants and startup checks. Do not replay the role bootstrap or grant broader table access as a workaround. This Phase 8 work did not execute the operation against hosted Supabase.

## Web, worker, database and Redis rollout

1. Obtain owner confirmation identifying the new personal Supabase project, hosting targets, registry and secret stores. Prepare reviewable account settings and migration plan before any external write.
2. Provision and verify the runtime prerequisites above. Target the declared Node 24 runtime and verify the pinned pnpm lockfile there. Build the web application with `pnpm build:web` using the hosting environment; serve it behind HTTPS with the exact `NEXT_PUBLIC_APP_URL`. Build the worker separately with its dependencies and validated worker environment. Trust only the chosen reverse proxy's host/origin behavior.
3. Review all migrations in order, take matching database and Storage backups, and test their restore into a separate authorized staging environment. Apply additive migrations using a dedicated migration identity. Generate types and compare schema/grants/RLS before switching traffic. Never run local seed/reset against a customer project.
4. Run the compiled Node worker as a long-lived supervised process, separate from web requests. Configure graceful SIGTERM, bounded concurrency and a private health endpoint. The existing local worker start command intentionally checks local ownership; it is not a hosted entry point.
5. Configure managed Redis with TLS, authentication, private access, persistence and `noeviction`; verify reconnect and stalled-job recovery. Preserve PostgreSQL outbox identities across worker restarts. BullMQ describes these operational requirements in its [production guide](https://docs.bullmq.io/guide/going-to-production).
6. Configure Supabase Auth site/redirect URLs precisely, private Storage buckets, MFA for administrators and database network restrictions appropriate to the selected host. Review the current [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).
7. Run every release gate, then stage limited traffic with all real social actions still manual. Verify TLS, cookie flags, nonce CSP, mobile/keyboard workflows, backup restore and externally delivered operational alerts before declaring launch readiness.

## Environment ownership

`.env.example` lists names without values. Public browser settings are the app URL, Supabase URL and public publishable/anon key only. Database credentials, Redis credentials, Supabase server Storage secrets, Stripe webhook/API secrets, AI and Resend keys belong in separate server/worker secret stores. Browser/extension bundles must contain none of them. Never paste secrets into chat, a command argument, logs or tracked files. Rotation must include revocation of the previous credential and a safe readiness check.

The web request database roles must not own tables or bypass RLS. The worker gets only the authority needed for its queues/Storage paths. The migration identity is neither the web nor worker identity. Keep provider-specific validation conditional; mocked providers never require real secrets.

## Authorized Stripe test and email verification

Once the runtime and migrations are approved, use a new personal Stripe test configuration. Configure active USD monthly Solo/Growth prices at $29/$79 and the portal's permitted plans; the adapter pins API version `2026-08-26.dahlia`. Configure `/api/billing/webhook` to receive the supported subscription/Checkout/invoice events with a newly provided signing secret. Do not activate a plan from a browser success URL. Verify checkout, payment failure/recovery, renewal, cancellation, duplicate and out-of-order signed events against Supabase usage limits. See [billing development](phase-7-development.md). No real card charge was verified here.

For Resend, configure a newly authorized personal sending domain and `EMAIL_FROM`, then test category opt-outs, quiet hours, duplicate retries and provider acceptance using only approved test recipients. Delivery acceptance does not prove inbox delivery. Never use customer addresses to test a newly enabled provider.

## Approved Reddit and AI

Reddit activation requires approved intended/commercial API access, truthful descriptive User-Agent, new personal app credentials, `REDDIT_COMMERCIAL_APPROVAL_CONFIRMED=true`, reviewed current platform terms and OAuth rather than scraping. Test rate-limit handling, authorization pause and twelve-hour refresh/forty-eight-hour deletion deadlines before ingestion. The extension still cannot submit. Missing approval means remain in mock mode.

AI activation needs configured fast/smart/embedding model identifiers, compatible 512-dimensional embeddings, provider data-processing review and bounded retries. Receipts cover search, suggestions, extraction, ingestion, evaluation and draft jobs. Unreported tokens or unknown cost estimates remain null and the admin screen labels incomplete totals; partially reported attempts cannot masquerade as a complete total. Never interpret an unknown cost as a free request. Embeddings carry their provider/model identity. A changed model or provider requires re-crawling sources: only matching vectors are retrieved, and unchanged text is re-embedded under the new identity. Old vectors cannot silently influence the new model. Test claim/provenance/disclosure and deletion after activation; provider success must never automatically approve or publish a draft.

Rollback first pauses affected ingestion/mutations and preserves deletion fences. Prefer a forward corrective migration; destructive reverse migrations need a separately reviewed recovery plan. Use [release checklist](release-checklist.md) and [backup/restore](backup-restore.md). HTTPS staging, live providers, remote CI, Node 24 and Chrome Web Store submission remain unverified external steps.

Optional `AI_MODEL_COSTS_JSON` supplies operator-reviewed estimates: a JSON object mapping each configured model identifier to `inputPerMillion` and `outputPerMillion` in USD. Values must be finite and nonnegative; model names, entry count and input size are bounded. It is server-only and required by neither mock nor real mode. Missing model rates or incomplete token receipts remain unknown, and displayed estimates are not a provider invoice. Recheck the chosen provider's actual pricing before supplying these values; no production model price is embedded in this repository.
