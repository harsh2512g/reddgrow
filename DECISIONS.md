# ThreadSignal Architecture Decision Log

ADR-001–007 record Phase 0 decisions from 2026-09-13. ADR-008 onward record Phase 1 decisions following the owner's next-phase request on 2026-09-15. No external account, deployment, commit, or machine-wide installation is authorized by these decisions.

## ADR-001: Repository-local development launcher

`./scripts/local` clears inherited environment variables before starting Node and builds an explicit allowlist. The configured package, cache, temporary, browser-profile, Docker, Colima, and Lima paths are repository-local. Turbo explicitly passes these paths to child tasks. The earlier Lima temporary-path exception is retained in the verification report; absolute historical confinement is not claimed. Public npm is the sole package registry. Root dotenv files are never loaded; application dotenv files are rejected to prevent framework auto-loading. Example environment files contain names with blank values, as specifically requested; safe defaults live in validated configuration and the launcher.

Lima requires the real, unchanged home path during initialization. Only the Colima subprocess receives it; host mounts, public SSH key loading, SSH-agent forwarding, and SSH config writes are disabled. Lima state uses `.local/lima` because the longer initial path exceeded macOS UNIX-socket limits. Docker uses an empty repository-local credential configuration and a helper that refuses credential retrieval/storage, preventing automatic use of platform credential stores.

Consequences: run documented commands through the launcher. A bare package-manager invocation cannot provide the same isolation. Machine-wide tooling changes require separate approval. References: owner isolation instructions; specification §§10, 19, 20.

## ADR-002: Dedicated Colima services and guarded Redis commands

Use a separate repository-owned Colima VM and Docker context named `colima`; verify its exact socket before container operations. Supabase runs in a generated workdir without root dotenv discovery. Database and Redis container identities and published ports are recorded after startup and verified before supplying connection configuration. Database reset refreshes ownership because Supabase replaces its database container.

Redis configuration remains in `docker-compose.yml`. A narrow, Zod-validated Docker CLI implementation starts/stops that single service because an independently usable Compose executable is unavailable. It validates ownership labels, retains its data volume, and never selects another daemon. The owner forbids the alternative container runtime available on this machine, so its executable is unused.

Lima override rules inherit project socket forwarding, allow only TCP ports 54320–54324 and 56379 on host `127.0.0.1`, and ignore every other TCP/UDP port. Redis publishes only `127.0.0.1:56379`; protected mode is disabled inside the dedicated VM so host clients can connect through Docker NAT. This is a local development configuration, not a production security model. References: specification §20 Phase 0; build prompt's documented Compose-equivalent allowance.

## ADR-003: Compiled shared packages and pinned toolchain

Shared packages export generated JavaScript and declarations from `dist`; Turborepo builds prerequisites and development tasks watch TypeScript output with concurrency 16, sufficient for all ten persistent tasks. This avoids ambiguous source `.js` resolution in Next.js. The Node target is 24 (`.nvmrc`); the permitted engine range also includes the existing Node 25.2.1 used for local verification. No Node version manager or global package installation was changed.

Direct dependency versions are pinned in the workspace lockfile. TypeScript 6 and ESLint 9 were selected for compatibility with the installed Next.js/typescript-eslint toolchain. Native build permission is explicit: esbuild allowed; unused optional native builds disabled. The two lockfile release-age exceptions reflect explicitly selected public-npm versions. References: specification required stack and Phase 0 quality gates.

## ADR-004: Phase boundaries and fail-closed application access

The existing Next.js app is preserved. The public landing/security pages and accessible local `/app` preview contain no customer data or fabricated activity. Protected future application paths redirect to an unavailable sign-in state. Authentication, organization membership, plans, billing flows, and tenant business tables remain Phase 1 work. Health checks report real readiness and do not connect to dependencies without verified local ownership.

The database foundation enables pgvector, revokes unsafe future defaults, and creates a private knowledge bucket. Seed data is infrastructure-only and idempotent; generated public-schema types are intentionally empty of business tables. References: specification §§0, 20, 21.

## ADR-005: Provider contracts and deterministic local fixtures

Keep Reddit/AI/billing `mock`, email `console`, and crawler `fixture`. Zod validates credentials only for the selected real provider; real factories remain unavailable in Phase 0. Mock providers use deterministic synthetic content and never perform external API calls. Crawler fixtures require approved synthetic URLs. Email logs operational metadata without recipient/body values. No production credential is required or requested. References: specification §§0, 19, 20; owner's explicit provider requirements.

## ADR-006: Worker and extension boundaries

The worker processes a bounded, retryable BullMQ heartbeat and reports database, Redis, and processing readiness. It introduces no business jobs. The Manifest V3 extension has only the side-panel permission and no host permissions, content scripts, network integration, or Reddit submission code. Connecting accounts, draft lookup, editing, insertion, and publishing assistance remain later-phase work. References: specification guardrails and Phase 0; extension behavior in Phase 5.

## ADR-007: CI separates static gates from Colima integration

GitHub Actions runs static quality, unit tests, builds, hygiene, and browser smoke tests on hosted Linux. A separate required service job targets an explicitly labeled personal self-hosted Colima runner for reset/seed/migration lint, integration tests, and cleanup. Using a hosted runner's default Docker daemon would bypass the owner's Colima-only requirement.

No runner was provisioned or connected and no remote workflow was triggered. The service job queues until the owner separately authorizes and supplies that personal runner. Local execution provides Phase 0 acceptance evidence; remote execution and Node 24 verification remain unverified. References: specification §16.5 and owner isolation instructions.

