# ThreadSignal: Exact Astra Build Prompts

Use these prompts in order. Do not paste all implementation prompts at once. Give Astra one phase, review it, fix it, and only then move to the next phase.

Required project-root files:

- `threadsignal_master_build_spec.md`
- `AGENTS.md`
- `IMPLEMENTATION_STATUS.md`
- `DECISIONS.md`

Keep the work in the same Codex/Astra project and chat when practical. Use mock providers until real credentials are deliberately supplied through environment variables.

---

# Step 0 - Open the repository

Create or open an empty Git repository named `threadsignal`. Put the four files above in its root. Start Codex/Astra from that repository directory.

Optional local commands:

```bash
mkdir threadsignal
cd threadsignal
git init
```

Do not put real credentials in the repository.

---

# Step 1 - Project intake and implementation plan

Paste this first:

```text
Act as the lead product engineer for this repository.

Read these files completely before making implementation decisions:
- AGENTS.md
- threadsignal_master_build_spec.md
- IMPLEMENTATION_STATUS.md
- DECISIONS.md

For this step, do not build product features yet. Inspect the repository and prepare it for controlled phase-by-phase implementation.

Tasks:
1. Confirm the product purpose, end-to-end customer flow, non-negotiable guardrails, required stack, phases 0-8, and final definition of done.
2. Inspect the local environment and report the installed versions of Node.js, pnpm, Git, Docker/OrbStack compatibility, and Supabase CLI when available.
3. Identify setup problems that would block Phase 0. Fix safe repository-local problems yourself; report only machine-level problems that genuinely require me.
4. Create or improve:
   - IMPLEMENTATION_STATUS.md
   - DECISIONS.md
   - docs/build-plan.md
   - docs/credential-matrix.md
   - docs/risk-register.md
5. In docs/build-plan.md, map every master-spec section to the phase that will implement it. Make sure the public marketing pages, application routes, worker, extension, tests, security, and deployment documentation all have an owner phase.
6. In docs/credential-matrix.md, separate:
   - credentials not needed in mock mode
   - credentials needed for staging
   - credentials needed only for production
7. Keep the following defaults for local development:
   REDDIT_PROVIDER=mock
   AI_PROVIDER=mock
   EMAIL_PROVIDER=console
   BILLING_PROVIDER=mock
8. Do not introduce a Reddit scraper or request production secrets.
9. Do not start Phase 0 until the planning documents are internally consistent.

Return:
- repository/environment findings
- the phase map
- blockers, if any
- the exact next prompt I should send for Phase 0

Do not claim any implementation phase is complete in this step.
```

Review the output. Resolve only genuine machine-level blockers such as a missing Node.js or pnpm installation.

---

# Step 2 - Phase 0: repository foundation

Paste this after Step 1 is complete:

```text
Implement Phase 0: repository foundation from threadsignal_master_build_spec.md.

First read AGENTS.md, the full master specification, IMPLEMENTATION_STATUS.md, DECISIONS.md, and docs/build-plan.md. Inspect the existing repository before editing.

Scope for this phase:
- pnpm workspace and Turborepo monorepo
- apps/web using Next.js App Router, React, strict TypeScript, Tailwind CSS, and shadcn/ui foundations
- apps/worker Node.js service foundation
- apps/extension Manifest V3 foundation without posting automation
- shared packages required by the specification
- Supabase local configuration, SQL migration foundation, pgvector enablement, and seed structure
- local Redis configuration through Docker Compose or a clearly documented equivalent
- root scripts for install, services:start, db:reset, seed, dev, lint, typecheck, test, build, and extension:build
- runtime environment validation with Zod
- .env.example containing names and safe mock defaults only
- Pino logging foundation and optional error/tracing hooks
- CI workflow for install, lint, typecheck, tests, and build
- accessible basic marketing/app shells and route protection scaffolding
- README local setup instructions

Required architecture:
- pnpm monorepo with Turborepo
- Next.js App Router
- Supabase/PostgreSQL with SQL migrations; no Prisma
- BullMQ and Redis for workers
- Vitest, Testing Library, and Playwright foundations
- provider interfaces must be possible without coupling infrastructure to UI

Constraints:
- Do not implement future-phase business features.
- Do not add real secrets.
- Default all external providers to mock/console modes.
- Do not leave the repository dependent on paid services for local startup.
- Do not replace required services with static screenshots.
- Document every material deviation in DECISIONS.md.

Verification:
1. Run pnpm install.
2. Run pnpm services:start.
3. Run pnpm db:reset and pnpm seed.
4. Start the development processes and verify the web app and worker can boot.
5. Run pnpm lint.
6. Run pnpm typecheck.
7. Run pnpm test.
8. Run pnpm build.
9. Run pnpm extension:build.
10. Add a minimal smoke test proving the web app shell renders and environment validation works.

Update IMPLEMENTATION_STATUS.md with actual evidence. Phase 0 is complete only when the Phase 0 acceptance criteria in the master specification pass.

Stop after Phase 0. Return the required AGENTS.md reporting format. Do not start Phase 1 and do not commit or push.
```

