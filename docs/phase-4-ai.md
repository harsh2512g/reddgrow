# Phase 4 drafting and AI providers

The development worker remains on `AI_PROVIDER=mock`. No external AI request, credential lookup, login, or account operation is needed for the complete local draft workflow.

## Shared contracts

`@threadsignal/drafts` exports browser-safe Zod schemas and types for draft controls, the real persona, generated drafts, independently extracted claims, verification, and all twelve compliance checks. The server-only `@threadsignal/drafts/pipeline` entry point exports:

- `generateDraft(context, ai?)`: returns the structured generation object from specification §7.10.
- `verifyDraft({ ...context, text }, ai?)`: re-extracts the actual final text and returns claim-level verification.
- `checkDraftCompliance({ ...context, text, verification }, ai?)`: returns a separate twelve-check compliance result.
- `processDraft({ ...context, text? }, ai?)`: composes those stages and returns text, results, checksums and the engine version.

Contexts carry the brand, real persona, post state, community rules, at most eight retrieved knowledge chunks with metadata, regeneration preferences, and an explicit evaluation time. Retrieval and tenant authorization belong to the worker and database; the package does not read a database, environment file or browser session. The worker supplies organization-scoped input identity and prevents stale results from being published or approved.

## Local generation and evidence

The deterministic mock starts with useful workflow advice, retains honest affiliation, and quotes relevant complete assertions from current included knowledge. It prioritizes documentation and lexical matches to the question or requested capability. Concise, standard and detailed length preferences, technical depth, product-free advice, and recognized custom-instruction preferences are supported. Custom instructions also influence source ranking; the mock explicitly reports that it cannot perform arbitrary natural-language rewriting. No-brand mode omits product recommendations while retaining the required affiliation statement.

Verification does not trust the generator's list of claims. It extracts every sentence from the final text, including edits, semicolon-separated assertions and new lines. The conservative local verifier requires a complete assertion to match current source wording. Keyword overlap or a supported prefix does not verify an extra promise, quantity or capability. Known contradictory limitations and quantities take precedence over a supporting sentence. Unsupported or contradicted statements block approval; there is no contradiction override. The UI can explain conservative false negatives and allow the author to use the documented wording or add a current verified source.

Stale, future-dated and inferred material cannot establish a verified claim. Source dates older than ninety days count as stale even when a caller omitted the flag. Exact matches to stale/inferred evidence are explicitly partial and lower-confidence; normal worker retrieval excludes that evidence from generation. General workflow advice and configured truthful affiliation are distinguished from product claims. Source matching establishes provenance to supplied documentation, not an independent guarantee that the documentation itself is true.

The complete twelve-check pass covers relevance, unsupported claims, fake experience, affiliation, promotion, comparisons, links, community conflicts, manipulation, personal data, important limitations, and no-vendor requests. Warning results require acknowledgement in the application. Any failed check prevents approval. Deleting or changing the disclosure triggers fresh checks. A selected tone never authorizes a fabricated founder/customer identity. Overlong or excessive assertions fail safely instead of silently leaving text unchecked.

## Configurable external adapter, disabled locally

`OpenAICompatibleProvider` implements structured text generation and 512-dimensional embeddings. `createAIProvider()` still creates the deterministic mock. An external provider requires explicit options containing the new personal API key and configured fast, smart, and embedding model identifiers; no model identifier is hardcoded. A compatibility base URL can be supplied, but it must be a credential-free public HTTPS hostname. Redirects are refused, and network use requires explicit opt-in unless an intercepted test transport is injected. The class never reads process environment or discovers existing credentials.

The adapter sends separate trusted instructions and untrusted task data. Draft generation, claim extraction, claim verification and compliance use separate tasks and schemas. A structured model result can make the local safety result more conservative but cannot override deterministic hard blocks or turn weak lexical support into verification. Supplied evidence identifiers are checked against the retrieved context.

Operational limits:

- At most 150,000 input characters; output token budget configurable between 100 and 16,000, default 6,000.
- Configurable request timeout, default 15 seconds; maximum 60 seconds.
- At most two retries for transient transport/server failures; authentication errors are not retried.
- `Retry-After` and exhausted request-rate headers persist a pause deadline; calls during the pause return a safe retry deadline without running a hidden loop.
- Circuit breaker for repeated transport or malformed-output failures, with a configurable cooldown.
- Optional configured model fallback makes at most one extra call and is available only when ordinary retries are disabled.
- Two-megabyte response limit, strict JSON schema conversion, refusal/truncation checks, and Zod validation before use.
- Embedding arrays require exactly 512 finite values, nonzero magnitude, complete unique indices and the correct batch size.
- The usage callback receives actual provider-reported token counts, model/task/latency, and cost derived only from explicitly configured rates. Missing prices produce `null`; mock calls do not fabricate token use or expense. Telemetry failures never trigger a duplicate paid request.

The worker owns caching with tenant identity, job idempotency, quota reservations and stale-context fencing. The provider itself does not share generated content across organizations.

Strict structured-output field handling and embedding requests follow the official [structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) and [embedding endpoint reference](https://developers.openai.com/api/reference/resources/embeddings/methods/create), checked on 2026-09-16. Only intercepted HTTP transport tests were executed. A real account, model compatibility, external rate limits and live costs remain unverified. Explicit owner confirmation is required before any external activation under the repository isolation rules.

## Focused verification

Run through the isolated repository launcher:

```bash
./scripts/local pnpm exec vitest run packages/ai/tests packages/drafts/tests
./scripts/local pnpm --filter @threadsignal/ai --filter @threadsignal/drafts typecheck
./scripts/local pnpm --filter @threadsignal/ai --filter @threadsignal/drafts lint
./scripts/local pnpm --filter @threadsignal/ai --filter @threadsignal/drafts build
```

Adversarial tests cover unsupported suffixes and compound claims, modified quantities and negations, conflicting current sources, stale/inferred evidence, injected instructions, forged citations, missing and deceptive affiliation, duplicate or missing compliance checks, locked/deleted posts, no-vendor requests, private data and attempt limits. The full Phase 4 verification report records final suite counts and application/database checks.