## ADR-008: Server-verified Auth and scoped cookies (Phase 1)

Use Supabase Auth through `@supabase/ssr`, with PKCE email links, a callback code exchange, and server-verified `getUser()` sessions. Refresh runs in the Next proxy; each server data read and mutation still verifies the user, and PostgreSQL independently enforces access. Session and PKCE cookies use a ThreadSignal-specific name, HttpOnly, SameSite=Lax, and Secure outside the explicitly verified HTTP loopback runtime. Redirect destinations are constrained to application paths. Auth endpoints validate bounded input, enforce the configured origin for mutations, and apply atomic Redis rate limits without storing raw email or IP data in logs.

Local Auth uses the repository's Supabase and Mailpit inbox. Service ownership must be verified before the launcher supplies the local database URL and public anonymous key. No service-role key reaches web runtime. Google OAuth supports explicitly configured HTTPS environments but is disabled in the isolated local runner; no external provider setup or login was performed. Existing dotenv files remain unused. Next request and Server Function argument logging is disabled to avoid exposing sign-in codes, private invitation links, or form data.

## ADR-009: Organization boundaries and transactional allocation (Phase 1)

The active organization cookie is an untrusted selection hint. Every read resolves it against verified memberships. Settings and team actions bind the rendered organization ID and reauthorize it before mutation, preventing a workspace switch in another tab from changing the mutation target. RLS and restricted SQL RPCs provide a second boundary. Workspace slugs are selected at creation and remain immutable; settings update the name, billing contact, time zone, and currency. Billing contact and raw subscription records are owner-only; nonowners see a safe plan summary. Safe column grants keep invitation hashes and billing contacts out of generic SELECT queries.

Organization creation atomically provisions ownership, a seven-day trial, subscription, and audit event. Central TypeScript plan definitions mirror an immutable database catalog, with integration tests proving parity. Row/advisory locks protect trial creation, seat reservations, and last-owner invariants under concurrency. A pending invitation reserves a seat. Acceptance verifies the signed-in email, expiry, plan capacity, and one-time token hash under a transaction. Only hashes are stored; console mode returns the private URL once to the authorized inviter. If console delivery fails, the result explains that the invitation exists and preserves the usable link.

Owner data-export/deletion requests are persisted and audited, without implementing export processing or deletion jobs before their owning phase. Trial and plan limits retain existing data. Brand, knowledge, opportunity, and draft allocations remain later-phase work.

## ADR-010: A distinctive, accessible visual foundation (Phase 1)

Use warm neutral surfaces, navy text, indigo accents, concentric signal artwork, and restrained editorial typography. All artwork is SVG/CSS and fonts are system/local fallbacks, so no design asset requires external requests. Native dialog/details navigation supports keyboard use; forms use React Hook Form and Zod with visible pending, error, success, validation, and permission states. Marketing pages distinguish present workspace functionality from future product workflows and show no fabricated activity, testimonials, or results.

The workspace pins React and React DOM to the same version through pnpm overrides. Testing exposed a duplicate React resolution in the shared Radix-based button; aligning dependencies fixes hooks across package boundaries instead of replacing the component to conceal the problem. Public pricing and authenticated plan comparison both derive from the same plan configuration.

## ADR-011: Phase 1 verification and external boundaries

Run public smoke tests in hosted CI and the complete authenticated browser journeys on the explicitly labeled personal Colima service runner. Fresh browser contexts never reuse the owner's browser profile. Auth tests disable automatic traces/video/screenshots because URLs and cookies contain authentication material. Local mailbox helpers never print message bodies or links. RLS, role, invitation, trial, and concurrency tests use independent synthetic database fixtures and leave demo memberships intact.

The owner's next-phase request authorizes Phase 1 repository work; it does not erase the historical Phase 0 isolation exception or authorize outside-repository cleanup. Google live OAuth, remote CI, Node 24 runtime verification, external email, and payments remain unverified. Phase 2 is not started automatically.

## ADR-012: Explicit personal Supabase development profile (Phase 1)

The owner supplied a newly created personal development project's public URL and publishable key. Keep those public settings in ignored `.threadsignal/hosted-supabase.json`, validated with Zod, rather than reading any existing dotenv or account configuration. The dedicated launcher accepts only an exact project-reference HTTPS endpoint and public publishable key, clears inherited environment values, preserves all five development providers, and removes direct database/admin configuration. Default local commands never load this profile. No service-role key, database password, dashboard session, or personal access token is needed by the web application.

Run hosted development at `http://localhost:3002` with separate `.next-hosted` output; the local demo remains at `http://127.0.0.1:3000`. Verify the raw Host header before hosted cookies are read or forwarded, because cookies have no port boundary and Next normalizes some loopback URLs. Auth fetches refuse redirects. Local Redis remains ownership-verified, with a separate authentication rate-limit namespace for the personal project. The worker and database maintenance commands remain local. Hosted database readiness uses only a verified signed-in user's zero-row query; an anonymous visitor cannot establish schema readiness with the public key alone.

Generate a reviewable one-time SQL Editor bootstrap from the unchanged, hash-verified Phase 0/1 migrations. It includes transaction/preflight guards and excludes local seeds. It refuses initialized or conflicting projects. SQL Editor execution does not update CLI migration history; later CLI adoption requires explicit schema verification and supported history reconciliation, not an unreviewed push. The owner applies schema and dashboard settings; this change makes only scoped read-only public API checks. Hosted email delivery, SQL application, and authenticated tenant isolation are separate verification steps, not inferred from a successful Auth connectivity check.

