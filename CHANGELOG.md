# Changelog

## 0.1.0 — 2026-09-26

Initial ThreadSignal MVP source release, verified with local Supabase and deterministic development providers. This entry describes implemented functionality and local acceptance; it does not announce a hosted launch, a Chrome Web Store release or live-provider approval.

### Added

- Next.js marketing and customer application, Supabase authentication, organization roles, invitations and guided onboarding.
- Brand knowledge from approved website pages, private uploads and notes; source-backed product extraction, search and embedding identity checks.
- Community/keyword monitoring, scheduled opportunity scoring and an explainable, filterable feed.
- Evidence-backed draft generation, independent claim/compliance review, version history and explicit human approval.
- Manifest V3 extension connection, editing, copying and insertion. The extension never submits Reddit comments.
- Consent-aware click/conversion attribution, analytics, subscription limits, mock billing and notification workflows.
- Audited platform operations, bounded retries, private data exports/deletion, retention and tenant isolation.
- Guarded real-provider adapters, restricted deployment profiles, migrations, CI, setup/deployment documentation and a disposable local verification harness.

### Fixed during release review

- Website preview now reads the correct Supabase subscription response and applies plan bounds.
- Web AI work checks current Supabase plan eligibility before invoking a provider.
- Failed and retried draft attempts retain idempotent usage receipts; missing usage remains unknown.

### Verification and limitations

The [Step 13 review](docs/step-13-review.md) records 1,490 unit tests, 268 integration tests, 38 browser tests with two intentional duplicate mobile skips, one MV3 test with zero submit attempts, and passing static/build/database checks. [Release preparation](docs/step-14-release.md) records subsequent metadata/tooling checks and publication status.

Local defaults remain Reddit/AI/billing `mock`, email `console` and crawler `fixture`. Live Reddit/AI/Stripe/email/crawler/Google OAuth, hosted Phases 3–8, deployed monitoring/performance, the Node 24 CI target and native Reddit editor compatibility remain unverified. Two non-failing Next.js render-stream diagnostics and the historical Phase 0 isolation exception remain open. No release tag is created while full release acceptance remains outstanding.
