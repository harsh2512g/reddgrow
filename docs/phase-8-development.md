# Phase 8 development and review

Supabase remains the sole Auth, PostgreSQL and private-storage backend. This profile uses the repository-owned local Supabase and Redis services under Colima. Hosted processing and real product providers remain disabled. No commit, push or deployment is part of this phase.

## Review the application

Open `http://127.0.0.1:3000`. Use the existing local magic-link workflow and project-local inbox described in [local development](local-development.md).

- **Activity** shows paginated, tenant-authorized operational history without document text or credential metadata.
- **Organization → Your organization, your data** lets the current owner create an export, refresh processing status, download a private gzip JSON archive, or revoke it. Archives include allowlisted customer records and original uploaded files encoded as base64. They expire after 24 hours. Secrets, credential hashes, provider billing identifiers, vectors and shared Reddit post bodies are excluded.
- Deletion requires reviewing the consequence, entering the exact workspace slug, and checking the acknowledgement. This immediately disables the organization and schedules permanent file/record removal. It preserves the login account and other organizations. Export needed data first. Historical deletion-review requests are never executed automatically.
- `/internal/admin`, `/internal/admin/jobs`, `/internal/admin/providers` and organization detail require an independently provisioned platform administrator. Organization owners are not platform administrators.

No existing account is granted platform-admin access automatically. For local operator review, the owner may use the verified local Supabase SQL editor to select the intended synthetic/local user's UUID and set that profile's `is_platform_admin` flag. Revoke it after review. Never change this flag through browser user metadata or a customer-facing endpoint. Automated browser tests grant and remove the flag only on their disposable test identity.

Admin views contain safe metadata and actual Supabase job counts. They are not Redis queue-depth graphs or a claim that external providers are healthy. Platform metadata reads and control changes are audited. Failed jobs are retryable only when their current lifecycle permits it; one manual retry per original job, within 90 days, preserves usage reservations and notification identity. Paused organizations cannot ingest or publish new work; cleanup remains available.

## Commands

Always run from the repository root through the isolated launcher:

```sh
./scripts/local pnpm install --frozen-lockfile
./scripts/local pnpm services:start
./scripts/local pnpm db:migrate
./scripts/local pnpm db:types
./scripts/local pnpm seed
./scripts/local pnpm dev
```

`db:migrate` preserves records. `db:reset` is destructive and is only appropriate for an explicitly disposable database. Do not reset an existing workspace to run a regression test. All generated caches, logs and browser profiles belong inside ignored repository directories.

```sh
./scripts/local pnpm lint
./scripts/local pnpm format:check
./scripts/local pnpm typecheck
./scripts/local pnpm test
./scripts/local pnpm test:integration
./scripts/local pnpm build
./scripts/local pnpm test:e2e
./scripts/local pnpm extension:build
./scripts/local pnpm test:extension
./scripts/local pnpm db:lint
./scripts/local pnpm secrets:check
./scripts/local pnpm audit --audit-level=high
./scripts/local pnpm services:health
```

Stop the development server before integration/browser commands that start their own worker/web listeners. Keep integration fixtures separate from an actively dispatching development worker. Tests create disposable identities and organizations; they never grant platform access to the seeded demo account.

## Local hardening and launch boundaries

Document CSP uses a fresh nonce, which requires dynamic rendering. Production script policy permits neither arbitrary inline scripts nor eval. Development permits eval for the framework toolchain. Existing safe style attributes remain supported. Mutations require trusted origin and runtime validation; rate limits fail closed if the owned Redis service is unavailable.

Provider HTTP metrics expose fixed provider names, request outcomes and latency, never URLs, payloads, keys or customer contents. Default counters are process-local. External monitoring exporters and alert destinations require separate configuration and verification.

Read [deployment](deployment.md), [security](security.md), [operations](operations-runbook.md), [backup/restore](backup-restore.md) and the [release checklist](release-checklist.md) before considering hosted activation. Current local-only bridges, the unavailable live crawler and hosted phase gates are real code prerequisites; credentials alone do not enable production. Live Reddit must remain disabled without explicit approved commercial access. Extension insertion never submits a Reddit comment.