## ADR-013: Local Phase 2 with preserved hosted authentication

The owner explicitly chose to keep Phase 2 processing local after confirming hosted sign-in. Brand and knowledge handlers require the verified local runtime and local Supabase mode. Hosted pages show a local-development link before any Phase 2 table access. The hosted SQL generator continues to embed only the hash-verified Phase 0/1 migrations and explicitly excludes the known local Phase 2 migration. No hosted database password, service-role credential, migration application, or worker setup is required.

Use `db:migrate` to apply pending local migrations without resetting existing data. Generated types are refreshed after migration. The original two migrations remain unchanged for the reviewed hosted bootstrap. No Phase 3 functionality is included.

## ADR-014: Transactional brand allocation and private knowledge records

The validated brand profile is canonical JSON, with competitors, persona, and vocabulary mirrored in the same SQL transaction. Owner/admin mutations use restricted audited RPCs; all reads remain user-scoped and protected by RLS. Organization locks serialize active-brand, source, and page allocation against the central plan. Composite foreign keys bind organization, brand, source, document, and chunk identities together. Brand creation also binds the rendered organization in a request header to reject stale cross-tab workspace submissions.

App Router loaders serve authenticated screen reads. Source creation uses one discriminated JSON endpoint plus a multipart upload endpoint; archive/restore use PATCH and re-ingestion uses `/retry`. This consolidates the specification's source-specific REST endpoint names without changing the supported source types or authorization. Brand/source selection is an explicit URL parameter and does not silently change the organization cookie.

## ADR-015: Durable ingestion, fixed embeddings, and bounded extraction

SQL knowledge jobs form a durable outbox. BullMQ receives job identifiers only. The worker claims a 90-second renewable lease, allows three bounded attempts, and fences every publication by source generation and lease token. Checksums reuse unchanged vectors and preserve unchanged chunk identities; source/document metadata remains attached. Manual retry creates a new generation. Deletion immediately removes searchable content and invalidates old work, then retains a tombstone until physical Storage cleanup succeeds. Failed cleanup can be retried.

Local search uses normalized deterministic lexical feature vectors with 512 dimensions, pgvector cosine similarity, and a small lexical ranking contribution. Scores are labeled as mock development relevance. A real embedding provider must keep the configured dimension/model consistent with stored vectors; paid provider activation is not part of this phase. The fixture crawler fetches no network content and accepts only the approved synthetic pages. Unsupported real factories fail closed.

Uploads are limited to 10 MB and validated by extension, MIME, and content signature. Original files stay in the private bucket under organization/brand/source/filename. PDFs run in a separate worker thread with heap, time, page (100), and extracted-text (500,000 characters) limits. Normalized text is chunked near 750 estimated tokens with approximately 100-token overlap; long unbroken input is bounded too. Preview content is rendered as text.

## ADR-016: Separate local worker Storage authority

After verifying the exact repository-owned Colima context, socket, containers, and loopback endpoints, the worker launcher reads the local CLI's freshly returned service-role JWT into its child process only. It is never persisted, logged, put in a queue, inherited from the shell, sent to hosted Supabase, or passed to the web app. Worker Storage calls use the fixed loopback API with path validation, no redirects, and bounded reads. Mock providers require no real-provider secrets.

Web uploads use the signed-in user's Storage permissions. A manager may read their own uncommitted upload at the validated organization/brand path so a failed source transaction can remove it. Other members see only committed, undeleted sources. Input is validated before upload and failed source creation triggers compensating cleanup; if Storage is also unavailable, the API explicitly reports that cleanup requires attention. PostgreSQL and object storage do not share a transaction, so a process crash during upload remains a documented orphan-file recovery boundary.

## ADR-017: Explicit hosted Phase 2 migration without replaying initialization

The owner subsequently supplied a new personal development DATABASE_URL in root `.env.local` and explicitly requested migration. This authorizes the scoped cloud database operation and supersedes the earlier local-only schema choice. A dedicated migration command reads only that newly authorized variable; ordinary launchers continue to ignore root dotenv. The credential is never copied, logged, passed to web/worker processes, or placed in command arguments. The parser validates the personal project reference, direct/session-pooler hostname, database and port, rejects arbitrary connection options, decodes URI escapes once, and preserves a stray unescaped percent sign as a literal in memory.

Use the unchanged SHA-256-reviewed Phase 2 migration in one transaction with an advisory lock and bounded lock/statement timeouts. Compare catalog definitions, RLS, effective anonymous/authenticated table and column privileges, routines, indexes, triggers, and knowledge Storage policies against the verified owned local database. Check the Phase 1 baseline before and after applying the delta and check Phase 2 before committing. Compare columns by name because the documented local development reconciliation added `section_heading` at the end of its physical table; all types, defaults, nullability and access still compare exactly. Existing complete matching Phase 2 schemas verify without replay; partial or different schemas refuse. No seed, reset, account import, or bootstrap replay occurs.

Fetch Supabase's public CA from the download URL defined in its official Studio source over verified HTTPS, with no redirects and a size limit. Keep certificate and hostname verification enabled on the client connection. No machine-wide trust or credential configuration is inspected or modified. The pooler's PostgreSQL backend `pg_stat_ssl` flag describes its separate backend hop and is not used as evidence of the client's TLS state.

Keep Supabase CLI migration history unchanged because the initial setup was run through SQL Editor. Store only schema hashes, migration identity, project reference, outcome, and timestamp in an ignored local verification receipt. A future CLI adoption must still reconcile history explicitly. This migration does not grant the existing worker cloud administration access or enable hosted ingestion; a dedicated worker connection and verification remain necessary. Phase 3 is not started.

