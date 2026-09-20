# Backup and restore procedure

This is a reviewable disaster-recovery procedure, not evidence that a backup or restore was performed. No external backup destination, cloud credentials or paid recovery feature has been configured. The owner must authorize the exact personal source/target and writes before an external rehearsal or restore.

## Recovery set

Treat the following as one recovery set: Supabase database/schema/migration history and RLS/grants; private Storage object bytes and metadata; reviewed application revision/lockfile; provider configuration names and credential-rotation procedure; and a minimal deletion/revocation ledger newer than the recovery point. Keep secrets in the chosen authorized secret store, never alongside exported database archives.

Supabase database backups do not include Storage object bytes, and custom-role passwords require separate handling after restore. A database-only restore therefore cannot prove that knowledge originals or private export artifacts are recoverable. Review the selected project's actual retention/recovery options in [Supabase's backup documentation](https://supabase.com/docs/guides/platform/backups) rather than assuming a free project has paid recovery features.

Target selection, encryption, access, retention, RPO and RTO need owner approval before launch. Suggested engineering objectives to evaluate are a 24-hour maximum database/object recovery-point gap and a four-hour recovery-time target; neither is an achieved guarantee. Reduce the data-loss target with an approved point-in-time/object strategy if the business requires it.

## Rehearsal and restore sequence

1. Record a fixed recovery point, schema version, object manifest/counts and checksums without copying customer content into the report. Freeze writes or use an explicitly coordinated snapshot strategy.
2. Restore into a separately authorized staging target. Never overwrite the active project as a test. Keep all outgoing providers, webhooks, notifications, public conversion ingestion and workers disabled while validating.
3. Restore database and matching object bytes through supported Supabase operations. Restore/recreate least-privilege role credentials separately and check that application roles cannot bypass RLS, own tables or access Auth secrets.
4. Reconcile any post-backup deletions, expiry and revocations before enabling users. Revoke restored extension tokens/conversion keys when their validity cannot be established. Purge restored Reddit content that is stale, deleted or outside retention. Do not resurrect deleted organizations or older accessible exports.
5. Verify counts and representative object checksums; run migration lint, RLS/cross-tenant integration, owner export/deletion, knowledge download, mock draft and analytics smoke tests against the isolated target. Confirm private buckets remain private.
6. Reconcile PostgreSQL outboxes before workers resume. Queue delivery may be reconstructed from durable IDs; do not replay completed billing events or regenerate paid work indiscriminately. Confirm provider idempotency windows and suppress expired notification deliveries.
7. After explicit cutover approval, enable reads, then bounded workers/writes, then approved providers. Watch readiness, backlog, purge lag and billing webhook receipts. Keep a rollback point with an expiry and a named operator.
8. Record observed data loss, restore duration, integrity results and open failures. A procedure document alone cannot check the release checklist's restore-rehearsal box.

Local `db:reset` is for disposable test data and does not restore uploaded files. Do not use it to repair a real workspace. Local service volumes survive normal `services:stop`; they are not an independent backup. No outside-repository dump, copy or cleanup is implied by this document.
