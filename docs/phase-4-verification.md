# Phase 4 verification

Phase 4 local acceptance passed. Ready for review; Phase 5 has not started.

## Scope

Local-only drafting, retrieval, independent claim/compliance checks, editor/version
workflow, persona configuration, approval/rejection and feedback. No Phase 5 work or
hosted migration/provisioning is included.

## Final checks

All package commands use `./scripts/local` to clear inherited environment and use
repository-owned tooling and caches. Service commands target the verified local
Colima instance. No hosted credential, dashboard session, migration or worker
provisioning was used in this phase.

| Command                 | Result                                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`          | Passed for all 18 workspace projects after updating the workspace lockfile.                                                                                                  |
| `pnpm db:migrate`       | Applied the local Phase 4 migration without reset.                                                                                                                           |
| `pnpm db:types`         | Regenerated public database types.                                                                                                                                           |
| `pnpm db:lint`          | Foundation assertions passed, including all eight Phase 4 RLS tables.                                                                                                        |
| `pnpm seed`             | Idempotent local seed passed.                                                                                                                                                |
| `pnpm lint`             | Passed, no lint errors or warnings.                                                                                                                                          |
| `pnpm typecheck`        | **28/28 tasks passed**, plus root tooling TypeScript.                                                                                                                        |
| `pnpm test`             | **584/584 passed**, 55 files, including five diagnostics regressions.                                                                                                        |
| `pnpm test:integration` | **122/122 passed**, nine files, 56.68 seconds on the final run.                                                                                                              |
| `pnpm build`            | **17/17 tasks passed**, 16 cached, 6.996 seconds on the final code build.                                                                                                    |
| `pnpm extension:build`  | Passed; existing shell unchanged.                                                                                                                                            |
| `pnpm test:e2e`         | **24 passed, 2 intentional mobile skips**, 2.4 minutes on the final build.                                                                                                   |
| `pnpm services:health`  | Exact project Colima context/socket verified; Redis PONG; Supabase running.                                                                                                  |
| `pnpm dev`              | Started and left running at `http://127.0.0.1:3000`; worker on loopback port 3001.                                                                                           |
| Runtime HTTP checks     | Homepage, web readiness and worker readiness HTTP 200, including opportunities and drafts. Anonymous Drafts visit redirects to local sign-in with its destination preserved. |

The browser run includes real local authentication, organizations, knowledge ingestion,
opportunity discovery, roles and all draft review actions. The two skips duplicate
desktop-only database pagination and role assertions; responsive feeds and authenticated
workspace journeys still run on mobile. Both draft journeys verify no horizontal overflow
and no publish/submit action. Desktop/mobile screenshots of synthetic records were reviewed
and remain in ignored `.threadsignal/verification/`.

The seed was rerun after adding freshness filters to its opportunity lookup; stale records
wait for worker refresh instead of making seed fail. Foundation SQL lint passed again.
No existing data was reset.

The integration total comprises Phase 1 database (17), Phase 2 database (14),
Phase 2 worker (7), restricted worker permissions tested locally (8), Phase 3
database (17), Phase 3 worker (18), Phase 4 database (27), Phase 4 worker (10),
and service checks (4). It covers RLS and roles, atomic quotas/idempotency,
private source provenance, three worker stages, duplicate delivery and leases,
stale contexts, destructive-content races, unsupported edits, approval and copy
gates, safe retrieval/cache boundaries and mock-only timestamp reconciliation.

## Failures and corrections

- Initial `pnpm install` refused an outdated lockfile after adding the shared drafts package.
  A non-frozen online resolution made no downloads and stalled; it was interrupted.
  `pnpm install --no-frozen-lockfile --offline` updated/link-tested existing public artifacts.
  The first `db:migrate` attempt also stopped at that lockfile preflight, before migration.
- Worker typecheck caught an incompatible union of BullMQ queue/worker event overloads;
  separate typed registration loops fixed it.
- The initial database suite (1 pass, 20 failures) and worker suite (8 assertions passed,
  cleanup failed) exposed a persona foreign-key cascade ordering defect. The migration
  and local constraint were corrected; scoped synthetic leftovers were removed.
- The first reconciliation helper expected 24 functions rather than 25 and stopped before
  connecting. Corrected reconciliation passed and wrote an ignored local receipt.
- An automatic approval review initially rejected the database test command based on
  an outdated phase assumption. Re-review of the same command with recorded Phase 3
  acceptance and the owner's next-step request approved it; no workaround was used.
