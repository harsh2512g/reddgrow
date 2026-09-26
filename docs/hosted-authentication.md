# Hosted Google and email sign-in

ThreadSignal uses Supabase Auth for both methods. Deploying the web bundle does not enable a Supabase provider or configure email delivery. The local demo intentionally keeps Google disabled and sends local Auth emails to Mailpit.

## Findings on 2026-09-26

The owner's supplied deployment URL redirected anonymous `/login`, `/api/health` and `/api/health/ready` requests to Vercel's SSO protection endpoint (HTTP 302), before ThreadSignal could answer. No Vercel browser session or protection bypass was used. Use the project's intended public production domain for customer sign-in. If the supplied preview is intentionally protected, it is not yet a public login test target.

A read-only request to the public settings endpoint of the previously supplied personal Supabase project returned Google **disabled**, email **enabled**, signup **enabled**, and email confirmation **required**. This does not establish which project or environment the protected Vercel deployment actually uses. No user records, provider secrets, SMTP settings or cloud environment values were read.

An isolated Chromium reproduction confirmed that the old native Google form's cross-origin redirect was blocked by `form-action 'self'`. The fixed button makes a same-origin JSON request, waits for its PKCE cookie response, validates the configured Supabase authorization destination, and then navigates. Errors and pending state stay on the login page. CSP, origin checks, rate limits and local provider restrictions remain enforced. Callback configuration failures now return to a relative login URL instead of the visitor's localhost.

## Vercel web environment

Choose one canonical HTTPS application origin from the project's production domains. Use that same origin in the browser, `NEXT_PUBLIC_APP_URL` and Supabase Site URL. Do not add `/login` to it. A deployment-specific preview URL changes on later deployments; configure it explicitly only if it is the intended test target.

| Variable                               | Required setting                                                            |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                  | The exact canonical HTTPS application origin                                |
| `NEXT_PUBLIC_SUPABASE_URL`             | `https://zmezhtryzlcvafxjhnzq.supabase.co` for the owner's supplied project |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | That project's public publishable key, entered in Vercel                    |
| `GOOGLE_AUTH_ENABLED`                  | `true`, after enabling Google in Supabase                                   |
| `THREADSIGNAL_SUPABASE_MODE`           | `deployment`                                                                |
| `THREADSIGNAL_DEPLOYMENT_APPROVED`     | `true` for the owner-approved runtime                                       |
| `THREADSIGNAL_RUNTIME_ROLE`            | `web`                                                                       |
| `THREADSIGNAL_SUPABASE_PROJECT_REF`    | `zmezhtryzlcvafxjhnzq` for that same project                                |

The complete [deployment runtime profile](deployment.md#separate-runtime-configuration) is still required: restricted web `DATABASE_URL`, verified PostgreSQL CA, authenticated TLS `REDIS_URL`, and the configured extension origin. Both sign-in methods and their callbacks use Redis rate limiting and stop if it is unavailable. Do not use a localhost Redis URL or an HTTPS REST Redis URL in place of the required `rediss://` connection. Do not copy the local `personal-development` profile: it is pinned to localhost:3002 and keeps Google disabled. Leave `THREADSIGNAL_LOCAL` unset on Vercel.

Set values for the Vercel environment being deployed and redeploy after changing them. Keep Reddit/AI/billing mock, email console, and crawler fixture. Google client secrets belong in Supabase's Google provider configuration, not the browser or repository. This guide does not authorize provisioning a database role or changing a cloud secret.

## Supabase Google provider

In the personal project's Google Auth Platform configuration, use a Web application OAuth client with the standard OpenID/email/profile scopes. Set its authorized JavaScript origin to the canonical application origin. Set the **authorized redirect URI** to:

```text
https://zmezhtryzlcvafxjhnzq.supabase.co/auth/v1/callback
```

Enter the new personal OAuth client ID and secret in **Supabase → Authentication → Sign In / Providers → Google**, enable the provider, and save. If the Google consent app is in testing, its audience must include the test account. Supabase handles the Google callback; ThreadSignal's `/auth/callback` is a separate application callback. See [Supabase's Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Supabase email and redirects

In **Authentication → URL Configuration**, set Site URL to the canonical application origin. Add its exact `/auth/callback` and `/auth/confirm` routes to the redirect allowlist, preserving the app's `next` and SDK `sb_flow_id` query parameters. If your allowlist matches the query as well, add only a query suffix pattern on those exact routes, such as `https://YOUR-APP/auth/callback?**`, alongside the route without a query. Do not wildcard unrelated domains. See [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).

Keep the default `{{ .ConfirmationURL }}` link in both the **Confirm signup** and **Magic Link** email templates for the current PKCE flow. It carries the requested application callback. If a custom template still embeds localhost, correct it before retesting. Request a fresh link on the canonical domain and open it in the same browser and profile that requested it; the PKCE verifier cookie is scoped to that domain. The app also supports reviewed token-hash links at `/auth/confirm`, but changing the template format is unnecessary for the default flow.

Supabase's default mail service sends only to addresses on the project's team and currently allows two messages per hour. To support customer addresses, configure a new personal SMTP provider in Supabase Auth; changing ThreadSignal's `EMAIL_PROVIDER` does not change Supabase Auth delivery. No SMTP configuration was inspected or email sent during this investigation. See [Supabase SMTP restrictions and setup](https://supabase.com/docs/guides/auth/auth-smtp).

## Acceptance after configuration

1. Open the canonical `/login` in a fresh browser profile without a Vercel account session. It should show ThreadSignal directly.
2. Google should open the configured Supabase authorization endpoint and then Google's consent screen. After consent, return to the same application origin and reach onboarding or the existing workspace.
3. Request a fresh magic link using an approved test recipient. Confirm actual delivery, open it in the requesting browser, and reach onboarding/workspace. Verify an expired/reused link does not create another session.
4. Sign out, visit a protected page, sign back in, and confirm the destination is preserved.
5. If sending fails immediately, check the visible message and server logs for environment, origin or Redis failure. If Supabase accepts the request but no email arrives, check Supabase Auth delivery logs/SMTP/rate limits. Do not paste keys, full magic links or tokens into chat.

The live result remains unverified until the owner applies the provider/origin/runtime settings and completes these checks. Local evidence is recorded in [hosted auth verification](hosted-auth-verification.md).
