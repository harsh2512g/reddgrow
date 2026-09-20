# Privacy and data flow

This describes the implemented data boundaries and the Phase 8 owner-request workflow. Local development uses synthetic Reddit/AI/crawler data and console email. Supabase is the system of record; Redis coordinates jobs. Existing hosted authentication is a separate profile and does not share a session, customer data or worker access with the local workspace.

## Information by purpose

| Information                             | Destination and access                                                           | Minimization/lifecycle                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Login identity/session                  | Supabase Auth; verified server session, HttpOnly cookie                          | No Reddit passwords. Application logs and browser test traces omit sign-in links/cookies                                                                     |
| Organization, members and brand profile | Supabase PostgreSQL with membership/RLS                                          | Role-checked settings and owner-only data requests; platform-admin summaries exclude source/draft content                                                    |
| Knowledge originals                     | Private `knowledge-private` Storage                                              | User-authorized reads; source deletion revokes retrieval immediately and queues physical cleanup                                                             |
| Extracted text/chunks                   | Tenant-scoped PostgreSQL and pgvector                                            | Included/current sources only in retrieval; derived approvals are invalidated by evidence changes                                                            |
| Reddit posts                            | Minimal provider records, available only via authorized monitoring/opportunities | Default thirty-day retention, configurable 1–30 days; refresh after twelve hours and conservatively purge after forty-eight hours without fresh confirmation |
| Drafts and evidence                     | Tenant-scoped PostgreSQL                                                         | Human review; no model training. Deleted source posts purge derived replies/claims and associated content                                                    |
| Tracking/conversions                    | Supabase receipts, proof/key hashes and bounded event fields                     | No raw IP, browser fingerprint or arbitrary page content. Consent precedes browser persistence/network activity; DNT/GPC honored                             |
| Notifications                           | Preference/outbox rows and private rendering in worker memory                    | Queue IDs only, current state rechecked. Logs/history omit recipient/body. Console delivery is suppressed                                                    |
| Extension                               | Trusted extension storage and fixed ThreadSignal API                             | Expiring opaque session; only hash in database. No unrelated browsing observation or Reddit content scraping                                                 |
| Operations                              | Safe audit/job/usage records and bounded structured logs                         | IDs, counts, code and timing only; no provider body, knowledge contents or authentication material                                                           |

No automated external email, paid AI operation, Reddit action or payment is performed by local defaults. A future provider activation requires separately reviewed data-processing terms and owner authorization. A configured provider adapter is not evidence that data has been sent there.

## Owner export

An authenticated owner requests an asynchronous export, with at most three newly confirmed exports per organization in a rolling 24-hour period. Repeating an active request preserves its job identity. The worker builds a gzip JSON archive from explicit allowlists of the organization's application records and original uploaded bytes encoded as base64. It excludes Auth identities, password/session/API hashes, click proof hashes, provider billing IDs, embeddings and raw shared Reddit post bodies. Records remain tenant-bound throughout collection. The archive is limited to 64 MiB before compression and 50,000 records; an oversized export fails with `EXPORT_TOO_LARGE` rather than quietly omitting records.

Archives are stored in the private `privacy-exports` bucket and expire 24 hours after successful completion. The bucket must remain private, with a 64 MiB object limit and only `application/gzip`; the migration refuses a conflicting preexisting configuration. Only a current authorized owner may obtain an archive. Revocation/expiry denies new access immediately; object removal is eventual. Downloaded copies already held by the owner cannot be recalled. A Reddit deletion invalidates affected tenant exports so an older archive does not remain downloadable with purged derived text. Export availability must be rechecked at download time, not trusted from a previously rendered page.

## Confirmed organization deletion

An owner must confirm the exact organization slug. Older unconfirmed deletion requests never execute automatically. Confirmation disables the organization, revokes extension sessions/conversion keys/tracking links and invalidates in-flight jobs. The worker removes original knowledge files and export artifacts through the Storage API before cascading application rows; a Storage failure retains the deletion request and job for retry rather than reporting success prematurely. A deletion attempt yields after 60 seconds or 500 objects and resumes a fresh batch. Completion requires no remaining tenant objects; a successful API response without deletion progress is treated as a failure.

A minimal deletion receipt containing identifiers and operational status is retained for 30 days. Shared Supabase Auth users may belong to other organizations and are not removed by organization deletion. Shared Reddit provider records may serve other organizations; the organization cascade does not delete another tenant's data. An active Stripe subscription must be canceled through the verified billing workflow before deletion is allowed, preventing an orphaned paid subscription. Local mock deletion never contacts Stripe.

Pause/disablement must not stop pending privacy cleanup. A deleted organization cannot be resumed by a platform administrator. Failure recovery must preserve source generations, lease fences and revocations. See [operations](operations-runbook.md) and [incident response](incident-response.md).

## Retention and backup boundaries

Expired extension sessions/codes are cleaned up in bounded batches; expiry denies use immediately. Notification attempts have a 23-hour retry horizon and three attempts, with repeated/stale contexts suppressed. Marketing analytics represent recorded click receipts and attributed events, not identified people or proof of causation.

The worker applies the following retention rules in bounded sweeps:

| Data                                                    | Eligible for cleanup                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Completed export object                                 | At its 24-hour expiry, or sooner after revocation; access denial does not wait for cleanup                               |
| Unreferenced export object                              | After one hour, unless a current processing lease still owns the object                                                  |
| Uncommitted knowledge-upload orphan                     | After 24 hours, only when no source row references its path                                                              |
| Terminal notification delivery                          | 30 days after its last update                                                                                            |
| Organization activity audit                             | 180 days after creation                                                                                                  |
| Private platform administrative audit and retry receipt | 180 days after creation; retry receipts also remain protected while their original job is within the 90-day retry window |
| Raw click receipt and associated conversion event       | 400 days after the click occurred                                                                                        |
| Minimal completed deletion receipt                      | 30 days after completion                                                                                                 |

Maintenance handles up to 25 Storage objects and 100 rows per cleanup category per cycle, scheduled about every ten seconds without overlapping cycles. Export/deletion jobs stop after at most three failed attempts and expose a failed state for a safe manual retry; an oversized export fails immediately. An unsuccessful periodic orphan/expiry sweep is retried on a later cycle and makes worker readiness fail; it does not create a separate three-attempt job. Platform manual retries are limited to jobs created within 90 days and one retry per original job, so expiry of older audit receipts cannot reopen an old job's retry allowance. A pause still permits physical cleanup of an already-deleted knowledge source and confirmed organization deletion.

Billing replay receipts, usage and tenant job records remain until organization deletion to preserve idempotency. Known source originals remain until source/organization deletion. Cleanup is eventual: a stopped or unhealthy worker delays physical removal, so inspect the oldest pending privacy job, safe queue failures and Reddit purge lag. Do not promise a deletion SLA based solely on successful request acceptance. Provider-side backups and preexisting owner downloads are separate from live application access revocation. Backups require documented expiry and a deletion ledger replay before restore; see [backup/restore](backup-restore.md). This technical record is not a finalized jurisdiction-specific legal privacy policy.
