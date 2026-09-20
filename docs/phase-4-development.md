# Phase 4 local development

Phase 4 adds draft preparation and human review to the verified local opportunity workflow.
Use [the local workspace](http://127.0.0.1:3000/app). The hosted-login application on
port 3002 uses a separate Supabase project; Phase 3/4 processing is not enabled there.
Sign in locally as `owner@threadsignal.test` using the magic link in
[the local inbox](http://127.0.0.1:54324). Keep the link in the same browser.

## Start and use the workflow

```sh
./scripts/local pnpm install
./scripts/local pnpm services:start
./scripts/local pnpm db:migrate
./scripts/local pnpm seed
./scripts/local pnpm dev
```

If this is a new database, let the worker ingest the seeded knowledge and mock
communities. Running `seed` again then queues one eligible demo draft. Seed never
approves a draft or overwrites human edits.

1. **Brands / Knowledge:** establish the product and include current supporting sources.
2. **Communities / Keywords:** define monitoring and exclusions.
3. **Opportunities:** review a high-intent conversation, its score and community rules;
   choose **Generate draft** on an eligible opportunity.
4. **Drafts:** generation is followed by independent claim verification and twelve
   compliance checks. Inspect the source title, URL/file, page/section, date and excerpt.
5. **Editor:** edit normally; autosave creates a version after a pause. **Save now**
   saves immediately. Every edit clears approval and queues checks. Compare versions,
   restore an earlier version, or regenerate with safe length/style controls.
6. **Persona:** configure your actual role, tone, technical depth, default reply length,
   truthful affiliation, and allowed/prohibited first-person statements.
7. **Review:** fix unsupported or contradicted claims. Acknowledge warnings explicitly
   and accept responsible use before the first approval. Approval belongs to the exact
   saved version and current evidence. Copy becomes available only after approval.
   Rejection records a reason; feedback records what was useful or needs improvement.

Approval and copying do not publish anything. This phase has no extension handoff,
Reddit submission, voting, messaging, tracking or attribution actions.

Advice-only regeneration retains your truthful disclosure even when it names the
brand. Save status remains visible during editing. Application links, workspace
switching and sign-out ask before abandoning pending edits; browser Back/Forward
protection additionally depends on a cancelable Navigation API event. Older browsers
retain autosave and the standard page-unload prompt, but cannot reliably cancel every
same-document history traversal.

## How verification works

The local deterministic mock quotes complete sentences from current included knowledge.
It independently checks the final text, including human edits. A paraphrase may remain
unsupported: use the documented wording or add an appropriate source. Matching a keyword
is not proof. Conflicting evidence, fabricated experiences, missing affiliation,
prohibited links and community restrictions prevent approval. Other findings can require
explicit human acknowledgement.

Retrieval uses at most eight chunks and 24,000 source characters, with vector/keyword
ranking and preference for documentation and pricing. Budget defaults come from
`config/drafts-development.json`; validation caps source context at 24,000 characters
and the complete request context at 80,000. Sources older than ninety days
are excluded. The full thread and rules are checked; an excessive total context fails
visibly rather than silently dropping restrictions. A bounded five-minute cache stores
only tenant-scoped retrieved source IDs, never discussion or draft text.

A source, persona, brand, post or rule change invalidates previous verification. Deleted
Reddit content and its derived draft text/evidence are purged. Historical versions cannot
be used to bypass a fresh review. The server and database enforce the same organization,
role, version, plan and approval constraints as the UI.

## Usage and failures

Each new generation or regeneration reserves one unit: trial 10, solo 60, growth 300
per subscription period. Repeating an identical idempotent request does not charge again.
Edits and verification do not consume another generation unit. Failed generations retain
their reservation to bound repeated provider attempts. Worker jobs have up to three
attempts; a lost lease cannot overwrite later work. Only safe error codes are stored.

All runtime providers remain mock/console/fixture. Mock cost receipts correctly record
zero billed tokens and cost. The real AI adapter is implemented and tested using injected
HTTP responses, but is not enabled or live-tested. See [AI design](phase-4-ai.md).

## Checks and shutdown

```sh
./scripts/local pnpm lint
./scripts/local pnpm format:check
./scripts/local pnpm typecheck
./scripts/local pnpm test
./scripts/local pnpm build
./scripts/local pnpm test:integration
./scripts/local pnpm test:e2e
./scripts/local pnpm services:health
./scripts/local pnpm services:stop
```

Stop `pnpm dev` before production-build E2E tests or integration tests that start the
worker on port 3001. Browser tests use fresh local sessions and synthetic fixtures;
no existing browser accounts or hosted credentials are used.
