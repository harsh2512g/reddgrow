# Operations runbook

The verified operating target is the repository-owned Colima environment with Supabase and Redis. Use only `./scripts/local`; it clears inherited account configuration and refuses unowned endpoints. Keep Reddit/AI/billing mocked, email console and crawler fixture. A hosted or real-provider operation requires a separate, explicitly authorized personal runtime.

## Start and verify

From the repository root:

```sh
./scripts/local pnpm install --offline --frozen-lockfile
./scripts/local pnpm services:start
./scripts/local pnpm services:health
./scripts/local pnpm db:migrate
./scripts/local pnpm db:types
./scripts/local pnpm seed
./scripts/local pnpm dev
```

Use a normal public-npm frozen install only when offline cache is incomplete. `db:migrate` applies additive migrations; `db:reset` destroys local data and is not a routine recovery step. Web runs at `http://127.0.0.1:3000`; worker readiness is `http://127.0.0.1:3001/api/health/ready`, web readiness is `/api/health/ready`. Stop dev with Ctrl-C before production-build browser tests. `./scripts/local pnpm services:stop` stops owned services without deleting volumes.

A readiness response must be HTTP 200 with `status: ready`. A homepage that renders while Redis or database processing is down does not establish worker readiness. Public health exposes checks, never database connection strings, stack traces, Auth identities or provider payloads.

## Investigate a job

1. Sign in as a separately provisioned platform administrator and open `/internal/admin/jobs`. Organization ownership does not grant platform administration.
2. Inspect safe job kind, status, attempt count, due time and error code. Read related provider and organization health. Do not fetch customer document bodies or drafts to troubleshoot an ordinary failed job.
3. Correct the dependency or invalid source through its ordinary owner-authorized workflow. Retry only an eligible failed job using the admin action. Active leases, stale versions, deleted sources and duplicate delivery must stay fenced.
4. Confirm a new attempt and terminal outcome. Platform controls permit one manual retry per original job, and only for jobs created within the preceding 90 days. Repeated failures require investigation instead of replaying indefinitely. Notification retries outside the 23-hour provider idempotency window must remain suppressed.

PostgreSQL outboxes are durable business state. BullMQ is delivery coordination; Redis deletion is not a safe generic fix. Never change a successful database record back to pending merely because a queue entry is missing. Deletion and disabled organizations must remain disabled during recovery.

## Signals to monitor

| Signal                          | Source and interpretation                                                      | Operational response                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Readiness/heartbeat             | Web and worker health endpoints; measured dependency checks                    | Page an operator after a sustained failure; compare last healthy deployment/configuration                                |
| Durable job backlog/failures    | Admin snapshots from Supabase; due time, attempts and safe failure codes       | Investigate dependency and lease progress; use bounded safe retry                                                        |
| Provider disablement/rate reset | Admin provider state plus Reddit checkpoints                                   | Respect reset deadlines and authorization pause; never change identities or bypass limits                                |
| Draft compliance                | Stored verified pass/warning/blocked results                                   | Investigate a changed provider/template, preserve approval restrictions                                                  |
| AI usage                        | Persisted per-task receipts and plan counters                                  | Treat mock paid-token/cost values as zero; real estimates require configured model prices                                |
| Provider HTTP attempts          | Fixed AI/Reddit/Stripe/Resend counters and time to response headers            | Transport exceptions and non-2xx statuses count as failures; response bodies, URLs, headers and retries remain untouched |
| Operation latency               | `createObservability.run` process-local counts/failures/total/max milliseconds | Samples reset with a process; thrown failures differ from domain outcomes returned successfully                          |
| Redirect latency                | Fixed tracking events record measured duration                                 | Investigate database/Redis latency without logging destination URLs or click proofs                                      |
| Billing webhook failures        | Structured `billing_webhook_failed` warning with safe code/status/request ID   | Signature 400 spike: verify configuration/abuse; 5xx: repair dependencies and let idempotent retries reconcile           |

Process-local metrics have at most 64 operation labels and contain no customer IDs as labels. They are not fabricated fleet-wide telemetry or durable SLO history. Tracing and Sentry-compatible sinks are injectable; no external exporter, alert service or paid monitoring destination is active. A future authorized deployment must wire and test notifications for readiness, queue delay, purge lag and billing failures. Do not call a log event an externally delivered alert.

## Privacy and recovery

Owner export/deletion requests are handled through the privacy workflow, not direct table edits. Check [data flow](privacy-data-flow.md) before retrying a privacy job. Private platform administrative audit and retry records expire after 180 days through bounded maintenance; records protecting a job inside its 90-day retry window are retained. This is distinct from the tenant's 180-day activity feed.

Export/deletion jobs stop after at most three failures and remain visible for operator review; an oversized export fails immediately. Orphan/expiry sweeps retry periodically and report an unhealthy privacy dispatcher when they fail; inspect the safe queue error and Storage availability rather than assuming every cleanup failure appears as a failed job. A pause must still allow physical cleanup of already-deleted knowledge sources and confirmed organization deletion. Use [backup/restore](backup-restore.md) for a disaster and [incident response](incident-response.md) for suspected compromise. Console email outcomes are suppressed; they do not prove inbox delivery. A stopped worker delays processing and cleanup but must never weaken immediate access revocation.