Then use the review loop later in this file before committing.

---

# Step 3 - Phase 1: authentication, organizations, and billing skeleton

```text
Implement Phase 1: authentication, organization, roles, tenant isolation, and billing skeleton.

Before editing, read AGENTS.md, threadsignal_master_build_spec.md, IMPLEMENTATION_STATUS.md, DECISIONS.md, and the Phase 0 code. Verify Phase 0 remains healthy.

Implement all relevant requirements from the users/permissions, authentication/organizations, database, RLS, routes, API, billing-skeleton, security, and testing sections of the master specification.

Required outcomes:
- Supabase authentication flows required by the specification
- protected application routes and session handling
- first-login organization onboarding
- organization creation and membership records
- owner, member, and viewer roles with server-side authorization
- invitation model/UI/API where specified
- PostgreSQL migrations and generated TypeScript database types
- complete RLS policies for organization-scoped Phase 1 tables
- a central typed plan configuration
- automatic trial subscription/entitlement record in mock billing mode
- organization, team, integration, and billing settings shells
- audit entries for important organization actions
- clear loading, validation, permission-denied, empty, and error states
- seed/demo users and organizations suitable for automated tests

Security requirements:
- UI hiding is not authorization.
- Every protected server action/API must verify authentication, organization membership, and role.
- Service-role credentials must remain server-only.
- Cross-organization IDs supplied by a client must not bypass RLS or server checks.
- Never log tokens, passwords, magic-link values, or secret environment variables.

Acceptance tests:
1. A new user can authenticate and complete organization onboarding.
2. Owner/member/viewer behavior matches the specification.
3. Two organizations cannot read or mutate each other's data through UI, API, direct database client usage, or guessed IDs.
4. A trial record and plan limits are created from central configuration.
5. Relevant integration and E2E tests cover successful and forbidden cases.

Run database reset/seed and all quality gates:
- pnpm lint
- pnpm typecheck
- pnpm test
- relevant integration tests
- relevant Playwright tests
- pnpm build

Update IMPLEMENTATION_STATUS.md and DECISIONS.md. Stop after Phase 1. Do not begin Phase 2 and do not commit or push.
```

---

# Step 4 - Phase 2: brand onboarding and knowledge base

```text
Implement Phase 2: brand onboarding and the complete knowledge-base pipeline.

Read AGENTS.md, the full master specification, IMPLEMENTATION_STATUS.md, DECISIONS.md, and the existing implementation before changing code. Verify Phases 0 and 1 still pass.

Implement all relevant requirements from brand onboarding, knowledge base, competitors/keywords/exclusions, AI provider abstractions, database, API, jobs, security, demo data, and testing sections.

Required outcomes:
- create, edit, view, archive, and select a brand within an organization
- brand fields, audience, tone, real responder role, disclosure settings, competitors, keywords, and exclusions exactly as specified
- website-source onboarding with an approved-page selection flow
- crawler provider interface
- deterministic fixture/simple crawler for local demo mode
- secure real-crawler adapter boundary, even if credentials are absent
- PDF, Markdown, text, and manual knowledge-entry ingestion
- private file storage and safe file validation
- extraction, normalization, chunking, metadata, indexing, and status/error handling
- pgvector schema and searchable knowledge chunks
- deterministic mock embeddings and configurable real embedding provider
- knowledge-source list/detail/status/delete/retry UI
- semantic knowledge search/debug UI as specified
- background jobs for crawl, extraction, chunking, embedding, retry, and cleanup
- useful audit and structured logs

Security requirements:
- prevent SSRF: reject localhost, loopback, link-local, private network ranges, unsafe schemes, and redirect chains into blocked targets
- enforce content type and size limits
- sanitize filenames and extracted content handling
- keep storage private and authorize every download
- prevent cross-tenant source, document, chunk, and file access

Acceptance tests:
1. A user can create the demo brand.
2. The fixture/demo website can be ingested.
3. A supported file can be uploaded and processed.
4. Knowledge is chunked and searchable with mock embeddings.
5. Search results include source metadata.
6. Failed jobs can be retried safely without duplicate records.
7. Cross-organization access is blocked.
8. SSRF and unsafe upload cases are rejected.

Run migrations, reset/seed, workers, and all quality gates. Add integration and E2E coverage for the complete demo ingestion/search journey.

Update IMPLEMENTATION_STATUS.md and DECISIONS.md. Stop after Phase 2. Do not begin Phase 3 and do not commit or push.
```

