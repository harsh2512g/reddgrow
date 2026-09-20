# Phase 2 local brand and knowledge development

Phase 2 adds brand profiles, private knowledge sources, background extraction, and knowledge search to the local ThreadSignal workspace. Processing remains local. The personal hosted Supabase sign-in is available separately; its Phase 2 schema migration was subsequently applied and verified, but hosted worker credential creation awaits explicit approval. See the [hosted migration record](phase-2-hosted-migration.md) and [worker follow-up](phase-2-worker-verification.md).

## Start the local workspace

Run commands from the repository root through the isolated launcher. It clears inherited configuration, uses repository-local state and the public npm registry, and verifies the project's Colima context and service ownership. Existing root `.env.local` files are not loaded.

```sh
./scripts/local pnpm install --frozen-lockfile
./scripts/local pnpm services:start
./scripts/local pnpm services:health
./scripts/local pnpm db:migrate
./scripts/local pnpm db:types
./scripts/local pnpm seed
./scripts/local pnpm build
./scripts/local pnpm dev
```

`db:migrate` applies missing repository migrations without resetting existing local records. `db:types` refreshes the generated TypeScript database contract. Do not substitute `db:reset` when preserving local work. The Phase 2 migration is [20260916000000_brand_knowledge.sql](../supabase/migrations/20260916000000_brand_knowledge.sql).

`seed` adds synthetic fixtures through the same audited allocation functions as the application. It preserves existing brand edits and source processing state, respects current plan capacity, and does not recreate the demo source after a recorded user deletion. A seed run can therefore leave an intentionally archived, deleted, or capacity-limited demo unchanged. Queued fixture ingestion begins when the worker starts.

| Service                                       | Local address                            |
| --------------------------------------------- | ---------------------------------------- |
| ThreadSignal with local Phase 2 processing    | <http://127.0.0.1:3000>                  |
| Local sign-in                                 | <http://127.0.0.1:3000/login>            |
| Local email inbox                             | <http://127.0.0.1:54324>                 |
| Local Supabase API                            | <http://127.0.0.1:54321>                 |
| Worker readiness                              | <http://127.0.0.1:3001/api/health/ready> |
| Separate personal hosted Supabase web profile | <http://localhost:3002>                  |

Keep the local application's `127.0.0.1` hostname consistent when following authentication links. The hosted profile uses `localhost:3002` deliberately and has separate authentication configuration. Starting local development does not automatically start the hosted profile; its existing command is `./scripts/local pnpm dev:hosted`.

All development providers remain Reddit `mock`, AI `mock`, email `console`, billing `mock`, and crawler `fixture`. No production credential is required.

## Try the complete knowledge flow

1. Open the local sign-in page and request a magic link for `owner@threadsignal.test`. Open its message in the local inbox and follow the link in the same browser. This signs into the synthetic ThreadSignal Studio workspace. It does not send an external email.
2. Open **Brands**, choose **ClarityScale AI**, and review the fictional product profile. The seed includes a **ClarityScale demo website** source with six selected pages. Once the worker processes it, open **Knowledge** to inspect its actual stored documents and passages.
3. Alternatively, sign in with a new local test email and create your own organization. Create a brand, select **Use synthetic demo**, review the populated fields, then save. This button fills the form; it does not claim that the fictional company or its product capabilities are real.
4. In the brand's knowledge library, add a **Website** source. Select **Find approved pages**, review the selections, and choose **Add knowledge source**. **Single page** uses the same approved fixture list with one selected page.
5. Watch the source move through pending and processing to ready, partially ready, or a specific failure state. Status refreshes automatically. Open a source to inspect extracted text, page references, counts, and its last processed time.
6. Choose **Search knowledge** and search for a phrase such as `batch image processing` or `image quality limitations`. Results show passages with source titles, URLs or document page references, and links back to their source. Search scores use deterministic mock embeddings and keyword ranking; they do not represent a measured production relevance benchmark.
7. Add a PDF, Markdown, plain-text file, or manual note. Uploaded originals stay in private storage. Use **Download original** on the source detail to retrieve your authorized file.
8. Exclude an extracted document and search again to confirm that it no longer contributes results. Re-include it when appropriate. Use the source's retry or reprocess action to ingest it again; unchanged passages retain their embeddings.
9. Delete a source to remove its extracted content from search immediately. The worker completes private-file and record cleanup. If cleanup fails after bounded retries, the source exposes **Retry cleanup**. Archive a brand to remove it from active knowledge search while retaining its records; restoration checks the current brand limit.

Owners and admins manage brands and sources. Members and viewers can read their organization's knowledge. Organization membership, source ownership, role checks, and plan allocation are enforced in server code and PostgreSQL, including when a caller bypasses the interface.

## Approved fixture pages and limits

The crawler serves these six fictional pages from [repository fixtures](../packages/crawler/src/fixtures.ts):

| URL                                     | Content                                     |
| --------------------------------------- | ------------------------------------------- |
| `https://clarityscale.example/`         | Product overview and capabilities           |
| `https://clarityscale.example/docs`     | Batch API documentation                     |
| `https://clarityscale.example/pricing`  | Fictional product pricing and credit rules  |
| `https://clarityscale.example/limits`   | Supported formats and limitations           |
| `https://clarityscale.example/security` | Fictional privacy and retention information |
| `https://clarityscale.example/support`  | Troubleshooting and support guidance        |

No external website is fetched. A different product domain can hold manual or uploaded knowledge, but it does not gain a public crawling fallback. Approved-domain checks reject a URL on another host; selecting a real provider does not silently enable network crawling. Reddit ingestion, opportunity scoring, and reply generation remain later-phase work.