- A broad unit run had 550 passes and one outdated Phase 3 presentation assertion,
  which still expected pre-drafting text. The assertion was updated; the subsequent
  full unit run passed 578/578 before one additional navigation regression was added.
- A new worker regression exceeded the intentional per-minute request cap (9 pass,
  1 rate-limit failure). Only synthetic prior-request timestamps were adjusted; the
  product limit remains unchanged.
- Review found publication/deletion and exhausted-lease lock ordering races. Corrective
  locking and concurrent regression checks passed in the full 120-test integration run.
- The first complete browser run reported 19 passes, 5 failures and 2 deliberate mobile
  skips. Both draft tests stalled on a dropdown selector; accessible combobox locators
  and bounded action timeouts corrected the test. Both opportunity tests found stale
  persisted mock timestamps; mock-only forward timestamp reconciliation and two
  regressions were added. OAuth timestamps and deletion tombstones remain unchanged.
  One initial signup failed to load workspace membership; its cause remains unconfirmed
  and it passed on the next full run without auth code changes.
- The second full browser run reported 22 passes, two failures and two deliberate mobile
  skips. Both draft workflows completed generation, evidence review, unsafe-edit blocking,
  restoration, rejection/regeneration, approval, copying and feedback. Their final library
  assertion ambiguously matched an approved filter option and the approved draft badge.
  The assertion now targets the specific draft card.
- A subsequent full browser run reported 13 passes, 11 failures and two skips over
  52.1 minutes. Chromium explicitly reported `ERR_NETWORK_IO_SUSPENDED`; several
  three-minute tests accumulated over fifteen minutes elapsed. Membership/data reads,
  magic-link exchange and browser setup also failed during that interrupted runtime.
  Afterward, the exact project Colima context, Supabase and Redis health checks passed.
  No timeout or assertion was relaxed in response to this run.
  Workspace and draft reads now emit narrowly projected diagnostic codes/status and
  a recognized timeout flag; five privacy-focused tests prove raw errors, identifiers,
  URLs, session values and content are not logged. Auth/session behavior is unchanged.
- A later full integration run had 121 passes and one failure: the existing private
  Storage upload hit its ten-second timeout before extraction. The focused seven-test
  worker suite then passed (upload/extract/delete in 847 ms), followed by the complete
  122-test pass (that case in 910 ms). No code or timeout changes were made between
  these runs. The transient failure's underlying cause was not established.

The unit command has emitted the existing Node 25 warning about a missing
`--localstorage-file` path. Browser runs, including the final passing run, logged Next.js
destination-stream closed-early messages during navigation. These did not fail the final
assertions; their underlying cause is not established. Development startup reports pnpm's
JavaScript fallback because its optional native installer was intentionally not run.

## Acceptance evidence

- **Source-backed, disclosed drafts:** worker integration and both browser projects generate
  through all three stages, display current source links/excerpts and confirm truthful affiliation.
- **Unsupported claims block approval:** worker/SQL and browser tests add an unsupported
  capability, observe an immutable autosaved version, blocked state and highlighted claim,
  and receive HTTP 409 from direct approval. Restoration creates a new version, rechecks
  evidence and permits approval only after required acknowledgements.
- **Review workflow:** persona settings, rejection with reason, regeneration, version comparison,
  feedback and approved copy work through real local records. Copy tests use an in-page stub
  rather than changing the owner's OS clipboard.
- **Isolation and scope:** mocks need no real-provider secrets. RLS, roles, origin checks,
  version/lease fencing and quotas are tested. No hosted migration, external login, Phase 5,
  automatic Reddit action, commit or push occurred.

## Manual review and limits

Final hygiene: `pnpm format:check`, `pnpm secrets:check` and `git diff --check` passed.
The scan covered 451 repository text files without tracked dotenv/dependencies, supported
secret patterns or operational employer references (instruction prohibitions excluded).
Root/web/worker `node_modules` and root `.env.local` are confirmed ignored by Git.

Follow [the local guide](phase-4-development.md): sign in at `http://127.0.0.1:3000`
using the local inbox, choose a brand and eligible opportunity, generate, inspect evidence,
edit/restore, acknowledge review requirements and approve/copy.

Real AI/Reddit adapters use injected HTTP tests only. Hosted Phase 4, Google OAuth, paid
providers, remote CI, deployed HTTPS and Node 24 were not live-tested. Conservative mock
verification can reject paraphrases that are not complete documented assertions.
Back/Forward protection depends on cancelable Navigation API support; app links, workspace
changes, sign-out, autosave and standard page-unload protection are covered. The historical
Phase 0 isolation exception remains in [its original record](phase-0-verification.md).
