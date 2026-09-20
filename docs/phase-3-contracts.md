# Phase 3 local contracts

Implementation contract shared by the database, worker, provider, and web changes. Phase 3 remains local; the prepared hosted worker is limited to Phase 2 permissions.

## Database and RPC contract

Global provider metadata uses `subreddits` (canonical lowercase `name`, `provider`, `provider_id`, `display_name`, `description`, `subscriber_count`, `is_nsfw`, `metadata`, `last_synced_at`) and `subreddit_rules` (`subreddit_id`, `provider_rule_id`, `title`, `description`, `kind`, `applies_to`, `raw_data`, `last_synced_at`). Authenticated clients can read community metadata; they cannot write it. Workers fetch metadata after a manager adds a community by name.

`brand_subreddits`: `id`, `organization_id`, `brand_id`, `subreddit_id`, `status` (`active`/`paused`), `priority` (1–5), `minimum_score` (0–100), `risk_level`, `product_relevance`, `allowed_reply_style` (`helpful`/`technical`/`no_links`/`answer_only`), `internal_notes`, `internal_interpretation`, `monitor_new`, `monitor_hot`, `monitor_rising`, timestamps. Defaults: active, priority 3, minimum score 40, helpful, new enabled. At least one sort must be enabled.

Manager RPCs (owner/admin):

- `add_brand_subreddit(p_brand_id uuid, p_name text, p_settings jsonb) → uuid`
- `update_brand_subreddit(p_id uuid, p_settings jsonb) → void` (partial settings)
- `remove_brand_subreddit(p_id uuid) → void`
- `refresh_brand_subreddit(p_id uuid, p_kind text) → uuid` (`sync` or `rules`; deduplicates outstanding work)
- `save_brand_keyword(p_brand_id uuid, p_id uuid, p_input jsonb) → uuid`: input `value`, `kind`, `is_exclusion`, `status`, `source`; create with `p_id=null`.
- `delete_brand_keyword(p_id uuid) → void`

Keyword kinds: `category`, `problem`, `recommendation`, `alternative`, `competitor`, `technical`, `exclusion`. Status: `active`/`paused`; source: `manual`/`suggested`. Existing `save_brand` retains its signature and reconciles unchanged keywords/competitors in place. Keyword RPCs synchronize the canonical brand profile.

Opportunity RPCs (owner/admin/member; viewer read only):

- `set_opportunity_status(p_id uuid, p_status text, p_reason text default null) → void`: user-controlled status `new`, `saved`, `monitoring`, `dismissed`, `archived`; blocked/deleted opportunities cannot become actionable.
- `bulk_dismiss_opportunities(p_ids uuid[], p_reason text) → integer`: 1–100 IDs, all must belong to the same verified organization; atomic authorization.
- `rescore_opportunity(p_id uuid) → uuid`: durable deduplicated rescore job.
- `get_opportunity_usage(p_organization_id uuid) → jsonb`: verified member view of `{quantity, limit, period_start, period_end, plan_key}`.

Dismissal reason values: `not_relevant`, `low_intent`, `already_answered`, `community_risk`, `product_cannot_help`, `duplicate`, `other`.

`reddit_posts` uses the specification's normalized snake_case fields, UUID `id`, unique `(provider,provider_post_id)`, and `subreddit_id`. Its shared rows are readable only through a tenant's monitored community or existing opportunity. Deleted rows must have `title`, `body`, `author_name`, `permalink`, `flair` nulled and `raw_metadata={}`. No browser/client direct writes.

`opportunities` uses all specification §10.5 score/evaluation fields plus `subreddit_id`, `suggested_action`, `input_checksum`, `is_blocked`, and `knowledge_citations` (JSON array). Unique `(brand_id,reddit_post_id)`. All six component scores and `penalty_score`/`final_score` are numeric 0–100; `matched_competitor_ids` is a JSON UUID array. No Phase 4 statuses or draft tables are introduced. New status is `blocked` for hard blocks, otherwise `new`; rescoring preserves a user's dismissal/archive decision. New hard blocks make other statuses blocked, and source deletion archives every affected opportunity.