## ADR-018: Restricted hosted worker preparation and frozen Phase 2 reference

The prepared Phase 2 deployment operation creates a dedicated, nonadministrative PostgreSQL role with explicit column grants and thirteen role-specific RLS policies. The worker cannot assume administrator/application roles, bypass RLS, read Auth identities, or create persistent database objects. A generated password stays in a mode-0600 ignored profile; only its SCRAM verifier enters provisioning SQL. The new personal Storage secret is read narrowly for server-only file access. The web launcher verifies matching project/queue identity and restricted worker readiness before enabling hosted knowledge. Web environment validation rejects database and Storage administrator credentials.

Automatic approval review rejected hosted credential creation because the owner's earlier processing choice was local. No provisioning ran. Explicit owner approval remains pending, and temporary hosted smoke-test Auth accounts require separate approval. Local role/login tests prove the permission design, with the role restored to NOLOGIN/null password afterward.

Before starting Phase 3, preserve a checksum-pinned catalog reference captured from the verified local Phase 2 database. Its application hashes match the previously verified hosted receipt. Migration and worker-provisioning comparisons use this reference, so later local schema evolution cannot silently change the reviewed hosted expectation. The reference contains definitions and effective privileges only, never customer rows, identities, keys, or passwords. All original migration checksums remain pinned.

## ADR-019: Local opportunity pipeline and phase boundary

The owner's next-phase request starts Phase 3 after Phase 2 local acceptance passed again. Hosted Phase 3 schema, worker authority, and UI access remain disabled; the hosted login application is preserved. Phase 3 adds read-only provider ingestion, community rules, keyword controls, opportunity evaluation, and review actions. Reply generation, draft editing, approvals, extension handoff, and attribution remain their later phases.

Use shared global provider records with tenant-bound monitoring and opportunity records. RLS exposes shared posts only through authorized monitoring or existing opportunities. Database RPCs serialize plan allocation and usage; retries and rescoring never consume another opportunity. Preserve keyword and competitor identities across brand edits. User-controlled status changes remain independent of rescoring except hard blocks and deletion.

Separate BullMQ ingestion and evaluation queues receive only durable PostgreSQL job identifiers. Renewable leases fence publication and checkpoint updates. Schedule active communities about every ten minutes with internal load-distribution jitter, refresh rules daily, refresh post state every twelve hours, and conservatively purge content that cannot be refreshed within forty-eight hours. Permanent deletion tombstones cannot be resurrected by stale listings. Scoring combines validated structured analysis with deterministic freshness/engagement and explicit penalties and hard blocks. All development providers remain mock/console/fixture.

## ADR-020: Explainable brand feedback without model training

Dismissal feedback influences only the same brand, community, and assessed intent. The worker supplies bounded aggregate counts from recent human dismissals, excluding deleted posts and the current post; it does not reuse Reddit text as training data. Three or more relevant dismissals add an explicitly explained penalty of three points per count, capped at fifteen. Only not-relevant, low-intent, product-cannot-help, and community-risk reasons participate. Feedback never boosts a score, crosses organizations, or overrides a hard block. User dismissal/archive states remain preserved through rescoring.

## ADR-021: Make the separate local sign-in explicit

Hosted notices link to the matching local tab using fixed, typed destinations. They explain that the hosted session and data do not carry over, and show the seeded demo email and local inbox workflow. Local login shows the same guidance only when the verified local configuration supplies the inbox link. The existing authenticated redirect preserves the destination; no automatic login, token forwarding, shared cookies, or hosted record IDs are introduced. Detail links return to the corresponding local collection because the two databases have different records. Desktop/mobile browser checks verify one local session opens all ten workspace tabs.

## ADR-022: Local drafting with independent review stages

Phase 4 follows verified Phase 3 local acceptance and the owner's next-step request. Use a shared browser-safe draft contract and a server pipeline with separate generation, claim extraction/verification and compliance tasks. The local worker dispatches three durable PostgreSQL job stages through BullMQ. Renewable leases, expected versions and an authoritative context checksum fence every publication. A changed source, persona, brand, thread or rule invalidates approval; copying is also gated on current approval. Hosted migration, credentials and runtime remain unchanged.

Retrieve at most eight current included chunks, capped at 24,000 characters, using vector and keyword relevance with a documentation/pricing preference. Exclude sources older than ninety days. The deterministic mock quotes complete supported sentences and independently classifies every final sentence, including user edits. It does not treat keyword overlap as proof. Unsafe claims or participation cannot be approved through either UI or RPC; warnings require acknowledgement and first approval requires responsible-use acceptance.

Persist every edit/restore as a version. Reserve each new generation atomically against the organization's plan; UUID idempotency keys prevent double charging on retries. Failed generations retain their reservation to bound repeated provider attempts. Verification and human edits do not consume another generation unit. Mock usage receipts show zero paid tokens and cost; real-adapter token/cost telemetry uses reported usage and explicitly configured rates. Reddit text is never used for model training.

Advice-only regeneration removes product recommendations while retaining the configured truthful disclosure, including a brand name if that disclosure uses it. The interface says "Advice only (keep disclosure)" so a style control cannot silently remove required affiliation. Autosave and pending edits guard application navigation; supported cancelable Navigation API traversals also guard Back/Forward without rewriting Next.js history.

## ADR-023: Serialize deletion and publication before touching derived content