---

# Step 5 - Phase 3: subreddit and opportunity pipeline

```text
Implement Phase 3: subreddit management, Reddit-provider ingestion, opportunity scoring, and opportunity feed/detail.

Read AGENTS.md, the full master specification, IMPLEMENTATION_STATUS.md, DECISIONS.md, and all existing provider/database/job code first. Verify previous phases remain green.

Implement every relevant requirement from subreddit management, Reddit provider and ingestion, opportunity scoring, opportunity feed/detail, database, API, background jobs, security, demo fixtures, and tests.

Required outcomes:
- a typed RedditProvider interface shared by mock and approved OAuth implementations
- realistic deterministic mock Reddit fixtures
- an approved OAuth provider implementation or fully testable adapter ready behind environment flags
- production guard that refuses to enable real Reddit ingestion unless the explicit approval/configuration flag is true
- no HTML scraper, browser scraper, password login, or unauthorized fallback
- subreddit discovery/selection and brand-subreddit management
- subreddit rules, promotion/disclosure notes, monitoring state, and manual overrides
- monitored keywords, competitor terms, and exclusions applied to ingestion/scoring
- BullMQ scheduled ingestion, checkpoints, deduplication, retries, backoff, and idempotency
- normalized Reddit posts and deletion/status handling fields
- transparent opportunity scoring for relevance, buying intent, freshness, engagement, rule fit, and competitor context
- score reason/explanation storage, block reasons, and thresholds
- opportunity states and actions required by the specification
- responsive opportunity feed with search, filters, sorting, pagination, badges, empty/loading/error states
- complete opportunity detail page with post context, score breakdown, community rules, brand context, and actions

Demo fixtures must produce at least:
- a high-intent opportunity
- a medium-intent opportunity
- a low-intent opportunity
- a blocked opportunity
- a competitor/alternative opportunity
- a rule-risk example
- a deleted-content example

Acceptance tests:
1. Starting local services and the worker imports mock posts automatically or through the documented scheduled/manual trigger.
2. Posts are deduplicated and become scored opportunities.
3. High, medium, low, and blocked examples render correctly.
4. Every score displays an understandable breakdown and reasons.
5. A rerun is idempotent.
6. Real provider mode stays disabled without the required approval flag and credentials.
7. Cross-tenant access is blocked.

Run all migrations, seeds, worker tests, unit tests for scoring, provider contract tests, integration tests, E2E tests, lint, typecheck, and build.

Update IMPLEMENTATION_STATUS.md and DECISIONS.md. Stop after Phase 3. Do not start AI drafting and do not commit or push.
```

---

# Step 6 - Phase 4: AI drafting, evidence, and compliance

```text
Implement Phase 4: retrieval, AI reply drafting, claim provenance, compliance validation, draft editing, versioning, and approval.

Read AGENTS.md, the complete master specification, IMPLEMENTATION_STATUS.md, DECISIONS.md, and existing knowledge/opportunity code before editing. Verify prior phases remain healthy.

Implement all relevant requirements from AI draft generation, claim verification/provenance, compliance checker, persona/disclosure settings, draft workflow, AI system design, database, API, jobs, security, cost controls, feedback, demo data, and tests.

Required outcomes:
- typed AI provider abstraction with deterministic mock implementation and configurable OpenAI-compatible implementation
- no hardcoded model identifiers; use validated environment configuration
- retrieval of relevant brand knowledge chunks for an opportunity
- structured opportunity evaluation and structured draft-generation outputs validated at runtime
- useful, non-spammy draft based on the Reddit post, rules, brand context, responder role, and retrieved sources
- mandatory affiliation disclosure when the responder is connected to the company
- claim extraction with exact supporting source/chunk references and confidence/status
- visible evidence panel that distinguishes supported, unsupported, stale, and inferred claims
- independent compliance-validation pass covering relevance, excessive promotion, deception, fake experience, missing disclosure, unsafe claims, and rule conflicts
- deterministic mock outputs for all demo cases
- draft editor, regenerate flow, autosave/manual save as specified, version history, diff or version view, feedback, approve, reject, and restore behavior
- server-side approval gate that blocks unsupported/deceptive claims or failed mandatory disclosure/rule checks
- usage accounting and cost-control hooks
- job retries and idempotency for generation/check tasks
- audit logs for generation, edits, approval, rejection, and policy blocks

Acceptance tests:
1. The high-intent demo opportunity produces a useful source-backed draft.
2. Each factual product claim shows its supporting source.
3. A connected founder/employee draft includes transparent disclosure.
4. Unsupported or deceptive claims cannot be approved through UI or API.
5. A user can edit a draft, view versions, reject it, regenerate it, and approve a valid version.
6. Mock AI mode is deterministic enough for stable automated tests.
7. Real-provider failure, timeout, malformed JSON, and rate-limit cases have safe user-visible handling.
8. Cross-tenant access is blocked.

Run unit tests for prompts/schemas/retrieval/claim checks/compliance, integration tests, the opportunity-to-approved-draft Playwright journey, lint, typecheck, and build.

Update IMPLEMENTATION_STATUS.md and DECISIONS.md. Stop after Phase 4. Do not start the extension and do not commit or push.
```

