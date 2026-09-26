# ThreadSignal Implementation Status

## Current state

- Active follow-up: hosted Google and magic-link troubleshooting after owner deployment of `cf54df3`. Anonymous requests reach Vercel SSO protection; public Auth settings of the previously supplied personal Supabase project show Google disabled and email enabled. The Google form/CSP defect is fixed in the working tree and callback configuration failures redirect within the current site. Local gates passed: 1,521 unit tests, 22 desktop/mobile browser tests including real local magic links and intercepted Google navigation, lint/format, 33 typecheck tasks plus tooling and 18 build tasks. Hosted provider/origin/runtime/SMTP acceptance remains open. See [setup](docs/hosted-authentication.md) and [verification](docs/hosted-auth-verification.md).

- Current step: 15 prerequisite — Vercel installation/build compatibility. The owner reports pushing `95f78b0` and starting a Vercel deployment; its local-only preinstall guard rejected the hosted install. A separate Vercel install policy, web-only build and monorepo configuration are implemented and locally verified: simulated hosted preinstall, lint, typecheck, 1,506 unit tests, both builds and 16 targeted browser tests passed. Hosted runtime, rendering diagnostics and external acceptance remain open. Supabase remains the backend. See [Vercel setup and verification](docs/deployment.md#vercel-web-build-settings), [release record](docs/step-14-release.md) and [Step 13 findings](docs/step-13-review.md).
- Last verified phase: Phase 8 plus Step 12 audit and Step 13 review local gates. Step 12 verified disposable reset/seed; Step 13 applied an additive migration without resetting existing data. The historical Phase 0 isolation exception remains open for owner review.
- Active branch: main; current committed configuration `cf54df3` (`vercel fix`), after the owner pushed the pnpm command correction and reported a Vercel deployment. Authentication fixes remain uncommitted. No cloud login, configuration change, migration, deployment, commit or push was performed by this follow-up.
- Local providers: Reddit `mock`, AI `mock`, email `console`, billing `mock`, crawler `fixture`.
- Last updated: 2026-09-26.
- Current review evidence: [Step 13 verification and failure ledger](docs/step-13-review.md), [specification matrix](SPEC_COMPLIANCE_MATRIX.md). The [Step 12 audit ledger](docs/audit-verification.md) and [delivery guide](docs/final-delivery.md) describe the earlier audit; phase counts below are historical.
- Review evidence: [Phase 8 verification](docs/phase-8-verification.md), [Phase 8 file map](docs/phase-8-files.md), [Phase 8 development](docs/phase-8-development.md), [Phase 7 verification](docs/phase-7-verification.md), [changed files](docs/phase-7-files.md), [billing guide](docs/phase-7-development.md), the preserved [Phase 6 verification](docs/phase-6-verification.md), and [Phase 0 isolation record](docs/phase-0-verification.md).
- Local app address: `http://127.0.0.1:3000`; development web and worker are running again. After the hosted-auth code fix, restoration checks returned HTTP 200 for the homepage, web readiness and worker readiness. The personal hosted project's settings and data were not changed.
- Hosted follow-up (previously verified; not rechecked in Phase 8): the owner reported successful sign-in. The Phase 2 database migration was committed to PostgreSQL, with an independent read-back matching the verified local schema and permissions. Phase 1 schema remained unchanged and hosted Auth returned HTTP 200. Hosted worker processing and the hosted Phase 2 application gate remain disabled. See [hosted migration evidence](docs/phase-2-hosted-migration.md).

## Phase status

Step 14 aligns all 20 package/extension manifests to `0.1.0` and adds the changelog/release record. Fresh release checks pass: **1,491 unit tests**, 33 typecheck tasks plus tooling, 18 build tasks, lint/format, extension build and **one MV3 test with zero submit attempts**. Step 13's 268 integration and 38 browser passes remain evidence for unchanged runtime code/schema; they are not claimed as rerun by this metadata/tooling step. No release tag or hosted activation is included.

Step 13 passes **1,490 unit tests**, **268 integration tests**, **38 browser tests with two intentional duplicate mobile skips**, **one MV3 test with zero submit attempts**, lint/format, 33 typecheck tasks plus tooling, 18 build tasks, extension build, local database lint and source hygiene. Development web and worker are restored; all three HTTP checks returned 200. The additive draft-attempt accounting migration was applied without resetting existing data. Earlier port-conflict/typecheck/build failures were resolved and are recorded in the review ledger. Two non-failing render-stream diagnostics remain open; no hosted or production acceptance is claimed.

Historical Step 12 audit gates passed on its disposable source snapshot: **1,468 unit tests**, **266 integration tests**, **38 browser tests with two intentional duplicate mobile skips**, **one MV3 test**, lint/format, 33 typecheck tasks plus tooling, 18 build tasks, extension build, source hygiene, fresh reset/seed/database lint and all three development HTTP 200 checks. The final clean-room command exited 0 and restored the original services without resetting their data. Six additive local migrations cover workflow excerpts/status, actual AI receipts/unknown metrics, embedding identity, invitation retention and general task accounting. Failed setup/browser attempts and the two non-failing render-stream diagnostics are recorded in the audit verification report. This establishes local review evidence, not hosted or production acceptance.

| Phase | Scope                                | Status                                | Acceptance verified                                                    | Commit |
| ----- | ------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------- | ------ |
| 0     | Repository foundation                | Implemented; isolation review pending | Functional gates passed; exception open                                | —      |
| 1     | Auth, organization, billing skeleton | Implemented; ready for local review   | Local acceptance passed; external OAuth unverified                     | —      |
| 2     | Brand and knowledge base             | Implemented; ready for local review   | Local acceptance passed; hosted processing disabled                    | —      |
| 3     | Subreddit and opportunity pipeline   | Implemented; ready for local review   | Local acceptance passed; hosted Phase 3 disabled                       | —      |
| 4     | AI drafting and verification         | Implemented; ready for local review   | Local acceptance passed; hosted Phase 4 disabled                       | —      |
| 5     | Chrome extension product features    | Implemented; ready for local review   | Local fixture acceptance passed; live Reddit unverified                | —      |
| 6     | Attribution and analytics            | Implemented; ready for local review   | Local acceptance passed; hosted Phase 6 disabled                       | —      |
| 7     | Real billing and notifications       | Implemented; ready for local review   | Local acceptance passed; live Stripe/Resend unverified                 | —      |
| 8     | Hardening and launch readiness       | Implemented; ready for local review   | Local gates and fresh-stack rehearsal passed; hosted launch unverified | —      |

## Phase 0 acceptance checklist

- [x] Preserve pnpm workspace and existing Next.js app; Turborepo builds 14 packages/apps.
- [x] Shared strict TypeScript, ESLint, Prettier, and all requested root scripts.
- [x] Accessible ThreadSignal landing/security pages, local shell, and fail-closed route scaffolding.
- [x] Node worker shell with real BullMQ heartbeat and readiness checks.
- [x] Manifest V3 side-panel shell with no posting capability or Reddit permissions.
- [x] Shared UI, database, config, provider, logging/tracing, analytics/tracking foundations.
- [x] Zod environment validation; real-provider secrets conditional on selected provider.
- [x] Deterministic mocks work without paid or production credentials in unit tests.
- [x] Supabase configuration, pgvector migration, private bucket, seed, and generated public types.
- [x] Redis configuration with Colima-only guarded container commands.
- [x] Unit, integration, Playwright, and extension browser test foundations.
- [x] GitHub Actions static and Colima service jobs configured; remote execution not verified.
- [x] Names-only `.env.example` files, local documentation, and architecture decisions.
- [x] Frozen public-npm installation passes for all 15 workspace projects.
- [x] Final service start, exact Colima context/socket, runtime loopback-forwarding logs, and service health passed. Independent OS listener enumeration remained inconclusive.
- [x] Integration: 4/4 tests. Development web and both readiness endpoints returned HTTP 200.
- [x] Lint, formatting, typecheck, 130 unit tests, 14 build tasks, extension build/browser smoke, 10 E2E tests, hygiene, and final service shutdown passed.
- [ ] Unqualified isolation compliance: an earlier Lima forwarding attempt reported external `/tmp` paths; see verification record. No outside inspection/cleanup performed.
- [x] At Phase 0 verification, Phase 1 workflows and schema were absent; no commit or push. Phase 1 began after the owner's next-phase request on 2026-09-15.

## Phase 1 acceptance checklist

- [x] Email magic-link login, server-verified sessions, refresh, protected routes, and logout work locally. Google OAuth code is guarded and unit-tested; external OAuth remains unverified.
- [x] Organization onboarding atomically creates verified ownership, a seven-day trial, subscription, and audit event.
- [x] Owner/admin/member/viewer roles work through SQL, application APIs, and rendered controls.
- [x] Two organizations cannot access one another; RLS, user-scoped APIs, and forged-cookie checks pass.
- [x] Invitations bind the verified email, store only token hashes, reserve seats, expire, and reject replay; acceptance and cleanup pass in the real local browser flow.
- [x] Central TypeScript plans mirror the database catalog; trial expiry, downgrade, last-owner, and concurrency checks pass.
- [x] Organization, team, plan/usage, integration settings, and audited data requests use actual local records.
- [x] Distinctive responsive ThreadSignal UI reviewed on desktop/mobile; no fabricated customer metrics or later-phase flows.
- [x] Frozen install, lint, formatting, TypeScript, 194 unit tests, 21 integration tests, 14 build tasks, and extension build pass.
- [x] Full browser suite: 15 passed, 1 intentional duplicate skip. Separate service-off smoke: 10 passed.
- [x] Exact Colima context/socket and service health verified; stop/restart passed; dev homepage and web/worker readiness returned HTTP 200.
- [x] Mock/console/fixture providers retained; no tracked env/dependencies or supported secret patterns found across 254 text files.
- [x] At Phase 1 completion, no Phase 2 business schema/features, commit, or push. Web/worker and project services were left running locally.

## Phase 2 acceptance checklist

- [x] Brand create/view/edit/select/archive/restore with complete product, competitor, vocabulary, real-role and disclosure fields.
- [x] Owner/admin mutations, tenant RLS, composite identity constraints, and concurrent plan/page/source limits.
- [x] Six approved synthetic website pages processed into actual local documents and vectors.
- [x] Private PDF, Markdown, plain-text uploads and manual notes; original download bytes verified in desktop/mobile browsers.
- [x] File and URL validation; encrypted/unreadable PDF errors; bounded parser, normalized chunks, overlap and metadata.
- [x] Deterministic 512-dimensional mock search with source citations and included/excluded document controls.
- [x] Durable outbox/BullMQ processing, leases, three attempts, generation fencing, unchanged chunk reuse and retryable deletion cleanup.
- [x] Responsive brand/source/search screens reviewed; loading, validation, permission, empty, pending, success and failure states covered.
- [x] Hosted Phase 2 loaders/APIs fail closed before database access; existing hosted profile builds and public/login routes return HTTP 200.
- [x] Frozen install, lint, format check, 23 typecheck tasks, 322 unit/component tests, 42 integration tests and 15 build tasks passed.
- [x] Full E2E: 17 passed, one intentional duplicate mobile-role skip. Final-build Phase 2 rerun: both desktop/mobile journeys passed.
- [x] Colima service health, local web/worker HTTP 200 readiness, and dev startup verified; local and hosted development views left running.
- [x] Hygiene: 323 text files checked; no tracked env/dependencies, supported secret patterns or operational employer references. Instruction prohibitions excluded.
- [x] Local migration applied without resetting existing data; types/seed/docs/decisions updated. No Phase 3 at Phase 2 completion; no commit or push.

## Phase 3 acceptance checklist

- [x] Shared read-only Reddit provider contracts, 26 deterministic invented posts, and a transport-tested OAuth adapter gated by explicit approval and credentials; runtime stays mock.
- [x] Community discovery/suggestions, manual monitoring, priority/minimum score, pause/removal, new/hot/rising sorts, rules, interpretations, and refresh status.
- [x] Typed keywords, exclusions, suggestions and match preview; competitor aliases/misspellings and notes retain their identities through brand edits.
- [x] Scheduled BullMQ ingestion/evaluation with SQL outbox, checkpoints, renewable leases, three attempts, persisted rate-limit deadlines, authorization pause and stale-input fencing.
- [x] Automatic high, medium, low, blocked and competitor examples; exact six-component weighted scores, penalties, hard blocks, model/checksum evidence and verified citations.
- [x] Tenant isolation, owner/admin configuration, member review, viewer read-only access, atomic community/opportunity limits and period rollover.
- [x] Replay and rescoring preserve usage and human review state; brand-scoped aggregate dismissal feedback adds explained penalties without training on Reddit text.
- [x] Configurable age/retention, twelve-hour refresh scheduling, conservative forty-eight-hour expiry and irreversible content tombstones remove derived content too.
- [x] Responsive card/table feed, full filters, stable cursor pagination across tied scores, detail/context screens and save/monitor/dismiss/bulk/archive/rescore actions.
- [x] Desktop/mobile browser journeys render all four labels, explain scores, follow citations, preserve review actions and refuse blocked saves. Full browser suite: 20 passed, two intentional duplicate skips.
- [x] Frozen install, lint, format check, 26 typecheck tasks plus tooling, 478 unit/component tests, 83 integration tests, final schema lint and 16 build tasks pass.
- [x] Hygiene checks pass across 397 repository text files; root/app dependency directories, dotenv files and generated personal profiles remain ignored.
- [x] Dev startup, local web/worker HTTP 200 readiness (including opportunities), and existing hosted homepage/login HTTP 200 verified; hosted Phase 3 API correctly returns 503 LOCAL_ONLY. Local web/worker and Colima services remain running for review.
- [x] Local migration applied without reset; generated types, seed, tests, documentation and ADRs updated together. Original Phase 0–2 migrations and hosted baseline remain preserved.
- [x] At Phase 3 completion, hosted processing remained disabled; no Phase 4 drafting, extension posting, deployment, commit or push had occurred.

## Phase 4 acceptance checklist

- [x] High-intent demo opportunities generate source-backed replies with truthful affiliation on desktop and mobile.
- [x] Independent claim verification and twelve compliance checks highlight unsupported/contradicted text and block approval in the server and SQL.
- [x] Tenant-scoped retrieval uses current included evidence, vector/keyword ranking, eight chunks, configurable bounded context and a source-ID-only cache.
- [x] Three durable worker stages have renewable leases, retries, idempotency, version/context fencing and safe failure codes.
- [x] Responsive draft library/editor, citations, autosave, comparison/restore, regeneration controls, persona, approval/rejection, feedback and approved copy use real local records.
- [x] Edits and context changes require fresh verification. Warnings need acknowledgement; first approval requires responsible-use acceptance.
- [x] Atomic quotas, accurate mock usage, RLS, member/viewer permissions, stale post refusal and concurrent deletion/publication protections pass integration tests.
- [x] Shared real AI adapter has bounded structured responses/embeddings, task prompts, retries, rate limits, circuit handling and usage hooks; injected-transport tests pass, runtime stays mock.
- [x] Install, lint, 28 typecheck tasks plus tooling, 584 unit/UI tests, 122 integration tests, 17 build tasks, extension build and database lint pass.
- [x] Final E2E: 24 passed and two intentional duplicate mobile skips. Prior failures/interruption and non-failing runtime messages remain documented.
- [x] Dev startup, homepage and web/worker HTTP 200 readiness including drafts, exact Colima context/socket, Redis and Supabase health verified.
- [x] Formatting and Git whitespace checks pass; 451 repository text files pass hygiene scanning, with dotenv and dependency directories ignored.
- [x] Local migration, types, seed, tests, documentation and ADRs updated together; no hosted Phase 4, Phase 5, commit or push.

## Phase 5 acceptance checklist

- [x] One-use five-minute codes and thirty-day revocable tokens store hashes only and recheck user, organization, role, plan and extension origin.
- [x] Settings supports connect, safe session metadata, single/all revocation and bounded inactive history while retaining all active connections.
- [x] MV3 side panel identifies the current opportunity, score, risk, rules, approved draft and source evidence on explicit lookup.
- [x] Panel editing requires saving, worker verification and fresh human approval before handoff.
- [x] Explicit copy and textarea/contenteditable insertion recheck the current approved version and selected tab; unsupported, ambiguous and nonempty editors fail safely.
- [x] Real MV3 browser journey passed; submit-attempt counter stayed zero. Manual publication requires a matching comment URL and explicit confirmation; it is a declaration, not a verified Reddit event.
- [x] Web revocation and panel disconnect were browser-tested, including clearing stored extension credentials.
- [x] Minimal permissions, trusted storage/senders, fixed local API, strict host handling, rate limits, restricted SQL role and bounded cleanup are implemented.
- [x] Three additive local migrations, generated types, fixtures, tests, CI configuration, installation guide and decisions are updated. Hosted processing remains unchanged.
- [x] Lint, formatting, 30 typecheck tasks plus tooling, 731 unit tests, 143 integration tests, 18 build tasks, extension build and schema lint pass. Web E2E: 24 passed/two intentional duplicate mobile skips. Final MV3 E2E: 1/1 passed in 47.4 seconds.
- [x] Dev homepage and web/worker readiness return HTTP 200; exact Colima context/socket, Redis and Supabase are healthy. Hygiene checks pass across 502 text files. Local web/worker remain running for review.
- [x] Live Reddit/native Chrome side-panel compatibility, hosted processing and remote CI are explicitly unverified. No Phase 6, deployment, commit or push.

## Phase 6 acceptance checklist

- [x] Supabase remains Auth/Postgres/private-storage backend; all new schema is additive and tenant-scoped.
- [x] Approved-draft links, exact allowlists, UTM preservation, preview filtering and privacy-minimized click receipts.
- [x] Consent-controlled browser snippet and brand-scoped hashed/revocable server keys.
- [x] Five event types, currency precision, configurable attribution window and conflicting-idempotency rejection.
- [x] Overview, analytics, filters/drilldowns and paginated tracking controls; no fabricated customer metrics.
- [x] Supabase aggregation cache, invalidation and real bounded BullMQ processing verified in focused integration tests.
- [x] Generated types, seed settings, architecture decisions and development documentation updated.
- [x] Full final integration/browser/MV3 regression and redirect timing verified: 888 unit, 172 integration, 26 web E2E passes with two intentional duplicate skips, and one real MV3 pass.
- [x] Final formatting, hygiene and development health evidence recorded; web/worker run with Supabase and Redis ready.
- [x] Phase 6 ready for local review; hosted activation remains unverified. Phase 7 began after this acceptance.

## Quality evidence

Phase 3 navigation follow-up: hosted-to-local buttons now identify the workspace switch and open the matching tab; local sign-in explains the separate account and Mailpit inbox. Anonymous probes confirmed all five feature destinations redirect to login with their path preserved. Lint, 26 typecheck tasks plus tooling, 483 unit/component tests, 16 build tasks, and 16 focused desktop/mobile authentication/navigation/browser tests pass. Each browser verified all ten tabs after one local sign-in. No authentication rules, database schema, hosted worker permissions, or phase boundary changed. See the follow-up in the Phase 3 verification record.

See the current [command results and failure ledger](docs/phase-8-verification.md), [Phase 7 record](docs/phase-7-verification.md), [Phase 6 record](docs/phase-6-verification.md), [Phase 5 record](docs/phase-5-verification.md), [Phase 4 record](docs/phase-4-verification.md), [Phase 3 record](docs/phase-3-verification.md), [Phase 2 record](docs/phase-2-verification.md), [Phase 1 record](docs/phase-1-verification.md), and historical [Phase 0 record](docs/phase-0-verification.md) for exact commands, results and limits. Phase 7 local acceptance does not resolve the historical isolation exception or establish hosted processing readiness.

## Phase 7 acceptance checklist

Phase 7 adds Supabase-backed mock subscription lifecycles, owner-only billing controls, usage meters, signed Stripe webhook processing and notification preferences/delivery jobs. Six additive migrations are applied locally. Unit/contract tests (1,026), integration tests (199), typecheck, lint and build pass. The final browser suite passed 28 tests with two intentional duplicate skips; desktop/mobile Journey D and visual review passed. Development startup, Colima service health, homepage and web/worker readiness passed. Web and worker remain running for review. Details and the failure ledger are in [Phase 7 verification](docs/phase-7-verification.md).

- [x] Owner-only checkout/portal, safe member summaries and restricted mock entitlement mutations.
- [x] Server-side quotas preserve consumed units across upgrades and retain data on downgrades.
- [x] Trial expiry, cancellation/resume, anchored renewal and three-day payment grace.
- [x] Stripe signatures, exact session binding, late payment, duplicate/stale event and tenant-boundary coverage.
- [x] Personal categories, organization timezone, score threshold, quiet hours and current digest scheduling.
- [x] Durable, deduplicated outbox with leases, three attempts, context fingerprints and a 23-hour retry boundary.
- [x] Local console delivery remains suppressed; no real-provider credentials are required.
- [x] Journey D proves quota refusal, upgrade, additional draft and persisted preferences on desktop/mobile.
- [x] Final full browser suite and running-development smoke checks.
- [ ] Live Stripe/Resend and hosted activation: intentionally not performed; separate authorized verification remains necessary.

## Phase 8 acceptance checklist

Supabase remains the Auth/PostgreSQL/private-storage backend. Ten additive local migrations preserve existing records. Full local regression and runtime checks pass; no hosted launch or overall MVP-complete claim is made.

- [x] Independent platform-admin authority; safe customer/job/usage summaries, audited reads/changes and tenant activity.
- [x] Lifecycle-aware, idempotent bounded retries; pause/resume and organization-first worker fences.
- [x] Current-owner private exports include allowed application records and original files, with bounds, integrity checks, 24-hour expiry and revocation.
- [x] Fresh exact-slug deletion confirmation, immediate access revocation, retry-safe Storage-first cleanup and preservation of other organizations/Auth users.
- [x] Retention sweeps and Reddit-deletion invalidation remove stale exports/derived content; active leases prevent orphan cleanup races.
- [x] Restricted knowledge worker uses two narrowly granted helpers; organization-table access remains denied. Existing hosted workers fail closed until a separately authorized additive guard prerequisite is applied.
- [x] Nonce CSP, safe origin/session boundaries, request budgets, strict validation, dependency audit and secret-safe correlation/telemetry.
- [x] Accessibility, responsive layouts and honest public capability content; focused desktop/mobile browser review passes.
- [x] API/route map, deployment, extension packaging, security, privacy, operations, backup, incident and release documentation.
- [x] Lint, 33 typecheck tasks/tooling, 1,132 unit tests, 245 integration tests, 18 build tasks, extension build and final database lint pass.
- [x] Public-npm audits show zero advisories; hygiene checks pass across 678 repository text files.
- [x] Full browser: 36 passed, two documented duplicate mobile skips (7.8 minutes); real MV3: 1/1 passed (37.0 seconds), zero submit attempts. Formatting and running web/worker readiness pass.
- [x] Final audit completed a disposable database reset/seed and full rehearsal, then restored the original services with retained volumes. This is not a backup-archive restoration test.
- [ ] Hosted activation, external providers, monitoring delivery, Node 24/remote CI, deployed performance and live Reddit/Chrome compatibility remain unverified. The subsequent audit implements the crawler/runtime prerequisite code; approved provisioning and external acceptance remain necessary.

## Final specification audit (Step 12)

- [x] Guided Supabase-derived setup, explicit source-backed product review, useful toolbar controls and workflow-aware opportunity excerpts.
- [x] Guarded company crawler, opt-in web/worker deployment profiles, checked restricted roles/TLS and separate HTTPS extension packaging.
- [x] Tenant-scoped JSON reads, safe standard API errors, all-task AI receipts, optional model prices, embedding identity and bounded invitation retention.
- [x] Final fresh-environment gates, desktop/mobile demo journeys and zero-submit MV3 workflow passed; source hashes tie results to the reviewed code.
- [x] 248-row compliance matrix, delivery/setup/deployment guides, file map, meaningful ADRs and complete failure ledger.
- [ ] Live providers, hosted deployment/CI, Node 24, live Reddit DOM, production performance and human acceptance remain separate. The historical isolation exception and render-stream diagnostic remain open review items.

## Provider coverage

| Integration | Contract and local provider                                                | Mock tested | Live tested |
| ----------- | -------------------------------------------------------------------------- | ----------- | ----------- |
| Reddit      | Synthetic fixtures and injected-transport OAuth tests                      | Yes         | No          |
| AI          | Deterministic drafts/checks; injected real-adapter tests                   | Yes         | No          |
| Billing     | Supabase mock lifecycle; injected Stripe Checkout/Portal/webhook contracts | Yes         | No          |
| Email       | Console outbox delivery; injected Resend and branded templates             | Yes         | No          |
| Crawler     | Synthetic fixtures plus guarded real adapter with injected network tests   | Yes         | No          |

Live product-provider activation remains unverified and disabled. Reddit OAuth, real AI, Stripe and Resend adapters use injected HTTP tests; no real Reddit, paid AI, payment or external email calls occurred. The guarded simple crawler and explicit deployment runtime are now implemented and tested with injected transports/configuration; external deployment remains unverified. Supabase Auth is locally verified; Google OAuth is guarded but not live-tested externally. The owner supplied personal Supabase configuration and authorized the provided DATABASE_URL for the earlier hosted Phase 2 migration. Only scoped migration/provisioning helpers may read those credentials; ordinary local launchers and web/worker processes receive no hosted administrator database credential. This audit did not inspect that private configuration or use a dashboard session.

## Remaining review items

- Two Next.js render-stream-close diagnostics occurred during the passing final operations journeys. The triggering request is not identified; no authorization/data-loss failure was demonstrated.

- Preserve the observed Lima external temporary-path exception in the final report. Separate approval is required before any outside-repository inspection or cleanup.
- GitHub Actions has not run remotely. Its service job requires a separately provisioned personal Colima runner; no such external setup was performed.
- Local checks use installed Node 25.2.1; the declared Node 24 CI target has not been live-tested here.
- Google/live product providers, remote CI, deployed HTTPS, and Node 24 have not been live-tested. Hosted Phase 2 schema is verified; hosted ingestion and authenticated browser journeys remain unverified and disabled pending dedicated worker setup.

Phase 5 local acceptance proves fixture composer behavior, not current live Reddit editor compatibility or native Chrome side-panel presentation. Hosted Phases 3–8 remain disabled. Session cleanup is eventual; expiration blocks use immediately. Publication records are explicit human declarations rather than independently verified Reddit events.
