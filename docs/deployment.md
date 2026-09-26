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

## Separate runtime configuration

Use `THREADSIGNAL_SUPABASE_MODE=deployment`, `THREADSIGNAL_DEPLOYMENT_APPROVED=true`, `NODE_ENV=production`, and `THREADSIGNAL_RUNTIME_ROLE=web` or `worker`. The worker additionally requires `THREADSIGNAL_WORKER_MODE=deployment`. Do not set `THREADSIGNAL_LOCAL`; it cannot be combined with this profile. Keep all five provider modes at their documented defaults until each real provider has separate approval.

Both processes need the same exact project reference, `https://<project-ref>.supabase.co`, HTTPS application origin and authenticated `rediss://` endpoint. Supply a trusted PostgreSQL CA PEM as `THREADSIGNAL_DATABASE_CA`; TLS always checks the certificate chain and hostname. `DATABASE_URL` must use the appropriate runtime username, port 5432, database `postgres`, and that project's direct host or session pooler. Pooler usernames include `.<project-ref>`. Administrator users and transaction-pooler port 6543 are rejected. Redis requires verified TLS and an explicit credential; no local Redis URL is accepted in deployment mode.

Web uses only the public Supabase publishable key and `EXTENSION_ALLOWED_ORIGINS=chrome-extension://<exact-32-character-id>`. It rejects Supabase Storage/service-role secrets. Worker alone receives a new `SUPABASE_SECRET_KEY` for private Storage; it never exposes this to the browser. The separate database credential is restricted by the reviewed runtime role, not by that Storage key.

After the operation's preflight and privilege review, an authorized administrator can enable LOGIN and configure a newly generated credential for each existing runtime role. Do not grant administrator membership or inherited bridge privileges. On every startup the application checks catalog identity, role flags, ownership, memberships, table/column access and helper execution. Unexpected authority stops startup.

Build in an isolated approved environment with the pinned lockfile and `./scripts/local pnpm build`. Runtime secrets are injected by the separately authorized hosting secret store, never build arguments, source control or browser settings. The following are process entry points, not deployment commands executed by this audit:

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
2. Provision and verify the runtime prerequisites above. Target the declared Node 24 runtime and verify the pinned pnpm lockfile there. Build with the root `build` script; serve the Next application behind HTTPS with the exact `NEXT_PUBLIC_APP_URL`. Trust only the chosen reverse proxy's host/origin behavior.
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
