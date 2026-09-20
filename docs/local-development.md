# Isolated local development

## Prerequisites and boundary

Node 24 is the version in `.nvmrc`; the package engine also permits supported newer runtimes. The implementation machine has Node 25.2.1. Colima and the Docker CLI are required for service verification; Docker Compose is not required. `./scripts/local doctor` checks only approved public development tools under the isolated environment; it does not inspect existing account profiles.

The shell launcher clears inherited variables before Node starts. It then constructs a fixed environment for public npm, provider defaults, local ports, browser downloads and tool directories. It does not use an existing npm login, registry token, proxy, SSH agent, cloud profile, browser session, monitoring destination, or root dotenv file.

Generated paths:

| Path                            | Purpose                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `.pnpm-store/`                  | Project package store                                                         |
| `.threadsignal/pnpm-bootstrap/` | Integrity-verified pinned pnpm package/native executable                      |
| `.threadsignal/xdg/`            | Tool configuration/cache/data/state                                           |
| `.threadsignal/docker/`         | Dedicated Docker context and empty authentication configuration               |
| `.threadsignal/colima/`         | Dedicated Colima configuration                                                |
| `.local/lima/`                  | Shorter project-local Lima VM path to satisfy macOS socket length limits      |
| `.threadsignal/services/`       | Generated Supabase CLI workdir; no inherited dotenv file                      |
| `.threadsignal/runtime.json`    | Local DB connection, public anon key, and ownership metadata; owner-only mode |
| `.threadsignal/playwright/`     | Test browser binaries                                                         |
| `.threadsignal/tmp/`            | Temporary files and disposable test profiles                                  |

Lima needs the real home path during initialization, so only Colima receives that unchanged path. All configurable state/cache locations remain in the repository. Host mounts, public SSH key loading, SSH-agent forwarding and SSH config writes are disabled. No home directory is mounted into the VM. The Lima override forwards only project TCP ports 54320–54324 and 56379 to host loopback; other TCP/UDP ports are ignored. See [the verification record](phase-0-verification.md) for an earlier privileged-port forwarding attempt that reported external temporary paths. Long repository paths may still exceed macOS UNIX-socket limits; do not solve this by writing outside the repository without approval.

## Installation and services

Run the commands in the root README. `bootstrap` downloads pnpm only from public npm and verifies its SHA-512 integrity against the registry metadata. `pnpm install --frozen-lockfile` uses the committed workspace lockfile. After an authorized dependency change, use `--no-frozen-lockfile` once, review the lockfile/build-policy changes, then verify frozen installation again.

Service startup creates only this repository's Colima instance and Docker context, starts Redis and local Supabase, then saves the local database endpoint and public anonymous Auth key. The service-role key is never supplied to Next.js or browser code. Context/socket checks prevent commands from falling back to another daemon. Supabase CLI output can contain local keys; those values are not printed.

`docker-compose.yml` is the source of Redis settings. The launcher validates its narrowly supported schema and uses native Docker CLI commands to create the labeled Redis container and volume, check health and stop the container. It never invokes Compose. During local setup, the available Compose executable pointed to OrbStack and was not used; this implementation therefore has no dependency on that executable or its configuration.

Applications receive the generated database URL and public Auth key only after the launcher verifies the recorded ownership of the running project containers. Missing, stopped or replaced services leave readiness unavailable. A localhost address by itself is not treated as proof that a service belongs to this project.

| Service       | Local endpoint                           |
| ------------- | ---------------------------------------- |
| Web           | `http://127.0.0.1:3000`                  |
| Worker health | `http://127.0.0.1:3001/api/health/ready` |
| Supabase API  | `http://127.0.0.1:54321`                 |
| Local inbox   | `http://127.0.0.1:54324`                 |
| PostgreSQL    | `127.0.0.1:54322`                        |
| Redis         | `127.0.0.1:56379`                        |

