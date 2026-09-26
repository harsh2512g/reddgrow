# ThreadSignal

ThreadSignal is an independent, compliance-first Reddit opportunity platform using Supabase for Auth, PostgreSQL, pgvector and private storage. It connects brand knowledge, scored opportunities, evidence-backed drafts, manual Chrome handoff, attribution, billing and privacy controls. A person always performs Reddit's final submit action. The final specification audit adds guided setup, reviewed product extraction, a guarded website crawler and explicit deployment profiles. Local providers remain mock/fixture/console.

See the [delivery guide](docs/final-delivery.md), [specification matrix](SPEC_COMPLIANCE_MATRIX.md), and [audit verification](docs/audit-verification.md) for implementation coverage, exact checks and external limitations. A deployment or overall completion claim depends on the recorded results, not this overview.

The initial source release uses version `0.1.0`. See the [changelog](CHANGELOG.md), [Step 13 review](docs/step-13-review.md) and [release record](docs/step-14-release.md) for the latest fixes, checks and publication status. Hosted launch and live-provider acceptance remain separate.

## Local setup

Use a supported Node.js runtime (Node 24 is the project target), Colima, and the Docker CLI. Docker Compose is not required: the guarded Redis launcher reads `docker-compose.yml` and uses native Docker CLI operations against the project's Colima context. No cloud account or provider credential is needed. No tool is installed globally by these commands.

From this repository:

```bash
./scripts/local doctor
./scripts/local bootstrap
./scripts/local pnpm install --frozen-lockfile
./scripts/local pnpm services:start
./scripts/local pnpm db:migrate
./scripts/local pnpm seed
./scripts/local pnpm db:types
./scripts/local pnpm dev
```

Open `http://127.0.0.1:3000`. Sign in with a synthetic email and open its magic link from the local inbox at `http://127.0.0.1:54324` in the same browser. Seeded `owner@threadsignal.test`, `admin@threadsignal.test`, `member@threadsignal.test`, and `viewer@threadsignal.test` demonstrate team permissions; `outsider@threadsignal.test` belongs to a separate organization. No password or external mailbox is needed. The development command builds shared dependencies, then starts the web application, worker and TypeScript watchers. Private packages expose generated `dist/index.js` runtime entrypoints and `dist/index.d.ts` types. The worker health endpoint is `http://127.0.0.1:3001/api/health/ready`.

Use `./scripts/local pnpm` in place of a bare machine-level pnpm command. The launcher clears inherited environment values before Node starts, uses public npm and repository-local caches, and never loads the existing `.env.local`. `.env.example` files contain variable names only; local defaults are supplied by code:

```env
REDDIT_PROVIDER=mock
AI_PROVIDER=mock
EMAIL_PROVIDER=console
BILLING_PROVIDER=mock
CRAWLER_PROVIDER=fixture
```

Real-provider secrets are not required in these modes. The local launcher cannot activate external product providers; Google sign-in is disabled locally. Separately approved deployment profiles are implemented and documented, but have not been live-tested.

For the separately configured personal Supabase project, follow [hosted development setup](docs/hosted-supabase.md). `./scripts/local pnpm dev:hosted` starts only the web application at `http://localhost:3002`; local development and its data remain at `http://127.0.0.1:3000`. Apply the reviewed hosted schema and configure Auth redirects before the first hosted signup. The public connection profile is ignored by Git; existing dotenv files remain unused.

Processing stays local. Open `/app/brands`, create a brand using **Use synthetic demo**, approve its fixture pages, then select communities and keywords. Open `/app/opportunities` to review automatically scored discussions, generate a draft, then review and edit it under `/app/drafts`. Connect the Chrome extension from **Settings → Integrations** to practice inserting an approved reply. See the [drafting guide](docs/phase-4-development.md) and [extension setup](docs/extension.md). The hosted Phase 2 schema has been migrated and verified, but hosted worker credential creation awaits explicit approval; its application gate remains off. Hosted Phases 3–8 have not been migrated or enabled. Supabase remains the backend for both independent environments. For Tracking and Analytics, consented demo purchases and the server conversion API, see the [attribution guide](docs/phase-6-development.md). For **Plan & usage** and **Notifications**, see the [billing and notification guide](docs/phase-7-development.md).

For **Activity**, private data controls and the restricted internal console, see [Phase 8 development](docs/phase-8-development.md). Review [deployment prerequisites](docs/deployment.md), [security](docs/security.md) and [operations](docs/operations-runbook.md) before hosted activation.

## Verification

```bash
./scripts/local pnpm lint
./scripts/local pnpm format:check
./scripts/local pnpm typecheck
./scripts/local pnpm test
./scripts/local pnpm build
./scripts/local pnpm extension:build
./scripts/local pnpm services:health
./scripts/local pnpm db:lint
./scripts/local pnpm test:integration
./scripts/local pnpm exec playwright install chromium
./scripts/local pnpm test:e2e
./scripts/local pnpm test:extension
./scripts/local pnpm secrets:check
./scripts/local pnpm audit --audit-level=high
```

Stop the development command before integration/E2E tests so their dedicated web/worker processes can own the local ports. Integration tests require running project services and fail when they are unavailable. Browser smoke tests exercise the production web build in fresh browser profiles. Authenticated journeys require the verified local services; they are explicitly skipped in the hosted static CI job and run in the Colima service job.

After verification, stop development with Ctrl-C, then stop only this project's services:

```bash
./scripts/local pnpm services:stop
```

Local data is retained. `db:reset` resets only the verified ThreadSignal local database. Only synthetic local Supabase sign-in is part of this workflow. No external login, deployment, commit, or push is performed.

The GitHub Actions workflow defines a hosted quality/browser job and a separate integration job for a dedicated personal Colima runner. Neither job was executed remotely during Phase 0; remote CI verification and personal runner provisioning remain separate from the local results.

See [local development](docs/local-development.md), [architecture](docs/architecture.md), [phase map](docs/build-plan.md), [credential boundaries](docs/credential-matrix.md), [extension instructions](docs/extension.md), and [implementation status](IMPLEMENTATION_STATUS.md).