| Allocation or extraction         | Limit                                                                 |
| -------------------------------- | --------------------------------------------------------------------- |
| Active brands                    | Trial/Solo: 1; Growth: 3                                              |
| Sources per brand                | 100 undeleted sources                                                 |
| Selected website pages per brand | Trial/Solo: 30; Growth: 100, shared across sources                    |
| Original file size               | 10 MiB                                                                |
| File formats                     | PDF, Markdown (`.md`/`.markdown`), plain text (`.txt`)                |
| Manual or extracted text         | 500,000 characters; PDF extraction applies the bound across its pages |
| PDF page count                   | 100                                                                   |
| PDF extraction deadline          | 15 seconds in an isolated parser thread with memory limits            |
| Search query                     | 1–500 characters; at most 20 results                                  |

File validation checks extension, MIME, size, and content signatures before storage. The worker validates again before extraction. Encrypted, unreadable, empty, and oversized documents produce bounded error codes with recovery guidance. Image-only PDFs require an existing readable text layer; no OCR provider is enabled.

## How processing and isolation work

The brand profile is a validated JSON document. Its competitors, default representative's real role and disclosure, and product vocabulary are mirrored into relational tables in the same transaction. PostgreSQL locks organization allocation before checking active-brand, source, and website-page limits, so concurrent requests cannot reserve the same remaining capacity.

Adding or retrying a source commits a `knowledge_jobs` outbox record alongside the source change. BullMQ carries only the durable job identifier. The worker claims the database job with a generation number and a 90-second lease, renews the lease while processing, and checks the current source generation and lease before publishing content. Duplicate deliveries and stale generations cannot publish over newer work. Failures receive bounded backoff with a maximum of three attempts; a manual retry creates a new generation.

Normalized text is split into approximately 750-token passages with approximately 100 tokens of overlap. These are estimates based on text length, rather than a paid model's tokenizer. SHA-256 checksums deduplicate repeated passages and reuse unchanged embeddings. The deterministic mock AI adapter produces 512-dimensional vectors stored in PostgreSQL with a pgvector HNSW index. Search combines cosine similarity and text ranking while applying tenant RLS, active-brand, source-state, and document-inclusion filters. URLs, PDF page numbers, and section headings remain associated with the extracted content.

All eight Phase 2 tables enforce tenant read policies. Application roles receive read access and narrowly granted mutation functions, rather than direct table writes. Composite foreign keys prevent a document or chunk from mixing another organization's brand or source identifiers. Audit records contain action metadata, not document contents or credentials.

Original files live in the private `knowledge-private` bucket under `organization/brand/source/filename`. Uploads cannot overwrite an existing object. Only an authorized member can read a committed source; owners/admins can also access their own uncommitted upload for failure cleanup. Deleting a source immediately purges its documents and chunks, clears manual text, and changes its generation. Its tombstone remains until the worker removes the original and finishes cleanup.

The worker launcher reads storage authorization afresh from this repository's verified local Supabase stack after validating the exact Colima context and owned containers. That local service-role value is passed only to the worker process: it is not printed, written to a configuration file, passed to the web app, or included in a queue payload. The worker accepts only the guarded local PostgreSQL, Redis, and Supabase endpoints. No existing external credential is read or reused.

## Run or troubleshoot the worker independently

The normal `pnpm dev` command starts the web app and worker together. To run only the built worker after services, migrations, and builds are ready, use:

```sh
./scripts/local pnpm --filter @threadsignal/worker start
```

For the worker's watch mode, use:

```sh
./scripts/local pnpm --filter @threadsignal/worker dev
```

Use one of these in place of the worker already started by root `pnpm dev`; a second process cannot bind the same health port. Both commands go through [scripts/worker.mjs](../scripts/worker.mjs), preserving its local ownership and credential checks.

Open the worker readiness URL to inspect database, Redis, and queue-heartbeat checks. A ready response returns HTTP 200; an unavailable dependency or stale heartbeat returns HTTP 503. This endpoint is an infrastructure check, not proof that a particular knowledge source finished successfully. Confirm that source's status in the application.

If sources stay pending, check that the worker terminal remains running, then run:

```sh
./scripts/local pnpm services:health
```

Read the source's safe error message before retrying. Fix invalid input instead of repeatedly retrying an encrypted, empty, or unsupported file. A partially ready website source keeps successfully extracted pages available; retry it after correcting the underlying selection or fixture issue.

Stop the development process with Ctrl+C before stopping the local services:

```sh
./scripts/local pnpm services:stop
```

The personal hosted profile currently shares the guarded local Redis authentication limiter, so stopping these services also affects that profile's local authentication support.

## Application API and verification

Phase 2 uses server loaders for authenticated reads and consolidated mutation routes: `POST /api/brands`, `PATCH /api/brands/:id` for profile or archive changes, `POST /api/brands/:id/knowledge` with a validated source-type discriminator, a separate multipart `/upload`, source `/retry` and `DELETE`, document inclusion `PATCH`, search, and an authenticated original-file download. The worker never runs inside a web request. See the architecture decisions for the deliberate route consolidation rather than assuming every illustrative endpoint from the master specification is a separate handler.

Hosted requests fail the Phase 2 mutation gate before any Phase 2 database or storage query. Hosted pages explain the local availability boundary while preserving Phase 1 sign-in. Enabling hosted processing later requires a separately reviewed migration and restricted worker connection; the public publishable key alone does not grant worker administration access.

The database integration suite covers tenant and role isolation, concurrent quotas, private storage, source generations, cleanup retry, and vector retrieval. Web API tests cover hosted gates, origins, role and workspace selection, error redaction, uploads, and downloads. Pipeline and worker tests cover extraction, chunking, embedding reuse, queue delivery, and lease behavior. Current executed outcomes and remaining external verification limits belong in the Phase 2 verification report and [implementation status](../IMPLEMENTATION_STATUS.md).