---

# Step 7 - Phase 5: Chrome extension

```text
Implement Phase 5: the Chrome Manifest V3 extension and its secure connection to ThreadSignal.

Read AGENTS.md, the full master specification, IMPLEMENTATION_STATUS.md, DECISIONS.md, the extension section, extension API contract, security requirements, and existing draft APIs before editing. Verify previous phases remain green.

Required outcomes:
- production-quality Manifest V3 extension in apps/extension
- minimal permissions and narrowly scoped host permissions
- secure short-lived connection-code flow initiated from the web app
- revocable extension sessions/tokens; do not store normal app passwords or long-lived unrestricted secrets
- background, content, side-panel, and shared layers as specified
- detect/match the current Reddit thread URL to an opportunity
- load only authorized approved drafts for the active organization/user
- side panel with opportunity summary, rules/disclosure warning, evidence status, editable draft, insert button, copy fallback, connection status, and clear errors
- safe insertion into the Reddit comment composer
- support the fixture Reddit composer used by automated tests and defensively handle supported Reddit UI variants described in the spec
- explicit confirmation after insertion that the user must review and manually submit
- optional manual recording of the resulting comment URL after the user posts
- revoke/disconnect flow from both app and extension
- no automatic submission, click on Comment/Post, keyboard shortcut that submits, simulated typing, delays, fake mistakes, account switching, vote action, or direct message action

Required safety proof:
- content-script code must contain no path that invokes form submission or clicks a submit control
- automated tests must fail if the extension attempts submit behavior
- document permissions and data use in docs/extension.md

Acceptance tests:
1. Build the extension successfully.
2. Connect it to a local demo account using the connection flow.
3. Open the fixture Reddit thread/composer.
4. Match the opportunity and load its approved draft.
5. Edit and insert the draft.
6. Confirm the composer contains the text but no submission occurred.
7. Copy fallback works when insertion cannot be completed.
8. Revocation prevents further API access.

Run extension unit/integration tests, fixture browser E2E tests, pnpm extension:build, lint, typecheck, all tests, and the complete build.

Update IMPLEMENTATION_STATUS.md and DECISIONS.md. Stop after Phase 5. Do not begin tracking/analytics and do not commit or push.
```

---

# Step 8 - Phase 6: attribution and analytics

```text
Implement Phase 6: tracking links, redirect service, click collection, browser tracking snippet, conversion API, and analytics dashboards.

Read AGENTS.md, the master specification, IMPLEMENTATION_STATUS.md, DECISIONS.md, and existing brand/opportunity/draft data model first. Verify previous phases still pass.

Implement all relevant tracking, conversion, analytics, database, API, security, privacy, performance, demo-data, and testing requirements.

Required outcomes:
- unique tracking-link creation for approved opportunities/drafts
- fast /go/[code] redirect with safe target validation
- click-event collection with documented privacy/minimization behavior
- protection against open redirects and malformed/unknown/disabled links
- duplicate/bot handling rules defined and tested
- browser tracking snippet for approved customer domains
- server-to-server conversion API with hashed/revocable keys, scoped permissions, validation, idempotency keys, and safe error responses
- supported conversion events from the specification, including signup/lead/purchase/custom where applicable
- correct currency and revenue handling
- attribution rules documented and implemented consistently
- dashboard metrics and funnels for opportunities, drafts/replies, clicks, conversions, conversion rate, and attributed revenue
- date range, brand, subreddit, opportunity, and event filters as specified
- analytics detail/drilldown views and CSV export if required by the master spec
- no fabricated analytics values outside explicit demo/seed mode
- audit logs and structured logs without leaking personal data or API keys

Acceptance tests:
1. A demo tracking link redirects to the correct allowlisted destination.
2. A demo click appears in analytics.
3. A signup conversion can be recorded idempotently.
4. A USD 99 purchase can be recorded and appears in funnel/revenue reporting.
5. Repeated event delivery does not double count.
6. Invalid target URLs, invalid API keys, cross-tenant IDs, and malformed events are rejected.
7. Analytics totals reconcile with underlying events.
8. Redirect latency is measured and kept out of unnecessary heavy application paths.

Run unit, integration, API, and Playwright Journey C tests plus lint, typecheck, all tests, and build.

Update IMPLEMENTATION_STATUS.md and DECISIONS.md. Stop after Phase 6. Do not begin billing/notifications and do not commit or push.
```

