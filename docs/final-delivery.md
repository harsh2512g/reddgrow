# ThreadSignal audit delivery

This is the delivery guide for the final specification audit after Phase 8. Supabase supplies authentication, PostgreSQL, pgvector and private storage. The repository contains the Next.js customer/marketing application, BullMQ worker, manual-only Chrome extension, shared providers, migrations, fixtures and tests. The new audit work closes onboarding, crawler/runtime configuration, API, usage-accounting and retention gaps. [The compliance matrix](../SPEC_COMPLIANCE_MATRIX.md) maps the specification to implementation; [verification](audit-verification.md) records executed checks and failures. Neither this guide nor passing local tests authorize a deployment.

## Local setup and demo account

With the approved Node, Colima and Docker tools available, run from this repository:

```bash
./scripts/local doctor
./scripts/local bootstrap
./scripts/local pnpm install --frozen-lockfile
./scripts/local pnpm services:start
./scripts/local pnpm db:migrate
./scripts/local pnpm seed
./scripts/local pnpm dev
```

Open `http://127.0.0.1:3000`. Use a synthetic address such as `owner@threadsignal.test`, request a magic link, and open its message at `http://127.0.0.1:54324` in the same browser. No password or external mailbox is needed. The seeded owner/admin/member/viewer identities demonstrate different permissions; `outsider@threadsignal.test` belongs to a separate organization. The seeded owner already has a workspace and brand. To try fresh onboarding, sign in with a new synthetic address, enter an organization name, slug and billing email, accept responsible use, and click **Create workspace** to open guided setup.

The six setup steps derive from saved Supabase records. Create a brand with **Use synthetic demo**, select its fixture website pages, wait for included knowledge, review suggested product fields with their evidence, explicitly save chosen changes, and add communities/keywords. The worker imports invented posts and produces scored opportunities. Open a high-score opportunity, generate a draft, inspect sources/compliance, edit and verify, then explicitly approve. The extension can copy/insert it into the local fixture composer; it never submits. Continue with a tracked link, consented signup/purchase and analytics, then review mock billing limits. The browser tests automate Journeys A–E and the manual-only extension flow. Detailed instructions: [knowledge](phase-2-development.md), [opportunities](phase-3-development.md), [drafts](phase-4-development.md), [tracking](phase-6-development.md), [billing](phase-7-development.md).

## Environment and migrations

Names-only `.env.example` files document configuration. The isolated launcher never loads existing `.env.local` or inherited provider credentials. Its defaults are Reddit/AI/billing `mock`, email `console`, and crawler `fixture`. Secrets are unnecessary for the local demo. Keep any separately approved personal configuration in ignored owner-only files, never chat or source control.

`db:migrate` applies additive local migrations without resetting existing records. `db:types` regenerates checked-in Supabase public types. Applied migration files are immutable. Use `db:reset` only for an explicitly disposable, verified local database: it deletes that target's data. The [clean-room harness](cleanroom-verification.md) performs the reset against its separate source snapshot and service stack, preserving the original volumes. Hosted migration, backup and role provisioning are separate authorized operations; see [deployment](deployment.md), [database roles](deployment-database-roles.md), and [backup/restore](backup-restore.md).

## Web, worker and extension deployment

[Deployment instructions](deployment.md) define the explicit profile, project binding, HTTPS/TLS requirements, runtime environment, build/entrypoints and rollout/rollback checks for both applications. [Restricted role provisioning](deployment-database-roles.md) explains the distinct web and worker authorities. The web receives no Storage secret; the worker uses a separate private Storage credential. Startup checks reject unexpected database privileges. This code has not been deployed, and deployed TLS, egress, provider behavior and external monitoring remain unverified.

Build the development extension with:

```bash
./scripts/local pnpm extension:build
```

In a personal Chrome profile, open `chrome://extensions`, enable Developer mode, and load `apps/extension/dist` unpacked. Connect explicitly from **Settings → Integrations**. Follow [extension instructions](extension.md) for short-lived connection codes, revocation, fixture insertion, and the distinct HTTPS public-profile build. The deployment artifact uses its configured application origin/Chrome ID and contains no local fixture access. No Web Store upload or existing browser session is required by local automated tests.

## Stripe test and approved Reddit configuration

Local billing is fully mock and collects no card. For a separately authorized personal staging environment, select the validated deployment profile and configure Stripe **test-mode** secret, webhook secret and Solo/Growth price IDs outside source control. Follow the exact adapter/API-version, USD monthly price and portal requirements in [billing setup](phase-7-development.md) and [deployment](deployment.md). Configure the webhook endpoint there, then verify Checkout completion, signed duplicate/stale webhooks, portal changes, cancellation and payment recovery against that environment. A browser return URL never grants a plan. No external Stripe test payment has been performed by this audit.

Approved Reddit activation requires the owner's access approval and fresh personal application configuration. Recheck current official terms first; set the documented OAuth provider and commercial-approval flag only in the explicit deployment profile. The read-only factory is implemented, so activation does not require changing product code. Verify rate-limit/authorization pauses, deletion sync and real thread metadata in that separately authorized environment before enabling ingestion. Never substitute a scraper, another account or a proxy when permission is absent. See [provider contract](phase-3-provider.md), [deployment](deployment.md) and [responsible use](responsible-use.md). Live Reddit and native editor compatibility remain unverified.

## Results, limits and enforcement

[Audit verification](audit-verification.md) contains exact lint, format, typecheck, unit, integration, E2E, build, extension and clean-room results, including failed attempts. Historical phase results are preserved separately. Local checks cannot establish remote CI/Node 24 execution, hosted operation, Google OAuth, external email/payment/AI/Reddit operation, monitoring delivery or production performance. The earlier Phase 0 Lima temporary-path isolation exception remains documented; no outside files were inspected or cleaned up.

Future roadmap features in specification §23—CRM/Slack sync, agency/white-label workspaces, other community platforms, public APIs/MCP and AI-search tracking—remain outside this MVP task. Missing live verification is an external release prerequisite, not a claim that those integrations have been exercised.

The full [guardrail-to-code map](responsible-use.md) covers manual submission, read-only Reddit authority, truthful identity/disclosure, evidence requirements, no training/scraping fallback/anti-detection, deletion and honest marketing. The extension regression suite asserts zero final-submit attempts. [Security](security.md), [privacy flow](privacy-data-flow.md), [operations](operations-runbook.md) and [incident response](incident-response.md) document the remaining operational boundaries.
