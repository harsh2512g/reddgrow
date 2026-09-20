# Phase 4 implementation contracts

Phase 4 runs against the isolated local Supabase and Redis services. Hosted Phase 2
configuration is unchanged. Reddit, AI and billing remain mock; crawling uses fixtures.
No Reddit submission, extension handoff, tracking or conversion features are added.

The browser-safe schemas in `packages/drafts/src/schema.ts` define persona settings,
generation controls, retrieved evidence, structured generation, independent claim
verification and the twelve compliance checks. The server pipeline lives behind
`@threadsignal/drafts/pipeline`. Persona fields preserve the existing database names.

PostgreSQL is the durable job outbox. BullMQ dispatches three stages:
`generate-draft`, `verify-draft-claims`, and `check-draft-compliance`. A job payload
contains only its UUID. Each stage publishes through a private SQL function that
checks the current lease, draft version and authoritative context checksum. The
checksum covers the brand, persona, post, rules and included knowledge. Retrieval
uses at most eight current chunks, with a 90-day freshness bound and bounded text.

Public mutations use authenticated RPCs: `request_draft`, `regenerate_draft`,
`save_draft_edit`, `restore_draft_version`, `verify_draft`, `approve_draft`,
`reject_draft`, `submit_draft_feedback`, `get_draft_usage`, and
`update_brand_persona`. Expected-version comparisons prevent lost edits. Request
UUIDs deduplicate generation within an organization. Plan reservations count each
new generation once; retrying the same request does not consume another unit.

Approval requires the current version's completed independent checks, current
evidence, no blocking finding, explicit warning acknowledgement when applicable,
and responsible-use acceptance. Copying requires a still-current approved draft.
Edits and restores create versions and clear approval. Sources and threads remain
untrusted inputs; their contents cannot override generation or compliance policy.

Web mutation JSON uses `expectedVersion`, `idempotencyKey`, and `options` where
applicable. Edit adds `content`; restore adds `restoreVersion`; approval adds
`acknowledgeWarnings` and `acceptResponsibleUse`; rejection adds `reason`;
feedback adds `rating` and `notes`. The server translates these to SQL `p_*`
arguments after validating origin, active organization and input schemas.

Validation must cover tenant isolation, role permissions, atomic plan limits,
stale versions and leases, source invalidation, unsupported/deceptive claims,
provider failures, retries, editor persistence, approval and rejection. A local
phase completion claim requires lint, formatting, typecheck, unit tests, build,
database/worker integration tests, browser smoke tests and runtime health checks.
