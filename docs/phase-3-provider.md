# Phase 3 providers and scoring

The local pipeline uses `REDDIT_PROVIDER=mock`, `AI_PROVIDER=mock`, console email, mock billing and fixture crawling. No live Reddit requests, OAuth login or paid AI calls were performed. The hosted worker keeps Phase 2 permissions; Phase 3 processing is local.

## Shared contracts

`@threadsignal/reddit` exports the existing read-only `RedditProvider`, `RedditPost`, `SubredditDetails`, `SubredditRule`, runtime schemas, `MockRedditProvider`, `OAuthRedditProvider` and the explicit factory. There are no posting, voting, messaging or account-creation methods.

`@threadsignal/opportunities` contains browser-safe form, status, risk, intent, citation and evaluation schemas plus `scoreLabel`. Its `/scoring` entry is server-only: `evaluateOpportunity`, `freshnessScore`, `engagementScore`, `weightedOpportunityScore`, `suggestKeywords`, `suggestSubreddits` and `previewKeywordMatches`.

`evaluateOpportunity` takes validated brand/profile, normalized post/rules, keyword states, competitor IDs, up to eight included knowledge chunks, and an injected clock. It returns either `{kind: 'filtered', reason}` or `{kind: 'scored', evaluation}`. Evaluation field names match the PostgreSQL publication contract. The worker supplies durable identity, tenant checks, duplicate detection, scheduling, leases and transactional plan allocation.

The AI interface accepts validated structured `opportunity.evaluate`, `keyword.suggest` and `subreddit.suggest` tasks. Mock evaluation uses deterministic phrase/intent rules and clearly identifies itself as lexical development assessment. It is not real language-model inference. The later AI adapter and explicit deployment profile are implemented and transport-tested; local selection remains mock. See [deployment instructions](deployment.md) for the current activation boundary. No live AI request was verified.

## Deterministic fixtures

A mock provider instance anchors all relative ages once at construction; tests inject `{now: () => fixedDate}`. IDs remain stable across restarts. There are 26 synthetic post identities across SaaS, webdev, ecommerce and ArtificialIntelligence. Subscriber counts are explicitly synthetic provider metadata, not product customer counts.

The specification's `ArtificialIntelligence` name has 22 characters. Validation permits that exact case-insensitive fixture exception alongside the ordinary 2–21 character rule; it does not permit arbitrary longer names.

With the demo brand and included product knowledge, `fixture_001` scores above 90, `fixture_002` is medium and `fixture_003` is low. `fixture_004` mentions ImageLift as an alternative. `fixture_025` is a blocked SaaS feature request; it remains available even when the demo's no-vendor exclusion filters `fixture_005`. `fixture_026` repeats the first post's title/body under a different provider identity to exercise content deduplication. Other fixtures cover community-rule blocks, deleted content, old/locked/archived/NSFW posts, misleading affiliation, support requests and completed choices.

## Scoring and filtering

The weighted score follows specification §7.7 exactly, with 0–100 bounds and labels High ≥80, Medium ≥60, Low ≥40, and Hidden below 40. Freshness uses the specification's six age bands. Engagement is a bounded logarithm of positive votes plus twice the replies per hour. This deterministic metric is development ranking, not a performance claim.

Active exclusions, paused keywords, unmonitored communities, age, duplicates and content-state filters run before AI evaluation. A hard block overrides score for prohibited recommendations, deceptive affiliation, responsible-use violations, requested restricted claims and explicit contradictions in included knowledge. No-vendor requests incur the specified penalty and cannot receive a recommended affiliated reply. AI context is bounded; input checksum, evaluation version, component scores, reasons and source references accompany every result. PostgreSQL independently resolves supplied citation identities against current included knowledge.

Brand-specific dismissal feedback is a deterministic penalty, never model training. The worker supplies up to 50 aggregate groups scoped to the current brand and organization, excluding the current opportunity and deleted posts. Only the same community and assessed intent count, and only `not_relevant`, `low_intent`, `product_cannot_help`, or `community_risk` reasons apply. Three or more prior human dismissals subtract three points per dismissal, capped at 15, with a visible explanation. Other communities/intents and administrative dismissal reasons have no effect. Feedback never boosts a score or relaxes a hard block; no Reddit text is supplied as feedback.

## OAuth adapter boundary

The adapter is tested with an injected fetch implementation. Construction requires explicit `commercialApprovalConfirmed: true`, `clientId`, `clientSecret` and a descriptive ThreadSignal `userAgent`. Production wiring must map these from the corresponding validated `REDDIT_*` configuration, including `REDDIT_COMMERCIAL_APPROVAL_CONFIRMED`; local launchers continue to refuse real-provider modes.

It uses application-only client credentials with read scope. The only non-GET request is token exchange at the fixed Reddit OAuth endpoint. Data reads target `oauth.reddit.com`; redirects and arbitrary destinations are refused. Tokens stay in process memory, expire normally and share one refresh request across concurrent callers. Author names are discarded because the current flow does not need them.

Responses are capped at 2 MB with a 10-second request deadline. Transient transport/server failures receive at most three attempts. Rate-limit headers and Retry-After produce a deferred retry timestamp instead of a busy loop. Three authorization failures pause the instance until its configuration is reviewed. Error objects contain fixed codes, never tokens or raw response bodies. There is no scraper fallback.

Transport references: [Reddit's OAuth documentation](https://github.com/reddit-archive/reddit/wiki/OAuth2) and [API endpoint documentation](https://www.reddit.com/dev/api/). These define adapter behavior; commercial permission and current terms must still be reviewed before any live activation.