Do not point the runner at an existing database. The reset/type/seed commands verify the local context and exact database endpoint. Phase 1 migrations add profiles, organizations, memberships, hash-only invitations, central plan records, subscriptions, audit logs, and data requests. The seed creates five synthetic passwordless users across two organizations. See [database foundations](phase-1-database.md). Reset deletes local development data; seed itself is idempotent and preserves later edits.

## Development and checks

`pnpm dev` builds shared dependencies, watches their TypeScript output, and starts the web and worker applications. Private package runtime imports resolve to `dist/index.js`, and types resolve to `dist/index.d.ts`. Each package watcher runs `tsc -p tsconfig.build.json --watch --preserveWatchOutput`; application reloads therefore consume generated JavaScript. Every `/app` route requires a server-verified Supabase session. A new user reaches organization onboarding; seeded users enter their existing workspace. Role checks and PostgreSQL RLS protect reads and mutations. Unknown future product routes remain unavailable.

Run unit tests without services, and integration tests with services. The worker integration uses real PostgreSQL, Redis and BullMQ to require a completed heartbeat. It is not skipped when a service is missing. Browser tests use fresh profiles, local URLs and a production build. Stop `pnpm dev` before integration/E2E tests to avoid port conflicts.

Build tools may need permission to bind local ports in restricted execution environments. Such permission does not authorize outside filesystem writes or external accounts. Do not suppress a failed gate or mark an unverified result as passing.

The GitHub Actions workflow defines frozen installation, lint, formatting, typechecking, unit/contract tests, repository hygiene, builds and browser smoke tests on a hosted Linux runner. Its separate service job requires a dedicated personal runner carrying the `threadsignal-personal` and `colima` labels, with Node, Colima and Docker already available. It runs migrations, seed, database lint, live integration and cleanup. Do not assign these labels to a shared or employer runner. Provisioning or connecting that runner is a separate external action, not performed during Phase 0. Neither job was executed remotely during Phase 0. If the workflow is later triggered without a matching personal runner, the service job will wait for one; the same commands must pass locally for Phase 0 acceptance.

## Local sign-in and team review

1. Start project services, apply the local migrations, and run development using the commands above.
2. Visit `/login`, enter a synthetic email, and choose **Send magic link**. Open the local inbox link and use the newest message in the same browser, preserving the PKCE cookie.
3. New users create a workspace and accept the responsible-use commitment. The transaction creates the owner membership, audit event, and seven-day trial together. Trial has one seat, so team invitations require the seeded Growth organization for local review.
4. Seeded `owner@threadsignal.test`, `admin@threadsignal.test`, `member@threadsignal.test`, and `viewer@threadsignal.test` share the first organization. `outsider@threadsignal.test` owns the second. All sign in through the same local email flow; there are no seed passwords.
5. On **People & access**, an owner/admin creates an invitation. Console email suppresses recipient/body output, so the UI returns a private copyable link once. Share it only with the invited synthetic user. That user signs in with the exact invited email and explicitly accepts. Pending invitations reserve seats and expire after seven days.
6. The account menu signs out and clears this application's session cookies. Other localhost applications' cookies are not processed.

Do not use a real email identity or an external inbox for this workflow. Local Auth sends only to the project's Mailpit container. Application notifications remain `EMAIL_PROVIDER=console`; no SMTP account, Resend account, or Google account is used.

Google OAuth is implemented behind explicit configuration and disabled in the isolated local runner. External Google/Supabase provider setup and HTTPS deployment have not been performed or live-tested. The local launcher intentionally ignores existing keys and profiles. Do not paste credentials into chat or alter the launcher to inherit an existing cloud session.

Settings allow owner/admin organization updates, owner-only billing contact and data requests, and read-only member/viewer access. Export/deletion requests are recorded for later processing; no immediate export, deletion, payment, or plan purchase occurs in Phase 1. Data remains when a plan limit is reached.

Authenticated browser tests disable automatic traces, screenshots, and video so sign-in and invitation tokens do not enter reports. Deliberate visual-review screenshots are taken only on stable application pages. All artifacts stay in ignored repository directories.