---

# Step 9 - Phase 7: Stripe billing and notifications

```text
Implement Phase 7: real billing adapters, server-side usage enforcement, upgrade flows, and notifications.

Read AGENTS.md, the full master specification, IMPLEMENTATION_STATUS.md, DECISIONS.md, the central plan configuration, usage model, and existing provider patterns. Verify previous phases remain green.

Implement all relevant notification, billing/subscription, usage, database, API, jobs, security, demo mode, and testing requirements.

Billing outcomes:
- typed billing-provider abstraction with deterministic mock provider and Stripe implementation
- Stripe Checkout and customer portal flows
- signed webhook verification and idempotent processing
- subscription/trial/payment state synchronization
- central plan limits rendered consistently on pricing, billing, and server enforcement paths
- server-side usage checks and atomic usage counters for all metered actions
- upgrade/downgrade/cancel/renew/trial-expiry/past-due states required by the specification
- clear upgrade UI and error handling
- Stripe test-mode instructions and safe fixture/testing strategy
- no client-controlled plan, price, entitlement, usage, or organization trust

Notification outcomes:
- typed email-provider abstraction with console provider and Resend-compatible provider
- user notification preferences
- high-opportunity alert email
- daily digest job
- invitation, trial, payment, and subscription lifecycle emails required by the specification
- delivery records, retries, deduplication, unsubscribe/preference enforcement, and safe failure handling
- branded accessible email templates without fake metrics

Credentials:
- do not ask me to paste secrets into chat or source files
- if Stripe/Resend keys are absent, fully implement and contract-test the real adapters, verify the mock/console path, and clearly mark live external verification as pending
- `.env.example` must contain variable names only

Acceptance tests:
1. In mock mode, plan lifecycle and notifications work end to end.
2. When Stripe test credentials exist in the local environment, a test subscription changes plan limits through verified webhooks.
3. Usage limits are enforced server-side, including direct API calls.
4. Duplicate webhooks and jobs are idempotent.
5. Daily digest and high-score alerts obey preferences.
6. Playwright plan-limit journey passes.
7. Cross-tenant billing data is blocked.

Run billing/email provider contract tests, webhook tests, job tests, integration tests, Playwright Journey D, lint, typecheck, all tests, and build.

Update IMPLEMENTATION_STATUS.md and DECISIONS.md. Stop after Phase 7. Do not begin hardening automatically and do not commit or push.
```

---

# Step 10 - Complete every public page and polish the whole UI

This step ensures the marketing and visual requirements are not lost between engineering phases.

```text
Perform the complete public-site and product-UI implementation pass required by sections 5, 6, 14, 17, and all feature-specific UI requirements in threadsignal_master_build_spec.md.

This is not a redesign that changes product behavior. Preserve all implemented APIs, authorization, data contracts, and guardrails.

Required outcomes:
- implement every public route in the master specification, including homepage, pricing, legal placeholders with required sections, security/responsible-use page, authentication entry points, and tracked redirect behavior
- finish every authenticated route and internal route required by the specification; no core route may remain a blank shell or static placeholder
- use a consistent responsive SaaS design system built from shared components
- make navigation, brand switcher, filters, tables/cards, dialogs, forms, score displays, evidence panels, compliance states, analytics, settings, and onboarding visually consistent
- add complete loading, skeleton, empty, first-use, validation, success, warning, permission-denied, not-found, and recoverable-error states
- meet keyboard, focus, labels, contrast, reduced-motion, screen-reader, and responsive requirements
- avoid excessive animation and unnecessary client-side JavaScript
- use honest demo labeling; do not add fake customers, testimonials, user counts, revenue, ratings, or performance claims
- pricing limits must come from the same central plan configuration used by server enforcement
- responsible-use wording must clearly state that the extension inserts but never submits replies
- verify mobile, tablet, and desktop layouts
- add visual/interaction regression coverage for the highest-value pages where practical

Review all application routes against the route table in the master spec and create docs/route-completion-matrix.md with each route, status, data source, authorization, empty state, and test evidence.

Run accessibility checks, relevant Playwright journeys, lint, typecheck, all tests, and build. Fix issues found rather than only reporting them.

Update IMPLEMENTATION_STATUS.md and DECISIONS.md. Stop after this UI completion pass. Do not commit or push.
```