A shared Reddit post may have drafts in several organizations. Deletion locks affected
organizations in sorted order, then the post and drafts before removing any derived
content. Ingestion, refresh and scheduled retention use the same organization-first
order before shared-row mutations. Draft publication, feedback, edit and lease cleanup
follow organization/draft/job ordering. This prevents a concurrent publication or
feedback insertion from recreating content after the deletion snapshot.

Drafting and approval refuse dismissed/archived opportunities, unrefreshed posts older
than forty-eight hours and posts outside thirty-day retention. Current source evidence
is required again after context changes. A bounded retrieval cache retains only source
IDs under tenant/current-context hashes for five minutes; it never retains thread text
or generated replies. Full thread/rule context is checked, with an explicit size failure
when its bounded request cannot hold all restrictions.

## ADR-024: Scope extension authority to one user and organization

Phase 5 starts after the verified Phase 4 acceptance gates and the owner's next-step request. Processing remains local; neither hosted schema nor hosted worker authority changes. Owners, admins and members may connect their own browser because those roles can review/use drafts. Viewers cannot connect or mutate. Managers can revoke all workspace sessions; members can revoke only their own. Every token request rechecks current membership, plan and organization availability, so changing roles does not leave stale access.

Use cryptographically random 256-bit opaque connection codes and tokens, storing only SHA-256 hashes in PostgreSQL. Codes expire after five minutes, are single-use, and replace that user's previous pending code. Sessions expire after thirty days and bind the configured extension origin. The server generates these values; no signing secret or paid provider key is required. Chrome trusted extension storage retains the bearer for background requests, and logout clears it even if the server is unavailable. A failed remote revoke is explicitly reported. The panel and content adapter never receive that bearer.

The local web bridge uses fixed parameterized SQL inside a transaction after SET LOCAL ROLE to a restricted NOLOGIN role with no table privileges. Only eight narrow private functions are executable; helper functions, Auth tables and general RPCs are not granted. The local PostgreSQL administrator receives SET authority without inheritance. Cookie-authenticated session-management RPCs retain role checks and RLS; browser mutations bind the rendered organization and same origin. Bearer routes refuse cookies, allow only the configured extension origin/ID and never redirect. CORS is not authentication: a valid unexpired token remains mandatory, including when Chrome omits Origin on a background GET.

Public build identity is a checked-in public manifest key and stable extension ID; its ephemeral private key was discarded without writing it. This build has only the fixed loopback API host permission plus activeTab, scripting, storage and sidePanel. No permanent Reddit host permission, browsing-history permission, external messaging, tab listener or automatic content script is used.

## ADR-025: Preserve approval separately from manual delivery receipts

Draft review status remains the Phase 4 approval state. Insertion and self-reported publication have separate timestamps/version fields, so delivery does not invalidate approval or permit an unapproved edit. The extension fetches a fresh approved version immediately before copy/insertion and rechecks the active tab URL before touching a composer. Any edit must be saved, verified and approved again in the web application. The composer adapter writes text only into one recognized empty visible main-frame composer. Changed pages, nonempty/ambiguous/unsupported editors fall back to explicit copy; it never clicks, submits, synthesizes keyboard activity, reads conversation content or contacts Reddit.

DOM insertion and PostgreSQL cannot be atomic. If insertion succeeds but its receipt cannot be recorded, the panel says so and leaves the person's text intact. Publication is an explicit human declaration with a matching comment permalink, not proof from Reddit or an attributed conversion. Repeated identical receipts are idempotent. Source deletion removes the stored comment URL along with existing derived text. A bounded hourly BullMQ cleanup deletes expired credentials; logs contain counts and safe events only.

Use a local synthetic discussion route for fixture post IDs rather than sending users to nonexistent Reddit posts. Browser acceptance loads the real MV3 artifact in an isolated repository-owned profile and asserts zero submit attempts. Live Reddit DOM compatibility and native Chrome toolbar/side-panel presentation remain manual QA, documented before any real-provider activation.

The mock provider's historical permalink spelling (`fixture001`) maps to its stored identifier (`fixture_001`) only in the verified fixture runtime. Real-provider IDs are unchanged. Fixture handoff/history links remain on the local synthetic discussion. Incoming extension API requests require the exact raw Host `127.0.0.1:3000`; the URL check also recognizes Next's internal `localhost` normalization without trusting forwarded headers or accepting another incoming host.

Connection settings returns all authorized active sessions plus only the fifty newest inactive entries. An additive local migration adds the organization/history index and preserves existing RPC grants and role checks. Active revocation controls cannot disappear behind old history, while repeated connect/revoke cycles cannot grow the inactive response indefinitely. Expired tokens fail immediately; physical cleanup remains eventual and bounded.

## ADR-026: Supabase attribution receipts and constrained ingestion (Phase 6)

Phase 6 follows verified local Phase 5 and the owner's request to continue using Supabase. Auth, relational data and private storage remain Supabase; no hosted schema or credential is touched by this implementation. Existing local processing remains the verified target while hosted preference is unresolved. Phase 7 is not included.

A current human-approved draft may produce an allowlisted tracking link. A qualifying redirect records a random click UUID and the hash of a separate 256-bit receipt proof. The browser receives the proof solely to authenticate consented conversion attribution; server conversion keys are separate 256-bit brand-scoped credentials stored only as SHA-256 hashes. Keys are shown once, bounded to five active per brand, and atomically replaceable/revocable. Role, current plan, organization and brand checks run inside Supabase functions. Public ingress uses three fixed statements under a restricted NOLOGIN role; it has no table grants. Management remains cookie-authenticated with origin/organization checks and RLS.

