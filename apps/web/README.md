# ThreadSignal web application

The preserved Next.js App Router application includes accounts, organization onboarding, team roles/invitations, trials, and settings. Phase 2 adds local brand profiles, private knowledge uploads, fixture website ingestion, source previews, and evidence search. Opportunity monitoring, drafting, analytics, and payments remain later-phase work.

Run commands from the repository root through the isolated launcher. See the root README and local-development documentation for Colima setup.

```sh
./scripts/local pnpm services:start
./scripts/local pnpm dev
```

Open `http://127.0.0.1:3000`. Sign in with a synthetic email, then open the newest magic link in the project inbox at `http://127.0.0.1:54324`, using the same browser. Seeded owner/admin/member/viewer accounts are documented in `docs/phase-1-database.md`. The launcher supplies fixed provider modes and generated local Auth configuration; existing dotenv files and external accounts remain unused.

## Routes and authorization

- `/`, `/pricing`, `/security`, `/privacy`, `/terms`: public information; pricing derives from central plans. Terms/privacy are clearly marked local-development drafts.
- `/login`, `/auth/callback`: email magic-link sign-in and PKCE exchange. Google OAuth code is guarded and disabled locally.
- `/app`: verified-session workspace overview with actual membership/plan records.
- `/app/brands`, `/app/brands/new`, `/app/brands/[id]`: organization-scoped brand creation, review, editing, and archiving.
- `/app/knowledge`, `/app/knowledge/[id]`, `/app/knowledge/search`: private sources, extraction status, inclusion controls, retries, deletion, and search with source metadata.
- `/app/onboarding`: atomic organization/owner/trial creation after responsible-use acknowledgement.
- `/app/settings/organization`: role-controlled organization settings and owner data requests.
- `/app/settings/team`: role changes, invitations, revocation, and removal with transactional seat checks.
- `/app/settings/billing`: safe plan summary and allocation; no payment collection.
- `/app/settings/integrations`: truthful mock/console/fixture provider states.
- `/app/invitations/[token]`: explicit acceptance by the matching verified email; only the token hash is stored.
- `/api/organizations/[id]`: user-scoped read/update; cross-organization access is denied.
- `/api/billing/subscription`: owner-only subscription summary.
- `/api/health`, `/api/health/ready`: sanitized liveness and actual dependency readiness.

The proxy refreshes sessions. Every server data read verifies the user, every mutation reauthorizes the bound organization, and SQL RPCs/RLS independently enforce membership. An organization cookie is only an untrusted selection hint. Billing contact is never returned to nonowners. Unknown product routes remain unavailable. Browser code never receives database or service-role credentials.

Phase 2 is local-only. Hosted brand/knowledge screens return the local-development notice before querying any Phase 2 table. The web app uses the signed-in user's Storage permissions; the background worker separately obtains its own local runtime access. See [Phase 2 development](../../docs/phase-2-development.md).

## UI and verification

The visual system uses neutral surfaces, indigo signal artwork, local/system fonts, accessible contrast, reduced motion, and native keyboard-friendly navigation. Forms use React Hook Form and Zod, retain input after errors, and show pending/success/permission states. Shared Radix/CVA primitives live in `packages/ui`.

```sh
./scripts/local pnpm lint
./scripts/local pnpm typecheck
./scripts/local pnpm test
./scripts/local pnpm build
./scripts/local pnpm test:integration
./scripts/local pnpm test:e2e
```

Stop development before browser/integration tests to release the dedicated ports. Authenticated tests use fresh contexts and the local inbox, with credential-bearing traces/video/screenshots disabled. Explicit screenshots are captured only on stable public or workspace pages. The role matrix proves tenant isolation through SQL, application APIs, and rendered controls; desktop and mobile onboarding are both exercised.

For manual review, sign in with each seeded role, navigate with keyboard and mobile drawer, create a trial with a new synthetic email, review seat limits, invite a synthetic teammate from the Growth fixture, and sign out. No real Reddit, Google, billing, or email account is required.