---

# Step 11 - Phase 8: hardening and launch readiness

```text
Implement Phase 8: hardening and launch readiness.

Read AGENTS.md, the complete master specification, IMPLEMENTATION_STATUS.md, DECISIONS.md, docs/build-plan.md, docs/risk-register.md, and all current code. Treat the Phase 8 acceptance criteria and MVP definition of done as mandatory.

Required outcomes:
- Reddit deletion/status synchronization and reliable purge of deleted content/user-related data required by the specification
- retention, organization deletion, brand deletion, export, token revocation, and cleanup jobs
- comprehensive authorization/RLS review and automated tenant-isolation tests
- rate limits for authentication-sensitive, generation, crawl, tracking, conversion, extension, webhook, and admin endpoints as appropriate
- secure headers, CSRF/origin protection where applicable, safe cookies, input/output validation, secret boundaries, and dependency review
- crawler SSRF re-review and adversarial tests
- upload parser safety and storage access re-review
- webhook replay/signature/idempotency review
- extension permission and no-submit guardrail review
- audit-log completeness
- admin job view with statuses, retries, failure details, and safe manual retry controls
- Pino structured logs with correlation IDs and redaction
- Sentry-compatible error reporting hooks and OpenTelemetry-ready traces
- health/readiness endpoints for web, worker, database, and Redis dependencies
- operational dashboards/alerts documentation
- accessibility audit and fixes
- performance audit and fixes for key pages, redirect path, queues, and database queries
- database indexes and query-plan review for high-use paths
- backup, restore, migration, rollback, and incident-response documentation
- complete local, staging, production, worker, web, database, Redis, email, billing, AI, crawler, and extension deployment documentation
- Chrome extension packaging/manual-install/store-submission documentation
- production configuration must keep real Reddit ingestion disabled unless explicit approved-access settings are present

Create or complete:
- docs/architecture.md
- docs/api.md
- docs/deployment.md
- docs/extension.md
- docs/responsible-use.md
- docs/security.md
- docs/privacy-data-flow.md
- docs/operations-runbook.md
- docs/backup-restore.md
- docs/incident-response.md
- docs/release-checklist.md

Verification:
- run dependency/security checks available to the repository
- run all unit tests
- run all integration tests
- run all E2E journeys A-E from the master specification
- run all extension tests
- run pnpm lint
- run pnpm typecheck
- run pnpm test
- run pnpm build
- run pnpm extension:build
- reset and seed a clean local database, then execute the full demo flow from signup to USD 99 attributed purchase

Fix all critical/high issues and all issues that violate the master specification. Do not call an external integration live-tested if credentials or approval were absent.

Update IMPLEMENTATION_STATUS.md and DECISIONS.md. Stop after Phase 8 and return detailed evidence. Do not commit or push.
```

---

# Step 12 - Final specification compliance audit

```text
Perform a final implementation audit against every requirement in threadsignal_master_build_spec.md. Do not merely write a gap report: fix every in-scope MVP gap you find, then re-run verification.

Read the entire specification again, including sections 0-25, plus AGENTS.md, IMPLEMENTATION_STATUS.md, DECISIONS.md, all documentation, migrations, tests, and current Git diff.

Create SPEC_COMPLIANCE_MATRIX.md with one row for every meaningful requirement and these columns:
- specification section/requirement
- implementation location
- automated test evidence
- manual verification evidence
- status: complete, externally unverified, or out of MVP scope
- notes

Audit at minimum:
1. All public, authenticated, and internal routes.
2. All database tables, constraints, indexes, migrations, generated types, and RLS policies.
3. Every API endpoint and standard error contract.
4. Every background queue/job, retry policy, idempotency rule, and scheduled task.
5. All provider interfaces and mock/real adapter boundaries.
6. The complete onboarding -> knowledge -> mock Reddit ingestion -> scoring -> drafting -> evidence -> compliance -> approval -> extension insertion -> tracking -> conversion -> analytics -> billing flow.
7. Cross-tenant authorization.
8. Responsible-use guardrails, especially no automatic Reddit submission.
9. Accessibility, responsive layouts, performance, observability, data deletion, and documentation.
10. Every item in sections 21 and 22 of the master specification.
11. No fake metrics/testimonials and no core placeholder screens.
12. No committed secret or accidental browser exposure of server-only variables.

Required final clean-room test:
- remove generated artifacts and reinstall dependencies as documented
- start local services using documented commands
- reset and seed the database
- start web and worker
- run the full automated suite
- build web, worker, and extension
- execute the documented demo journey

Return the final delivery package required by section 22:
- concise implementation summary
- exact local setup commands
- demo account/data instructions
- environment-variable instructions
- migration instructions
- worker and web deployment instructions
- extension build/install instructions
- Stripe test instructions
- mock-to-approved-Reddit-provider instructions
- exact test results
- genuine external limitations
- guardrail-to-code enforcement map

Do not say 'complete' unless the MVP definition of done is fully satisfied or an item is clearly and honestly marked externally unverified due only to missing third-party credentials/approval.
```