The browser snippet starts without storage or network activity, honors DNT/GPC, scrubs receipt query parameters and persists a host-only cookie only after consent. It never gathers raw IPs, page text, browser fingerprints or arbitrary metadata. HEAD, recognizable previews/bots and prefetches get redirects without click receipts. Every other GET is a new receipt; unique clicks do not claim to identify people. This avoids pretending that privacy-safe receipt counts are person-level analytics.

Idempotency binds brand/event/external ID or a UUID to an immutable normalized payload. Identical replay returns the first receipt; changed details or contradictory identities are rejected. Both transports share currency/precision validation. Server events can arrive late if their occurrence falls inside the click window; browser proofs expire by receipt time. Existing valid duplicate receipts remain retryable without creating new events. Conversion data never trains a model or causes a Reddit action.

The conversion bridge binds its already-serialized event as text before casting to JSONB. PostgreSQL parameter inference would otherwise make the driver's JSON serializer encode it twice. An integration test imports the exact fixed production statement and exercises browser/server delivery with the actual driver.

## ADR-027: Honest analytics and bounded aggregation

Use Supabase-owned event joins for UTC date ranges of at most 90 days, with tenant-authorized brand, community, opportunity, event, intent, competitor and final-style drilldowns. Preserve currencies separately; only purchase values contribute attributed revenue. Rates use distinct attributed click receipts and display no rate when the denominator is absent. Funnel stages describe period activity rather than a conversion cohort; the UI explicitly avoids causal claims.

Conversation labels are resolved from authorized Supabase summaries. Report rows outside the recent filter choices receive a bounded tenant-scoped lookup, so historical analytics do not expose raw database IDs as navigation labels.

Growth gates competitor/style analytics at the RPC boundary, including cached reads. Clients cannot read the raw cache table. A bounded minute-based BullMQ job refreshes five stale organization snapshots with duplicate-safe IDs and bounded retries. Writes invalidate cache; stale/filtered reads compute fresh reports. This trades a small number of live queries for accurate totals during queue delay, while keeping the redirect outside the dashboard aggregation path.

Local acceptance uses the reserved ClarityScale fixture destination and the real compiled snippet, consent control, PostgreSQL click/conversion records and dashboard. It never seeds fabricated customer revenue: the seed initializes only synthetic organization settings, and a person or explicit browser test generates demo actions. The standard demo is a signup and USD 99 purchase; duplicate delivery must leave one purchase. Hosted migrations, live customer-domain installation and real-provider ingestion are separate verification boundaries.

Browser acceptance runs one worker because journeys share global synthetic Reddit posts and community rules. Parallel refreshes can legitimately invalidate another journey's reviewed draft. Serial browser execution preserves the production stale-context guard; isolated database/queue tests retain their explicit duplicate-delivery and concurrency coverage.

The all-tabs navigation journey uses a disposable local identity/workspace, then signs out and back in to verify the requested destination. Repeated suite runs must not exhaust a shared seeded viewer's real sign-in budget. The seeded role matrix remains separate; authentication limits and Redis state are not weakened or broadly reset.

## ADR-028: Supabase billing authority and explicit mock checkout

Phase 7 follows verified Phase 6 acceptance. Keep the existing organization locks and atomic resource reservations as the authority for plan capacity. Checkout requests, subscription periods and billing-event receipts live in Supabase PostgreSQL. Plan changes preserve customer data and already-consumed usage; changing plans cannot reset an active paid period. Payment failures retain the existing allocation for a three-day grace period, after which new gated work stops. Cancellation takes effect at period end. Mock renewals advance anchored periods without rewriting usage history; Stripe periods come only from the verified provider snapshot.

Only an owner may request checkout or portal access. Local mock confirmation and lifecycle mutations require the restricted server bridge with a verified user subject; authenticated Supabase clients cannot directly grant mock entitlements. The bridge has fixed statements and no table access. Workspace, origin, role, provider and request checks run before changes. Billing summaries show sensitive customer identifiers and billing email only to the owner.

Stripe Checkout handles first subscriptions; existing active subscriptions use the Billing Portal to avoid duplicate paid subscriptions. Return URLs never activate a plan. Verify the exact raw webhook payload, timestamp and signature, then retrieve the current provider subscription under an organization advisory lock. Bind initial or replacement subscriptions to the exact registered Checkout session, keep stable event identity hashes, and reject stale or contradictory identities. A delayed verified payment may reconcile an expired local checkout request; an expired request cannot create a new provider session. The adapter pins Stripe's 2026-08-26.dahlia API and validates the configured USD monthly prices against the central plan catalog.

## ADR-029: Durable, preference-aware notification delivery

Supabase records notification preferences per member and organization, plus an outbox with unique event keys, renewable ownership tokens, delivery outcomes and bounded retries. BullMQ carries only the delivery ID. PostgreSQL rechecks membership, the organization timezone, category settings, score, current source generation, plan and quiet hours before dispatch. Digest delivery is limited to one organization-local date per member. Lifecycle messages are suppressed when their reason no longer applies.

The worker makes at most three delivery attempts, with exponential retry delays. A 23-hour retry boundary fits within Resend's 24-hour idempotency retention. A hash binds the recipient and rendered context across retries; changed context is suppressed instead of reusing an idempotency key for a different message. No recipient, message body or provider error payload enters logs, queue data or delivery history. Emails contain safe counts and application links rather than Reddit text. Every template links to authenticated notification preferences, where all categories can be disabled. Invitation notices in the outbox go to the inviter; the existing invitation workflow retains its transient private acceptance link and stored token hash.

