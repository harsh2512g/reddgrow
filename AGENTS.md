# ThreadSignal Repository Instructions

## Strict personal-project isolation

ThreadSignal is an independent personal project. It must never use, inspect,
modify, or depend on any Gofynd or office-owned resource.

The coding agent must not:

- Read or use existing office SSH keys, credentials, tokens, certificates,
  browser sessions, Keychain entries, environment files, or secrets.
- Read or use ~/.aws, ~/.azure, ~/.config/gcloud, ~/.kube, ~/.orbstack,
  office Docker contexts, office npm configuration, or office cloud profiles.
- Use Gofynd, Fynd, Pixelbin, or another employer account, email, domain,
  repository, registry, VPN, API, database, infrastructure, or subscription.
- Reuse any existing Supabase, OpenAI, Stripe, Vercel, Redis, Reddit,
  monitoring, storage, or deployment key.
- Run gh, aws, gcloud, az, kubectl, orb, or deployment/login commands unless
  the user explicitly confirms that a new personal configuration is active.
- inspect files outside this repository except standard public development
  tools that the user has explicitly approved.

Use only:

- Project-local configuration
- Newly created personal accounts
- ThreadSignal-specific credentials
- REDDIT_PROVIDER=mock
- AI_PROVIDER=mock
- EMAIL_PROVIDER=console
- BILLING_PROVIDER=mock

Before performing any login, deployment, cloud operation, credential
creation, or external write, stop and ask for explicit confirmation.

Never print, log, commit, or copy secret values.

## Source of truth

- Read `threadsignal_master_build_spec.md` before making architectural or product changes.
- Sections 0, 20, 21, and 22 of the specification have highest priority.
- Build the MVP phase by phase. Do not start a later phase until the current phase's acceptance criteria pass.
- When a small detail is missing, make a sensible production-quality decision, document it in `DECISIONS.md`, and continue without reducing the core scope.

## Product identity

ThreadSignal is a compliance-first Reddit lead-opportunity platform for SaaS companies. It learns a product from verified company sources, identifies high-intent public conversations, creates transparent and evidence-backed reply drafts, requires a real person to review and publish manually, and reports clicks, signups, purchases, and attributed revenue.

## Non-negotiable guardrails

Never implement:

- Automatic submission of Reddit comments
- Automatic voting or direct messages
- Automatic account creation
- Karma farming or fake account warmup
- Simulated reading, typing delays, fake mistakes, or anti-detection behavior
- Proxy rotation or browser fingerprint evasion
- Hidden multi-account control
- Fake testimonials, experiences, or identities
- Undisclosed employee/founder recommendations
- Reddit scraping as a fallback when approved API access is unavailable
- Training models on Reddit content
- Storage of Reddit passwords
- Guarantees of account safety, rankings, or AI citations

The extension may insert or copy a draft, but it must never click or trigger Reddit's final submit action.

## Required architecture

- pnpm monorepo with Turborepo
- Next.js App Router, React, strict TypeScript, Tailwind CSS, shadcn/ui, Zod, React Hook Form
- Supabase Auth, PostgreSQL, pgvector, private object storage, SQL migrations, generated database types
- No Prisma
- Node.js worker with BullMQ and Redis
- Provider abstractions for Reddit, AI, crawler, email, and billing
- Vitest, Testing Library, and Playwright
- Pino structured logging, Sentry-compatible error hooks, OpenTelemetry-ready tracing

## Local provider defaults

Local development must work without paid credentials:

```env
REDDIT_PROVIDER=mock
AI_PROVIDER=mock
EMAIL_PROVIDER=console
BILLING_PROVIDER=mock
```

Do not request production secrets in chat. Put variable names and safe examples in `.env.example`; the human owner will add real values outside source control.

## Engineering rules

- Use strict TypeScript and avoid `any`; justify any unavoidable exception locally.
- Validate all untrusted input at runtime with Zod or an equivalent schema.
- Enforce organization isolation server-side and with PostgreSQL RLS where applicable.
- Never rely only on hidden UI controls for authorization or plan limits.
- Keep service-provider code behind interfaces so mocks and real providers share contracts.
- Make jobs idempotent, retry-safe, observable, and safe against duplicate delivery.
- Make webhook handlers verify signatures and handle repeated events idempotently.
- Use private storage for customer knowledge files.
- Apply SSRF protections to crawler URLs and block local/private network targets.
- Store API tokens and connection secrets hashed or encrypted as appropriate.
- Do not expose Supabase service-role, Stripe secret, Reddit secret, or AI keys to browser bundles.
- Implement loading, empty, success, validation, permission-denied, and failure states for core screens.
- Do not leave unresolved TODOs, mock-only UI, or static placeholders in core customer flows.
- Do not add fake testimonials, customer counts, revenue, or performance metrics to the marketing site.

## Working protocol

Before modifying code:

1. Read this file, the master specification, `IMPLEMENTATION_STATUS.md`, and `DECISIONS.md`.
2. Inspect the current Git status and relevant files.
3. State the current phase and its measurable acceptance criteria.

During work:

1. Keep changes within the current phase unless a prerequisite is essential.
2. Add or update migrations, generated types, tests, fixtures, documentation, and seed data together with the feature.
3. Update `IMPLEMENTATION_STATUS.md` as evidence is produced.
4. Record material architecture decisions in `DECISIONS.md`.

Before declaring a phase complete, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also run relevant integration/E2E/extension commands for the phase. Run `pnpm extension:build` for extension changes. Do not call a phase complete if any required check fails.

## Reporting format after each phase

Return:

1. What was implemented
2. Important files and migrations changed
3. Commands executed and exact results
4. Acceptance criteria with evidence
5. Manual verification steps
6. Known external integrations not live-tested because credentials are absent
7. Remaining risks or blockers
8. Whether the phase is ready for review

Do not advance to the next phase automatically. Do not commit or push unless explicitly requested.