---

# Step 13 - Review the full change set

Use Codex's review command when available, or paste this:

```text
Review the complete branch against the base branch and threadsignal_master_build_spec.md. Do not modify files in the first review pass.

Prioritize findings as:
- P0: security/data loss/tenant escape/automatic Reddit action/secret exposure/broken core flow
- P1: incorrect requirements, broken tests, authorization gaps, billing or attribution errors, unreliable jobs, inaccessible core flow
- P2: maintainability, performance, UX, documentation, or test gaps that materially affect launch quality
- P3: minor polish

For every finding, provide exact file/line evidence, impact, reproduction or reasoning, and the smallest correct fix. Check all uncommitted files, migrations, generated types, tests, environment configuration, worker code, extension code, and documentation.
```

Then paste:

```text
Address every valid P0 and P1 finding from the review, plus all P2 findings that affect the MVP definition of done. Keep fixes minimal and architecture-consistent. Add regression tests for each correctness or security issue. Re-run the full required test/build suite and update SPEC_COMPLIANCE_MATRIX.md and IMPLEMENTATION_STATUS.md with evidence. Do not hide or dismiss a finding without written technical justification. Do not commit or push.
```

---

# Step 14 - Create the final local release commit

Only after review and verification pass:

```text
Prepare the repository for the first MVP release.

1. Confirm git status and show the final diff summary.
2. Confirm no secrets, local databases, logs, generated coverage, temporary screenshots, or unsupported large files are staged.
3. Confirm all required tests and builds pass on the final tree.
4. Update CHANGELOG.md with an honest MVP entry.
5. Set an initial version consistently where appropriate.
6. Create one local commit with the message:
   feat: complete ThreadSignal MVP
7. Tag the local commit as v0.1.0 only if the complete definition of done passes.
8. Do not push, deploy, publish the extension, or enable real Reddit ingestion.

Return the commit hash, tag status, final test evidence, and any externally unverified integrations.
```

---

# Step 15 - Deploy a staging environment

Do this after you have created the necessary accounts and placed credentials in platform environment settings, not in chat or Git.

```text
Deploy and verify a staging environment for ThreadSignal using the deployment architecture in the master specification and docs/deployment.md.

Constraints:
- never print or commit secret values
- use a dedicated staging Supabase project/database/storage
- use managed Redis for the staging worker
- use Stripe test mode only
- use a non-production email recipient allowlist or safe staging email mode
- keep REDDIT_PROVIDER=mock and REDDIT_COMMERCIAL_APPROVAL_CONFIRMED=false
- use a staging domain and separate callback/webhook URLs
- do not publish the Chrome extension publicly; package a staging build with narrowly scoped staging origins

Tasks:
1. Validate the environment-variable matrix by presence, never value.
2. Apply migrations safely and seed only staging demo data.
3. Deploy web and worker.
4. Configure health/readiness checks.
5. Configure Stripe test webhooks if test credentials exist.
6. Build the staging extension.
7. Run staging smoke/E2E tests for authentication, organization isolation, knowledge ingestion, mock opportunity processing, drafting, extension insertion fixture, tracking, conversion, analytics, and billing limits.
8. Verify logs and error monitoring do not expose secrets or sensitive content.
9. Create docs/staging-verification-report.md with deployment identifiers, migration version, test evidence, and rollback instructions, but no secrets.

Fix staging-only defects and repeat verification. Do not enable production Reddit ingestion.
```

---

# Step 16 - Production readiness and launch

Only use this after your legal/business/payment/provider prerequisites are ready. Real Reddit access must remain off until you have the required approved commercial access and credentials.