## ADR-030: Phase 7 provider verification and activation boundary

Implement Stripe and Resend adapters with injected transports and signed fixtures, but preserve mock billing, console email and the existing isolated Supabase runtime. No real payment, external email, existing credential or hosted database is used by Phase 7 verification. Local console delivery is recorded as suppressed, never as an email sent. The hosted bootstrap explicitly excludes the new migrations. Real-provider activation requires a separately reviewed runtime profile, migration and live test; changing an environment variable alone does not bypass current local-provider guards. Phase 8 is not started.

## ADR-031: Audited platform operations with independent Supabase authority

Phase 8 follows the owner’s request after Phase 7 local acceptance. Platform administration is separate from organization ownership: only a database-provisioned `profiles.is_platform_admin` identity may use the internal console. Neither onboarding, organization roles, user metadata nor demo seed grants this flag. Server-verified Supabase sessions and authenticated SQL checks protect every read and mutation. Metadata views omit emails, document/reply contents, token hashes, provider payloads and billing identities. Reads of customer metadata and control changes create private, safe audit records. Ordinary workspace activity uses a separately tenant-scoped cursor feed.

Retries accept an enumerated reason and UUID idempotency key, recheck terminal state and current source/generation/plan conditions, and preserve consumed usage and notification delivery identity. One manual retry per original job bounds repeated failed work. Pause/resume uses the existing suspended state and organization-first locking; ingestion and publication must recheck it. Privacy cleanup remains possible for a deleted organization. No platform-admin account is automatically granted to an existing user.

## ADR-032: Explicit privacy execution and revocable private exports

Historical export/deletion requests remain nonexecuting until a fresh owner action. A confirmed export creates a durable privacy job and a bounded gzip JSON artifact in Supabase private storage. Explicit field allowlists exclude credential hashes, provider billing identifiers, vectors and shared Reddit post bodies; customer records and original uploaded files are included. An oversized export fails rather than silently truncating. Downloads use current owner authorization, Storage RLS, artifact integrity checking and a final authorization recheck. No long-lived bearer download URL is created. Artifacts expire after 24 hours and can be revoked sooner.

Deletion requires the exact current workspace slug and explicit UI acknowledgement. Confirmation disables the organization and revokes sessions, conversion keys and tracking links before asynchronous cleanup. The worker removes object bytes through Supabase Storage before cascading tenant records. It retains a minimal ID-only completion receipt for 30 days and leaves Auth identities and other organizations intact. Leases, bounded batches, retries, orphan-file sweeps and audited operator retries handle the database/Storage transaction boundary. Existing active Stripe billing blocks deletion until canceled; no hidden external cancellation occurs.

## ADR-033: Measured hardening without claiming external launch verification

Use a fresh request nonce for document CSP, exact same-origin mutations, bounded authenticated Redis rate limits, strict runtime schemas and safe structured operation metrics. External Sentry/OpenTelemetry sinks remain optional; local counters do not imply cross-process monitoring. Public pages describe implemented local functionality and label synthetic examples honestly. Dependency auditing queries only public npm and runs as a CI gate. Local tests use isolated browser contexts, disposable identities and Supabase-backed fixtures. Existing hosted gates, local-only bridge credentials and the unavailable live crawler are documented deployment prerequisites; no provider, hosted migration, deployment, commit or push is activated by this phase.

## ADR-034: Preserve restricted knowledge-worker authority during lifecycle fencing

The Phase 2 restricted knowledge worker retains no organization-table privileges. Phase 8’s pause/deletion locking is exposed through two narrowly granted, fixed-search-path helpers: a job-bound organization lock returning eligibility, and a bounded dispatch list returning existing job IDs/attempt counts. Local verification applies an additive migration. An existing hosted worker must receive the separately reviewed additive guard operation before it can start with this code; startup checks fail clearly until that prerequisite is applied. No hosted operation or role change is performed by local acceptance.

## ADR-035: Explicit deployment profiles with checked runtime authority

The final specification audit adds an opt-in deployment profile instead of widening the isolated local launcher or the frozen personal Phase 2 profile. Web and worker validate their own Supabase project, HTTPS application origin, restricted database identity, verified PostgreSQL TLS and managed Redis TLS. A startup catalog check rejects unexpected role membership, table/column grants, function execution or RLS authority. Operator provisioning is separate from application migrations; role templates initially have NOLOGIN and contain no passwords. The web login may enter only three fixed-statement API roles and has no application-table access itself. The worker has bounded application-data authority without Auth identities, invitation hashes or direct approval authority. Its private Storage key never enters web configuration.

Real provider factories are reachable only through this validated, explicitly approved deployment profile. Local development remains mock/fixture/console. The existing personal hosted Phase 2 profile remains unchanged and does not acquire later-phase permissions. An HTTPS extension profile creates a separate artifact tied to a validated public Chrome key/ID and exact application origin; the default artifact retains its local fixture target. Configuration and transport tests establish implementation, not deployment or live-provider verification.

## ADR-036: Guarded website discovery and explicit product review

The simple crawler uses public-address validation, DNS pinning, redirect-by-redirect checks, robots rules, bounded transport, same-site selection and deterministic extraction. It refuses Reddit domains and cannot serve as a Reddit scraping fallback. Website preview fetches only the approved home page and its candidate links; durable workers crawl the explicit selected pages within plan limits. Arbitrary provider output is never accepted as trusted product fact.

