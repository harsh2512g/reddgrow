# Phase 0 risks

| Risk                                                  | Mitigation / verification                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accidental host configuration or credentials          | Fresh environment allowlist, project-local configuration/cache, no dotenv loading; isolation unit tests                                                                               |
| Container operations reaching another daemon          | Project-local Docker context named colima, exact socket verification before operations, no default host fallback                                                                      |
| Container tool resolving to an unrelated installation | Redis uses validated Compose-format configuration through the native Docker CLI; no Compose executable is invoked                                                                     |
| Loopback ports belonging to another local service     | Container ownership metadata is verified before database settings and service readiness are enabled                                                                                   |
| Host directory or SSH access from VM                  | No host mounts, no SSH-agent forwarding, no SSH config writing, no host public-key loading                                                                                            |
| Destructive reset reaching another database           | Local CLI workdir, exact loopback/port/database validation, Colima context verification                                                                                               |
| Secret exposure in errors                             | Environment field names only, redacted structured logs, suppression of Supabase key-bearing output                                                                                    |
| False-green test commands                             | Real Vitest suites and browser tests; integration requires live services and fails when absent                                                                                        |
| Incomplete framework compatibility                    | Public npm version/peer checks plus full local gates; Node 24 target, current local Node 25 recorded separately                                                                       |
| Unintended next-phase scope                           | No users, organizations, subscriptions, authenticated mutations, ingestion pipeline, or posting behavior                                                                              |
| CI needs isolated Colima tooling                      | Hosted quality/browser job plus a dedicated personal Colima runner for migration/integration; neither job is remotely verified and no runner is provisioned or connected by this task |
| Native platform limits                                | No system-level workarounds or outside writes without approval; failures remain explicit in status                                                                                    |

## Observed verification exception

Lima reported transient host socket paths under `/tmp` during an earlier broad forwarding attempt. The VM was stopped and forwarding was narrowed to project ports; the final startup log excludes DNS port 53 and reports only loopback project forwards. Outside files were not inspected or cleaned. See [the failure and isolation record](phase-0-verification.md); absolute historical confinement is not verified.

## Phase 8 current release risks

- Hosted processing remains gated; current web/worker SQL and Redis bridges deliberately accept only verified local infrastructure. Production runtime separation and migrations must be implemented and reviewed before deployment.
- The real website crawler is unavailable. Supplying a key does not make it operational; fixture ingestion is the verified development path.
- Real Stripe/Resend, approved Reddit, AI, Google OAuth, external alert delivery, remote CI and Node 24 are not live-tested here.
- Private exports are bounded to 64 MiB/50,000 rows and expire after 24 hours. Larger organizations need an assisted export; the worker fails explicitly instead of returning a truncated archive.
- Deletion crosses PostgreSQL and Storage transactions. Immediate revocation, organization locks, leases, retries and orphan sweeps reduce races; failed cleanup remains visible in operations until resolved.
- Local query plans use small fixtures. Production load, multi-replica metrics and recovery-time objectives require staging measurement.
- The historical isolation exception above remains open; Phase 8 does not authorize outside-repository investigation or cleanup.
