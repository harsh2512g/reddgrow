# Phase 3 local opportunity pipeline

Use **http://127.0.0.1:3000/app/opportunities** for the local conversation radar. The separately running **http://localhost:3002** application uses your personal hosted Supabase for sign-in; Phase 3 processing and data are local and are not synchronized to that project.

## Why the local workspace asks you to sign in

The buttons for opening the local product studio, knowledge studio, or conversation radar leave the hosted workspace and open the separate local application. Your hosted Supabase account does not sign you into local Supabase, so an unsigned-in local browser is sent to the local login page. This does not sign you out of the hosted workspace or copy its accounts and data.

To explore the seeded local demo:

1. Open [local sign-in](http://127.0.0.1:3000/login) and request a magic link for `owner@threadsignal.test`.
2. Open the [local Mailpit inbox](http://127.0.0.1:54324) in another tab of the **same browser**. The message stays on your machine; it is not delivered to a real email inbox.
3. Open the newest message for `owner@threadsignal.test` and follow its sign-in link in that same browser. Keep using `127.0.0.1:3000` for the local app rather than switching between `localhost` and `127.0.0.1`.
4. Open the desired tab. The seeded ClarityScale AI brand and its local data are separate from your hosted organization.

No Supabase dashboard credentials or real-provider keys are needed for this demo.

## What each tab does

Availability below describes the current development setup. The local and hosted workspaces each have their own accounts and records.

| Tab             | Purpose                                                                                                                                      | Available now                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Overview        | Workspace summary, plan, team size, your role, and setup shortcuts.                                                                          | Local and hosted                         |
| Brands          | Describe the product, audience, capabilities, competitors, affiliation, and claims to avoid; edit or archive a brand.                        | Local                                    |
| Knowledge       | Add approved fixture pages, private files, or notes; review processed sources, choose what to include, and search supporting citations.      | Local                                    |
| Opportunities   | Review scored synthetic discussions, filter cards or a table, inspect evidence, and save, monitor, dismiss, archive, or re-evaluate records. | Local                                    |
| Communities     | Select subreddits to monitor, review rules, adjust priority and minimum score, pause monitoring, or refresh posts and rules.                 | Local                                    |
| Keywords        | Configure matching terms, intent categories, and exclusions; review suggestions and preview matches.                                         | Local                                    |
| Organization    | Manage workspace details, timezone, currency, and owner billing email; submit data requests.                                                 | Local and hosted                         |
| People & access | Invite teammates, assign roles, remove members, and revoke invitations within your permissions.                                              | Local and hosted                         |
| Plan & usage    | Review plan/trial records, current team-seat allocation, and published limits. Opportunity usage appears in Opportunities.                   | Local and hosted; paid checkout disabled |
| Integrations    | Inspect the connected Supabase mode and the mock, console, and fixture provider status.                                                      | Local and hosted                         |

For a new product, select or create a workspace, then follow **Brands → Knowledge → Communities → Keywords → Opportunities**. Give the worker time to process knowledge and monitored discussions before reviewing the feed. Reply drafting, publishing assistance, revenue analytics, and real payment collection are not available yet.

## Start and try it

Run from this repository, preserving local data:

```sh
./scripts/local pnpm install --frozen-lockfile
./scripts/local pnpm services:start
./scripts/local pnpm db:migrate
./scripts/local pnpm db:types
./scripts/local pnpm seed
./scripts/local pnpm dev
```

1. Open local sign-in, request a magic link for `owner@threadsignal.test`, and follow it from the local inbox at **http://127.0.0.1:54324** in the same browser. This is a synthetic local account, separate from your hosted login.
2. The named ClarityScale AI demo brand has verified synthetic website pages and four communities. The worker imports and scores their discussions. Seed initializes monitoring once and preserves later pauses, removals, edits, and usage.
3. For a fresh workspace, create a brand with **Use synthetic demo**, approve its six website pages, and wait for knowledge to become ready.
4. Open **Communities**, search **SaaS**, and select **Monitor community**. Explore rules, change monitoring sorts or minimum score, add internal notes, pause/resume, and explicitly refresh posts or rules. Trial plans allow three monitored communities; Solo ten and Growth forty across the organization.
5. Open **Keywords** to add or pause terms, select intent categories, accept deterministic suggestions, configure exclusions, and preview matches against invented discussions. Competitor aliases may include misspellings; notes stay attached across brand edits.
6. Open **Opportunities**. Recent image API recommendations rank high, comparisons rank medium, exploratory research ranks low, and a demand for guaranteed perfect recovery is blocked. Records below score 40 are hidden by default; select the blocked filter or lower the minimum score to inspect them.
7. Filter and sort the feed, switch between cards and a compact table, save a discussion, monitor it, dismiss it with a reason, or dismiss selected records together. Open a detail page for component scores, penalties, community guidance, product gaps, and verified knowledge citations.
8. Re-evaluate a record after adjusting its context. Saved/monitoring states remain unless a hard block applies; dismissed/archived decisions remain preserved. Rescoring never consumes another unit of opportunity usage. Deleted provider content is purged and cannot become actionable again.

Owners/admins manage communities and keywords. Members may review/save/dismiss/rescore opportunities; viewers are read only. Every mutation also checks organization membership and PostgreSQL permissions.

## Processing and configuration

All providers stay Reddit `mock`, AI `mock`, email `console`, billing `mock`, crawler `fixture`. The repository contains 26 invented posts across SaaS, webdev, ecommerce, and ArtificialIntelligence. No Reddit content is scraped or fetched during local development. No automatic comments, votes, messages, or final submission actions exist.

The SQL outbox and separate ingestion/evaluation BullMQ queues carry IDs only. Active communities refresh about every ten minutes; rules refresh daily and on demand. Post state refreshes every twelve hours. An unchanged listing or duplicate delivery cannot create another opportunity or consume usage again. Leases expire after 90 seconds, renew while processing, and permit three attempts before a visible failure. Provider errors use bounded codes, never content or credentials in logs.

`config/reddit-development.json` controls maximum post age and content retention (1–30 days, with age no greater than retention). The worker launcher validates this repository-local file and supplies the corresponding named environment fields. It does not load root `.env.local`. Content that cannot be refreshed for 48 hours is conservatively purged; explicit deletion removes post text, identity, URLs and derived evaluation content while retaining operational tombstones.

Trial allocation is twenty opportunities for the trial period. Solo/Growth use 100/500 per subscription period. Allocation locks the organization and is idempotent; deleting or dismissing content cannot reset usage. Expiry or plan limits preserve existing records while refusing new allocations.

The read-only OAuth Reddit adapter is implemented and tested with injected transport. It requires explicit commercial approval, app credentials and a truthful User-Agent, enforces fixed HTTPS hosts, honors rate limits, bounds retries, and pauses repeated authorization failures. The isolated launchers deliberately retain the mock provider. Live Reddit/AI operation and hosted Phase 3 require separate configuration and approval; no production credential is needed here.

## Verify and troubleshoot

Stop local development before the service integration/browser suites, then run:

```sh
./scripts/local pnpm lint
./scripts/local pnpm format:check
./scripts/local pnpm typecheck
./scripts/local pnpm test
./scripts/local pnpm build
./scripts/local pnpm db:lint
./scripts/local pnpm test:integration
./scripts/local pnpm test:e2e
./scripts/local pnpm secrets:check
```

If a feed is empty, check the selected brand, active community status, plan capacity, keywords/exclusions, minimum score, and worker readiness at **http://127.0.0.1:3001/api/health/ready**. The `opportunities` check must be `up`. Use **Sync now** or **Re-evaluate** after resolving a failure. A blocked opportunity explains why participation is unsuitable; changing a UI status cannot override the block.

Reply drafting and verification belong to Phase 4 and have not been started. No cloud migration, hosted worker credential, deployment, commit, or push is part of Phase 3 local development.