```text
Prepare, but do not blindly execute, the production launch of ThreadSignal.

Read docs/release-checklist.md, docs/deployment.md, docs/security.md, docs/privacy-data-flow.md, docs/operations-runbook.md, SPEC_COMPLIANCE_MATRIX.md, and the master specification.

First produce a production launch checklist split into:
- actions Astra can safely perform
- actions I must perform in external dashboards
- required approvals/contracts
- secret/environment setup
- migration and backup steps
- smoke tests
- rollback triggers and commands

Do not enable or test real Reddit ingestion unless REDDIT_COMMERCIAL_APPROVAL_CONFIRMED=true is deliberately present and approved OAuth credentials are configured. Never add scraping as a fallback.

After external prerequisites are confirmed through environment presence and explicit approval flags:
1. Back up the target database.
2. Validate and apply migrations.
3. Deploy web and worker using immutable version identifiers.
4. Configure verified domains, auth redirects, email, Stripe live/test mode as explicitly selected, monitoring, alerts, and rate limits.
5. Package the Chrome extension for review without any auto-submit behavior.
6. Run production-safe smoke tests that do not create spam or unwanted external activity.
7. Verify deletion, revocation, billing, conversion, and incident-response paths.
8. Produce docs/production-verification-report.md without secrets.

Stop and report rather than bypassing any missing approval, external dashboard action, or production credential.
```

---

# Reusable review-and-commit loop after every phase

## A. Review prompt

```text
Review all uncommitted changes for the current phase against AGENTS.md and the exact acceptance criteria in threadsignal_master_build_spec.md. Do not edit in the first pass. Identify P0-P3 findings with exact evidence. Pay special attention to authorization, RLS, cross-tenant data, runtime validation, idempotency, provider boundaries, secret exposure, test quality, accessibility, and product guardrails.
```

## B. Fix prompt

```text
Fix every valid P0/P1 issue and every P2 issue needed for the current phase acceptance criteria. Add regression tests. Re-run the relevant phase tests plus pnpm lint, pnpm typecheck, pnpm test, and pnpm build. Update IMPLEMENTATION_STATUS.md and DECISIONS.md. Do not begin the next phase.
```

## C. Local commit prompt

```text
The current phase has passed review and all required checks. Confirm no secret or temporary file is staged, then create one local commit for this phase using a clear conventional-commit message. Do not push. Return the commit hash and exact checks that passed.
```

Suggested commit messages:

```text
chore: establish ThreadSignal repository foundation
feat: add organizations roles and tenant isolation
feat: add brand knowledge ingestion and search
feat: add Reddit opportunity ingestion and scoring
feat: add evidence-backed compliant AI drafts
feat: add manual-insert Chrome extension
feat: add attribution conversions and analytics
feat: add billing usage limits and notifications
chore: harden ThreadSignal for MVP launch
```

---

# Recovery prompt when a chat/session is interrupted

```text
Resume ThreadSignal implementation safely.

Read AGENTS.md, threadsignal_master_build_spec.md, IMPLEMENTATION_STATUS.md, DECISIONS.md, SPEC_COMPLIANCE_MATRIX.md if present, git status, git log, and the current diff. Do not trust an earlier prose claim that a phase is complete; verify it from code and tests.

Determine:
- last committed phase
- current uncommitted phase
- acceptance criteria already evidenced
- failing or unrun checks
- external credentials that are intentionally absent

Run the minimum checks needed to establish the true state, update IMPLEMENTATION_STATUS.md, and continue only the current incomplete phase. Do not skip forward, rewrite working architecture unnecessarily, request production secrets, or enable real Reddit ingestion.
```

---

# Repair prompt when a phase fails

```text
The current phase is not complete. Diagnose the failing command or acceptance criterion from actual logs and code. Find the root cause rather than suppressing the error, weakening tests, using broad type casts, disabling lint rules, removing RLS, bypassing authorization, or replacing the feature with a mock screen.

Implement the smallest durable fix, add a regression test, rerun the failed check, then rerun all quality gates required for the phase. Update IMPLEMENTATION_STATUS.md with exact evidence. Stay within the current phase.
```

---

# Rules for you, the project owner

1. Give Astra only one implementation phase at a time.
2. Keep `threadsignal_master_build_spec.md` unchanged unless you deliberately change the product requirements.
3. Use the same project/repository and preferably the same long-running chat.
4. Run a review after every phase.
5. Commit each verified phase before starting the next one.
6. Never paste production secrets into prompts.
7. Keep providers in mock mode through the core build.
8. Do not accept a phase based only on Astra saying it is done; require commands and test evidence.
9. Do not allow Astra to skip RLS, workers, tests, extension safety, or provider abstractions to make the demo look finished.
10. Do not enable real Reddit ingestion until the required approval and credentials exist.
