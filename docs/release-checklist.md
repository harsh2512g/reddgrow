# Release checklist

Local acceptance and production launch are separate decisions. Use the current [implementation status](../IMPLEMENTATION_STATUS.md), [Step 12 verification](audit-verification.md) and [Step 13 review](step-13-review.md) for dated evidence. Step 12 completed a disposable database reset/seed rehearsal and restored original services; existing local records were not reset. This was not a database-plus-Storage backup restoration test.

## Local release candidate

- [x] Frozen install uses the pinned lockfile and public npm only.
- [x] `lint`, `format:check`, `typecheck`, `test` and `build` pass.
- [x] Migration lint/generated types/seed and real local integration tests pass without data reset.
- [x] Full web E2E passes; skip reasons are recorded.
- [x] Extension build and real MV3 fixture E2E pass with zero submit attempts.
- [x] Admin role denial, safe summaries/retries, pause/resume and privacy workflows pass API/SQL/browser coverage.
- [x] Deleted Reddit text/derived content/export access cannot reappear through stale jobs.
- [x] Supabase/Redis/worker/web readiness and dev startup pass on the exact owned Colima context.
- [x] Secret scanning, ignored dotenv/dependencies and supported credential pattern checks pass.
- [x] Public npm audit has no unresolved high/critical findings; advisory date and package scope are recorded.
- [x] Keyboard, focus, labels, status announcements, responsive overflow and production nonce CSP are reviewed on core flows.
- [x] Every failed/interrupted command is retained with its resolution; no pending gate is called passed.

## Before any hosted launch

- [ ] Owner explicitly approves new personal accounts, destinations, runtime profile, migrations and external writes.
- [x] [Runtime activation prerequisites](deployment.md) are implemented and covered by local configuration/authority tests; deployment remains unverified.
- [ ] Hosted migration history/schema/roles/RLS and private Storage are independently verified.
- [ ] Declared Node 24 and remote CI/service runner have actually passed.
- [ ] HTTPS host/origin/cookie/CSP behavior and rate limits are verified at deployed ingress.
- [ ] Database plus Storage restore rehearsal meets an approved RPO/RTO; deletion/revocation replay is tested.
- [ ] Measured queue/provider/error/latency signals reach an approved monitor and a test alert reaches its operator.
- [ ] Approved Reddit OAuth and deletion synchronization are live-tested; missing approval leaves ingestion mocked.
- [x] The real crawler implementation and injected SSRF/DNS/redirect/robots/bounds suite exist and pass locally.
- [ ] Approved customer-site crawling, DNS and TLS are verified from the deployed runtime before live website ingestion is enabled.
- [ ] AI model/dimension/cost/data-processing choices are approved and tested without training on Reddit content.
- [ ] Stripe test subscription and signed event lifecycle change Supabase limits; no live charge is inferred from fixtures.
- [ ] Resend approved-recipient delivery and notification opt-out/retry/quiet-hour behavior are verified.
- [ ] Chrome HTTPS package, minimal permissions, data disclosures and manual live editor QA are reviewed.
- [ ] Public privacy/terms, support contact, retention and incident process are owner-reviewed.
- [ ] Historical isolation exception and any unresolved release risk have an explicit owner disposition.

Publishing the application or extension, enabling a paid provider or provisioning a cloud account is not part of local acceptance. No deployment, account login, external write, commit or push is authorized by checking a local test box.
