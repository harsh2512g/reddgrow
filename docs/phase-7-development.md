# Phase 7: billing and notifications

Supabase remains the backend for authentication, organizations, subscriptions, usage and notification records. Open the local app at `http://127.0.0.1:3000`. Phase 7 does not change the personal hosted database or activate real payment/email providers.

## Plan and usage

Open **Settings → Plan & usage**. An owner can select Solo or Growth, review the confirmation, and activate a development subscription. No card is collected or charged. Members see the current plan and usage without payment controls or sensitive billing details.

Meters come from Supabase: active brands, monitored communities, team seats including pending invitations, opportunities and AI drafts. The trial permits ten AI drafts; Solo permits sixty and Growth three hundred per period. At the limit, the server refuses new work and the draft screen links to an upgrade. An upgrade carries consumed units forward. Downgrades retain existing data and block new usage above the lower limits.

Canceling keeps the current allocation until the period ends. Resume reverses a pending cancellation. A payment failure has a three-day grace period; payment recovery clears it. Local renewal and expiry run in the worker. Owner-only local API simulations support `payment_failed`, `payment_recovered` and `renew` through `POST /api/billing/portal`; renewal is refused before the period ends. These actions never contact a payment processor.

## Notifications

Open **Settings → Notifications** to enable or disable welcome, invitation, knowledge completion/failure, daily digest, high-score, trial-ending, usage-limit, payment-failure and subscription-change updates. Each membership has separate preferences. Digests require Solo or Growth; the preference survives a downgrade. Digest and quiet-hour times use the organization's timezone, shown on the screen. Owners/admins change that timezone in organization settings.

The local worker records console delivery as **suppressed**. It does not send email. Category opt-outs, membership removal, source deletion, superseded ingestion, current opportunity score, stale lifecycle reasons and quiet hours are checked again before delivery. Jobs have a stable delivery identity, a fenced lease, three bounded attempts and a 23-hour retry boundary. Deferred jobs use their next due time in the queue ID so completed queue entries cannot prevent rescheduling. User-visible delivery history is available at `GET /api/notifications/deliveries`; raw addresses, bodies and provider payloads are not returned. For a future real provider, `sent` means the provider accepted the message; it does not prove inbox delivery.

## Local commands

Run from the repository root. The launcher clears inherited provider credentials and uses repository-owned paths and the verified Colima socket.

```sh
./scripts/local pnpm install --offline --frozen-lockfile
./scripts/local pnpm services:start
./scripts/local pnpm db:migrate
./scripts/local pnpm db:types
./scripts/local pnpm seed
./scripts/local pnpm dev
```

Keep `REDDIT_PROVIDER=mock`, `AI_PROVIDER=mock`, `EMAIL_PROVIDER=console`, `BILLING_PROVIDER=mock`, and `CRAWLER_PROVIDER=fixture`. Root `.env.local` is not loaded by the local launcher. Stop the development process before running the production-build E2E suite so ports and generated Next output are available.

## Provider activation remains separate

The Stripe and Resend adapters are implemented and tested using injected transports; no external account is needed for those tests. Current runtime guards intentionally keep them inactive. A separately authorized activation task must prepare the runtime profile, apply reviewed Supabase migrations to the selected personal project, and verify real test-mode delivery. No production credential is requested.

The existing `.env.example` files contain variable names only. Future Stripe activation uses `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, and the existing public Stripe key setting. Resend uses `RESEND_API_KEY` and `EMAIL_FROM`. Values belong only in an explicitly authorized ignored profile, never source control or chat.

The Stripe webhook endpoint must match API version **2026-08-26.dahlia**. Price IDs must identify active USD monthly prices of $29/$79, quantity one. Configure the Billing Portal to use those plans. Signature verification consumes the exact raw request body; duplicates and older events cannot grant duplicate usage or restore a terminated subscription. Stripe documents [API versioning](https://docs.stripe.com/api/versioning), [webhook delivery](https://docs.stripe.com/webhooks), and [idempotent requests](https://docs.stripe.com/api/idempotent_requests). Resend's [idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys) is 24 hours; the durable retry boundary leaves one hour of headroom.

## Manual review

1. Sign in with a local account and create/select your workspace.
2. Review Plan & usage, activate a mock paid plan, reload and confirm usage is preserved.
3. Cancel, reload, then resume. Confirm data stays available throughout.
4. Save notification categories, digest time, score and quiet hours; reload to verify persistence.
5. Switch to a member/viewer account: billing changes must remain unavailable, while personal notification preferences can be edited.
6. Use the automated Journey D for the ten-draft limit, direct API refusal, upgrade and eleventh draft. It uses disposable synthetic records and cleans them up.