## Worker database contract

`reddit_jobs` is the durable outbox. Fields: `id`, `kind` (`sync`, `rules`, `refresh`, `evaluate`, `rescore`), nullable `organization_id`, `brand_id`, `subreddit_id`, `reddit_post_id`, `opportunity_id`; `sort` (`new`/`hot`/`rising`, default new); `dedupe_key`, `status` (`queued`/`processing`/`completed`/`failed`), `attempts` 0–3, `available_at`, `lease_token`, `lease_expires_at`, `error_code`, timestamps. A unique partial index on `dedupe_key` for queued/processing jobs prevents duplicate outstanding work. Workers generate an ID per occurrence; completed rows do not block later schedules.

Global `sync`/`rules` jobs need `subreddit_id`; `refresh` needs `reddit_post_id`; `evaluate` needs `organization_id`, `brand_id`, `reddit_post_id`; `rescore` also has `opportunity_id`. Global jobs leave tenant IDs null. Application RPCs insert jobs only after authorization. Queue payloads contain job ID only. Parent worker owns lease claiming, retry fencing, provider upserts, schedules, and checkpoint progress in transactions.

`reddit_sync_checkpoints`: `subreddit_id`, `sort`, `cursor`, `last_success_at`, `last_error_at`, `consecutive_errors`, `next_sync_at`, `last_rules_sync_at`, `last_post_refresh_at`, `provider_paused`, `provider_retry_at`, `error_code`; unique `(subreddit_id,sort)`. No client writes. The private provider deadline survives process restarts and applies across that provider's communities; it remains separate from the next ordinary poll time.

`private.publish_opportunity(p_brand_id uuid, p_reddit_post_id uuid, p_evaluation jsonb) → uuid`: worker-only function; validates evaluation, locks organization and brand, requires active monitoring/brand/plan, applies atomic 20 trial / 100 Solo / 500 Growth allocation on first creation, and returns existing ID without consuming usage on rescore/replay. Returns null when a paused/unmonitored brand should no longer receive work. Throws `OPPORTUNITY_LIMIT` when a new allocation would exceed the period's limit. Worker must retain its lease fence in the surrounding transaction. It runs only as the existing local worker's database authority; no hosted-worker grant is added.

Required evaluation keys: `summary`, `user_need`, `intent_category`, `semantic_relevance`, `buying_intent`, `freshness`, `engagement_velocity`, `rule_fit`, `competitor_context`, `penalty_score`, `final_score`, `risk_level`, `suggested_action`, `is_blocked`, `risk_reasons`, `matched_capabilities`, `missing_capabilities`, `matched_competitor_ids`, `knowledge_citations`, `reasoning_summary`, `model_metadata`, `input_checksum`. The database assigns `evaluated_at=now()`; an additional supplied evaluation timestamp is ignored. Model metadata is a bounded JSON object. Citation objects have `chunk_id`, `source_id`, `title`, nullable `source_url`, and `excerpt` up to 300 characters, maximum eight. The database verifies chunk/source ownership and current inclusion, and reconstructs citation text and URLs from stored knowledge. Unknown or cross-brand competitor IDs are rejected. A new nonblocked score below the association's minimum is filtered without consuming usage.

`private.purge_reddit_post(p_reddit_post_id uuid) → void`: worker-only transaction removes post content and derived opportunity summaries, capabilities, citations, competitor IDs and model metadata; sets opportunities archived and nonactionable. Keeps numeric operational facts and internal timestamps only.

`usage_counters` stores `organization_id`, `metric='opportunities'`, subscription `period_start`/`period_end` timestamps and quantity; unique organization/metric/period. Trial uses its one trial period; paid plans use the subscription billing period. All allocation locks the organization first. Counts are never reduced by dismissing/deleting records, preventing quota resets through replay.
