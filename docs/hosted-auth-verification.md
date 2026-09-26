# Hosted authentication follow-up — 2026-09-26

Scope: Step 15 deployment troubleshooting, preserving the Supabase backend and provider defaults. The owner reported that Google and magic-link login fail on Vercel. No deployment, cloud configuration change, external sign-in, email send, migration, commit or push was performed.

## Read-only external observations

- The supplied Vercel deployment returned HTTP 302 to Vercel SSO protection for login, liveness and readiness. The web reader could not inspect the login content; anonymous direct requests confirmed the protection redirect without following it.
- The owner's previously supplied personal Supabase project's public Auth settings returned HTTP 200 with Google false, email true, signup enabled and email confirmation required. Only those flags were printed. The public publishable key supplied earlier by the owner was used; no dotenv file or private credential was inspected.
- These observations do not confirm Vercel's actual environment, Google OAuth client configuration, Supabase Site URL/allowlist, SMTP delivery or hosted Redis.

## Repository changes

- Google initiation returns a noncached JSON destination and retains the PKCE cookies. The browser makes a same-origin POST, checks the destination against the configured Supabase HTTPS origin and provider, then navigates without a native form redirect.
- The login form prevents duplicate pending attempts and shows bounded errors without raw provider details. Google remains disabled locally and opt-in on hosted profiles.
- Auth callback configuration failures use a relative login redirect. They no longer send the visitor to localhost.
- Tests cover HTTPS callbacks, server/client authorization destinations, unsafe URLs, rate-limit errors, pending/retry UI and the browser's strict CSP/PKCE-cookie interaction. Existing real local Supabase magic-link journeys are included in validation.
- [Hosted setup](hosted-authentication.md) documents the exact separate Google and app callback roles, required runtime, canonical origin and email delivery configuration.

## Verification results

Commands run through `./scripts/local`. Logs use the ignored `.threadsignal/hosted-auth-*.log` prefix. Local tests use only project-owned services and fresh browser contexts; the Google browser fixture intercepts every request and never contacts a live provider.

| Check                                                                                                                                                                  | Result                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                                                                                                                            | Exit 0.                                                                                                                                                                                  |
| `pnpm format:check`                                                                                                                                                    | Exit 0.                                                                                                                                                                                  |
| `pnpm typecheck`                                                                                                                                                       | Exit 0; 33 tasks plus tooling.                                                                                                                                                           |
| `pnpm test`                                                                                                                                                            | Exit 0; 1,521 tests across 106 files.                                                                                                                                                    |
| `pnpm build`                                                                                                                                                           | Exit 0; 18 tasks.                                                                                                                                                                        |
| `pnpm exec vitest run apps/web/tests/phase1-forms.test.tsx` after correcting the hook                                                                                  | Exit 0; 8 tests.                                                                                                                                                                         |
| `pnpm secrets:check`                                                                                                                                                   | Exit 0; 761 repository text files.                                                                                                                                                       |
| `pnpm test:e2e apps/web/tests/e2e/auth.spec.ts apps/web/tests/e2e/google-navigation.spec.ts apps/web/tests/e2e/shell.spec.ts apps/web/tests/e2e/accessibility.spec.ts` | Final exit 0; 22 desktop/mobile tests, zero skips, in 53.0 seconds. Includes real local magic-link onboarding/logout and intercepted Google navigation with strict CSP and PKCE cookies. |

The full database integration and extension browser suites were not rerun: this follow-up changes auth transport/UI and callback failure handling, with no schema, worker or extension changes. The relevant real-Supabase integration is exercised by the auth browser journeys above. Node 24 and hosted runtime remain external verification items; local checks use Node 25.2.1.

Development web and worker were restored with `./scripts/local pnpm dev`. The homepage, web readiness and worker readiness each returned HTTP 200. Local code is ready for review; live provider activation and hosted acceptance remain open.

## Failure ledger

- Isolated browser reproduction of the original native form returned `nativeFormRedirectBlocked=true` and `cspViolation=true`; this established the repository defect before changing the flow.
- The first focused run exited 1: 78 tests passed and the new form test's cleanup hook timed out because `beforeEach` returned the mock function. Changed the hook to return nothing; no timeout or product guard was relaxed.
- One patch attempt failed its expected-line match and made no changes; the exact existing assertion was read and the patch reapplied.
- A lookup for an older deployment configuration filename found no file; the existing `packages/config/src/deployment.ts` was inspected instead.
- Development was intentionally interrupted for a clean build. Its remaining Next parent/child were verified as repository-owned and stopped before browser testing.
- The first browser command exited 1 before running tests because a leftover repository worker held port 3001. Its watcher/child ownership was verified and both stopped; the suite was rerun without enabling server reuse.

## External acceptance

Google is disabled on the observed Supabase project. The deployment URL requires Vercel access, and origin/runtime/SMTP configuration is not visible from the repository. The owner must supply the nonsecret visible error and configure the personal provider/runtime as described in the setup guide. Live Google login, email delivery and hosted session persistence are not claimed as passed.
