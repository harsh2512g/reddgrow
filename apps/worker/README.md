# ThreadSignal worker

The Phase 2 worker runs local knowledge ingestion and an operational BullMQ heartbeat.
Start it from the repository root after local services and migrations are available:

```sh
./scripts/local pnpm dev
```

The isolated launcher `scripts/worker.mjs` verifies this repository's exact Colima context,
container ownership and loopback service ports. It reads the fresh local stack's storage
service-role key directly into the worker child environment. The key is never persisted,
printed, placed in a queue, or passed to the web app. Existing dotenv files are not loaded.
Hosted processing is disabled; the personal hosted website does not dispatch local jobs.

## Durable knowledge jobs

`knowledge_jobs` is a PostgreSQL outbox committed with source mutations. BullMQ's
`knowledge-ingestion` queue contains only the durable UUID. A poll every 1.5 seconds
reconciles due outbox records, so Redis restart or a lost enqueue does not lose ingestion.
Concurrency is two. PostgreSQL owns the maximum three attempts and exponential retry
backoff; completed Redis deliveries are removed. Failed attempts and fixed error codes
remain visible on the knowledge source and durable job record.

A transaction locks the source before claiming a job. Each attempt receives a unique
90-second lease, renewed every 20 seconds. Expired attempts can be reclaimed. Publication
requires the same lease and source generation while holding the source lock; deleting or
retrying a source prevents an old worker from restoring stale content. An exhausted lease
becomes a visible failure. Manual retries create a new source generation.

The local pipeline supports six approved ClarityScale website fixtures, manual text,
UTF-8 text/Markdown files and PDF uploads. The crawler never performs network or DNS
requests. Unknown targets, private addresses, login/cart/media URLs and other providers
fail closed. Canonical URLs discard query and fragment duplicates.

Original uploads remain in the private `knowledge-private` bucket. Storage requests are
restricted to `http://127.0.0.1:54321` and matching organization/brand/source paths, with
redirects disabled, timeouts and 10 MB read limits. PDFs are parsed in a resource-limited
worker thread with a 15-second deadline, 100-page limit and 500,000-character extraction
limit. Password-protected, unreadable and binary files produce safe errors.

Normalized documents split into approximately 750-token chunks with approximately
100-token overlap; source URL, PDF page and Markdown heading provenance are retained.
Content checksums preserve unchanged chunk IDs and reuse unchanged embeddings. The
512-dimensional mock embedding uses deterministic word features for useful local search;
it is lexical similarity, not a live AI model. No paid provider is contacted.

Deleting a source immediately removes its searchable documents in SQL. The cleanup job
removes its original file before removing the tombstone. Failed storage cleanup remains
visible and supports a bounded manual retry.

## Health and operations

The worker binds to `127.0.0.1:3001`. `GET /api/health` reports process liveness;
`GET /api/health/ready` reports readiness when PostgreSQL, Redis and the recent heartbeat
are healthy. The heartbeat queue runs at concurrency one under the existing
`threadsignal-foundation` Redis prefix. It never writes customer data.

SIGINT/SIGTERM stop scheduling, close the listener and drain work. A ten-second shutdown
deadline may terminate a slow parser; its durable lease then recovers after expiration.
Logs contain safe event codes and job IDs, without connection URLs, document text,
credentials or raw provider errors.

To verify the production bundle locally:

```sh
./scripts/local pnpm --filter @threadsignal/worker build
./scripts/local pnpm --filter @threadsignal/worker start
```

Run integration tests with the development worker stopped: those tests deliberately
control individual leases and source generations. The service test starts and stops its
own heartbeat/knowledge worker; files run sequentially.