Guided onboarding derives its progress from authorized Supabase records rather than a client completion flag. Product extraction proposes only source-backed profile fields, shows exact supporting quotes and requires human selection plus a separate save. Evidence checksums are rechecked after generation, on application and on save. Extraction cannot replace affiliation, disclosure or approved links. Feed workflow labels derive from saved drafts/publication receipts under RLS; they are display/filter data and never grant approval or publication authority. The feed reads a generated 500-character excerpt while the detail page retains the full body.

## ADR-037: Honest AI accounting, embedding identity and bounded retention

AI usage receipts are isolated by asynchronous operation. All supported embedding, suggestion, extraction, evaluation and drafting tasks record organization/task usage; unknown provider token counts or prices remain NULL and operations reporting identifies incomplete totals. Mock operations record deterministic zero cost. Receipts contain no prompts, documents, replies or raw provider errors. General operations use a unique attempt UUID and a restricted helper that validates organization/brand pairing and the server-verified user scope for web calls. The frozen personal Phase 2 profile does not use this later migration.

Knowledge vectors carry their embedding provider/model/dimension identity. Retrieval filters by that identity and re-ingestion rebuilds vectors when identity changes even if source text is unchanged. This prevents comparing unrelated model spaces. Invitation maintenance deletes at most 100 terminal records per sweep after 30 days; live/recent invitations remain and expiration denies use independently of eventual physical cleanup.

## ADR-038: Rehearse from a disposable source snapshot without resetting existing data

The final audit clean-room harness copies the current source into ignored `.audit/`, with a SHA-256 manifest and no private dotenv, credentials, caches, generated artifacts or symlinks. It installs from public npm and creates its own repository-local Colima state. Original services stop only after dependency preparation; their volumes are retained. Only the snapshot database is reset/seeded. Success and failure both attempt snapshot shutdown and original service restoration/health checks. Explicitly reported outside temporary paths fail verification. This does not erase the historical Phase 0 Lima isolation exception or authorize outside inspection. Full execution evidence, rather than harness unit tests alone, determines acceptance.

On macOS, the nested snapshot uses shorter `.lima` and `.colima` directories, while the original service paths remain unchanged. Preflight checks include Lima's temporary SSH suffix and Colima's Docker/containerd forwarding sockets. A failed rehearsal can resume only after matching owned manifests, verifying every previous source hash and rejecting unknown source files. Resume refreshes reviewed source and reruns all gates; it preserves downloaded public dependencies and prior failure logs in numbered evidence directories. It does not represent those reused dependencies as another fresh download.

## ADR-039: Admit provider work from current Supabase authority and retain draft attempt costs

Step 13 checks the authenticated Supabase subscription before web AI calls and real website preview. Database-derived eligibility includes trial expiry, payment grace and organization availability; UI state and process clocks do not grant access. The frozen personal Phase 2 profile stays mock-only and keeps its earlier schema contract.

Draft publication and cost recording have different lifetimes. A failed or stale attempt may already have incurred a provider charge. Private bounded receipts keyed by draft job/attempt and lease identity now feed one aggregate public usage record per job. Only the worker receipt function can write them; user clients cannot access the private table. Duplicate delivery does not add cost twice, conflicting receipts fail, and missing/unknown usage keeps totals unknown. Deletion cascades with the owning job. A provider charge followed by a process/database failure remains a nontransactional boundary; no historical receipt is invented. This does not introduce automatic Reddit actions or a new paid provider.

## ADR-040: Version the source release without claiming hosted launch acceptance

The owner explicitly requested release preparation, a commit and a GitHub push after Step 13. Use `0.1.0` consistently across the root, private workspaces and the unpublished extension manifest; the prior manifest's `0.5.0` was development metadata, not a Web Store release. Preserve all provider defaults and hosted gates. Add the changelog to the clean-room source allowlist so future rehearsals retain the release record.

The release commit uses the build prompt's `feat: complete ThreadSignal MVP` message, with its body documenting local verification and outstanding external checks. Do not create `v0.1.0` while full release acceptance remains open. GitHub publication targets only the existing personal `harsh2512g/reddgrow` repository; it does not authorize a deployment, provider activation, unrelated credential access or use of machine-wide Git credentials.

## ADR-041: Distinguish Vercel build installation from local runtime isolation

The owner reported pushing the source release and beginning a Vercel deployment, which the local-only preinstall guard rejected. Accept Vercel's build-time markers only for preview/production dependency installation, reject any simultaneous local-runtime flag, and retain public-npm checks. A generic CI flag alone does not bypass local installation policy. This environment guard is configuration validation, not authentication.

Keep Vercel configuration under `apps/web`, use Corepack's pinned pnpm version and the frozen workspace lockfile, and compile the web dependency graph through `build:web`. Direct pnpm recursion preserves the hosting environment and rebuilds Next without reusing Turbo's locally configured web artifact. Include the repository in Next server-file tracing. Neither the local launcher nor local Supabase/Redis configuration belongs in Vercel. The existing approved deployment profile and restricted runtime/worker provisioning remain mandatory and unchanged; no hosted credentials are discovered, migrations applied or provider gates relaxed by this install fix.

Vercel follow-up: the owner reported a successful 12.4.1 install followed by Corepack selecting 12.2.1 for the build. Keep Corepack in the working install command, but invoke `pnpm` directly for the build and print its version before compilation. Both manifests retain their 12.4.1 pin and strict package-manager checks remain enabled. This removes the explicit second Corepack selection from the build; local verification cannot establish the executable on a remote Vercel PATH, so the next hosted build must confirm the logged version.
