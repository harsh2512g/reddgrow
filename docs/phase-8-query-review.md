# Phase 8 query review

Measured on 2026-09-19 against the repository-owned local Supabase PostgreSQL instance. The checks used `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` inside a read-only transaction with a five-second statement timeout. Output contained query plans, row counts and index definitions; no customer rows or credentials were returned.

| Query                                                          | Observed plan                                                        | Rows returned to the query executor | Execution time |
| -------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------: | -------------: |
| Latest 25 administrative jobs                                  | Merge Append of the five job-history indexes                         |                                  25 |       1.056 ms |
| Latest 25 failed administrative jobs                           | Append of dispatch-index and small-table sequential scans, then sort |                                   0 |       1.041 ms |
| Organization directory, UUID cursor                            | Index Only Scan on `organizations_pkey`                              |                                  25 |       0.051 ms |
| Opportunity feed, populated organization and brand, score ≥ 40 | Sequential scan of 17 local opportunities, in-memory sort            |                                  11 |       0.321 ms |
| Organization activity, newest first                            | Bitmap scan using `audit_logs_activity_cursor_idx`, then small sort  |                                   1 |       0.101 ms |

All measured plans reported zero shared-block disk reads and zero temporary-file writes. These are single local warm-cache observations, not production latency guarantees. The first opportunity probe selected an empty brand and returned zero rows in 0.296 ms; the populated-brand probe above replaced that evidence. The failed-jobs probe also had no current failures, so it does not establish performance with a large failure history.

The job query deliberately projects only operational fields and uses a 25-row keyset page. The actual RPC adds validated optional organization, family and status filters, a retry-eligibility check, and an audit insert. These measurements cover the underlying read shapes, not authentication, HTTP, the RPC audit-write overhead, every filter combination, RLS evaluation under a real user, or full browser rendering. Organization-summary count subqueries and overview-wide aggregates likewise require production-scale measurement before launch.

The checked index catalog contains:

- `knowledge_jobs_history_idx`, `reddit_jobs_history_idx`, `draft_jobs_history_idx`, `notification_deliveries_history_idx`, and `privacy_jobs_history_idx`, each ordered by creation time and UUID descending.
- `audit_logs_activity_cursor_idx`, ordered by organization, creation time and UUID descending.
- The existing `opportunities_feed_idx`, whose last UUID column is ascending. The additive `20260923060000_feed_cursor_index.sql` adds `opportunities_score_cursor_idx` matching the feed's actual score-descending and UUID-descending cursor. Integration tests check the new definition after migration; no large-data speedup is claimed from this change.

Do not force index scans based on these tiny fixtures. Before deployment, measure representative tenant sizes, both first and continuation pages, failed-job history, filtered feed searches and aggregate dashboards on the authorized personal target. Review the exact predicates and buffer costs before dropping a redundant index or adding more indexes. Public redirect latency is measured separately in the Phase 6 verification record.

Local plan artifacts are `.threadsignal/phase8-query-plans.json` and `.threadsignal/phase8-feed-query-plan.json`; both remain ignored. The checks used `./scripts/local pnpm exec node --input-type=module`, the repository's `verifyDocker()` and `localDatabaseUrl()` helpers, and no hosted configuration.

After all operations migrations were applied, `./scripts/local pnpm exec vitest run --config vitest.integration.config.ts tests/integration/phase8-admin.test.ts` passed all 22 tests in 2.46 seconds. Its catalog check verifies the five job-history indexes, activity cursor index and exact descending score/UUID index definition. The suite also proves tied-timestamp job pagination has no repeated records, rejects malformed cursors, and verifies audit/retry retention without leaving its maintenance fixtures behind.
