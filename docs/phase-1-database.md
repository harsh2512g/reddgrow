# Phase 1 database contracts

The migration `supabase/migrations/20260915000000_auth_organizations.sql` implements authentication profiles, organizations, membership and a billing skeleton. It adds no brand, knowledge, opportunity or draft tables. PostgreSQL remains accessed through generated Supabase types; there is no Prisma layer.

## Tables and access

All eight tables have RLS enabled. Anonymous users have no table access or mutation RPC execution. Application roles cannot directly insert, update or delete tenant rows. The exception is updating the authenticated user's own `full_name` and `avatar_url` profile columns; privileged profile flags are never writable by the user.

| Table                        | Read access and purpose                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `profiles`                   | Own profile only. An Auth trigger creates it without trusting privileged user metadata.               |
| `organizations`              | Active members may read explicitly granted safe columns. Billing email is excluded from direct reads. |
| `organization_members`       | Members of the same active organization.                                                              |
| `organization_invitations`   | Owner/admin only. Explicit safe columns exclude `token_hash`.                                         |
| `subscriptions`              | Owner only; mock trial or subscription metadata.                                                      |
| `plan_catalog`               | Authenticated users may read the central plan mirror.                                                 |
| `audit_logs`                 | Owner/admin within the organization; application users cannot forge events.                           |
| `organization_data_requests` | Owner only; records export/deletion requests without executing them.                                  |

The private membership helper always derives identity from `auth.uid()`. Its narrowly scoped security-definer lookup avoids recursive membership policies. Mutation RPCs use a fixed empty search path, qualified object names and explicit execute grants. They independently recheck organization status, membership and role; a hidden UI control is never the authorization boundary. There is no platform-admin RLS bypass.

## Role matrix

| Operation                                     | Owner                         | Admin                          | Member | Viewer |
| --------------------------------------------- | ----------------------------- | ------------------------------ | ------ | ------ |
| Read organization, roster and basic plan      | Yes                           | Yes                            | Yes    | Yes    |
| Read billing contact and subscription details | Yes                           | No                             | No     | No     |
| Update organization settings                  | Yes                           | Yes, excluding billing contact | No     | No     |
| Invite, change roles or remove nonowners      | Yes                           | Yes                            | No     | No     |
| Manage owner membership                       | Yes, preserving a final owner | No                             | No     | No     |
| Request organization export/deletion          | Yes                           | No                             | No     | No     |

Roster email addresses are visible to owners/admins; other members receive display names and roles. The settings RPC returns a null billing contact for nonowners. Current membership is checked again by SQL if a user's role changes after the application reads it.

## Transactional RPCs

- `create_organization` creates the organization, owner membership, seven-day trial and audit event atomically. A lock on the verified Auth user prevents concurrent onboarding from creating multiple owned trial organizations.
- `get_organization_settings`, `get_organization_plan` and `list_organization_members` expose only authorized fields. Organization lists must select explicit safe columns rather than `*`.
- `update_organization` permits owner/admin settings changes. Administrators omit the optional `p_billing_email` argument so SQL retains the current contact; only owners can provide a replacement.
- `invite_member` stores a SHA-256 hash supplied by the server, never the raw random token. Invitations expire after seven days and reserve a member seat. Email matching is case-insensitive.
- `accept_invitation` requires an unexpired, unrevoked, unused token hash and the matching verified email in `auth.users`. It rechecks the plan and seat limit before adding membership and consuming the invitation.
- `revoke_invitation`, `change_member_role` and `remove_member` enforce manager authority and protect owner membership. Repeated revocation creates no duplicate audit event. Concurrent demotions cannot remove the final owner.
- `request_organization_data` records and audits an owner request. Repeated pending requests of the same kind return the existing request. No export file or deletion job is produced in Phase 1.

Membership mutations lock the parent organization row in a consistent order. Active members plus unexpired pending invitations count toward the seat limit, including during concurrent invitation requests. Acceptance checks limits again after a downgrade. Trial expiry blocks new allocations while existing rows and authorized read access remain intact; cleanup and owner data requests remain available.

## Plans and fixtures

`packages/config/src/plans.ts` is the central configuration. `plan_catalog` mirrors every price, limit, period and feature flag; an integration test detects drift. Trial lasts seven days with one member. Solo costs USD 29/month with one member; Growth costs USD 79/month with five. A mock subscription record does not represent a payment or activate real Stripe behavior.

`supabase/seed.sql` creates passwordless synthetic Auth users and email identities, without passwords or external credentials. The fixed UUID prefixes are `10000000-0000-4000-8000-…` for users and `20000000-0000-4000-8000-…` for organizations.

| Local fixture email          | Workspace           | Role   |
| ---------------------------- | ------------------- | ------ |
| `owner@threadsignal.test`    | ThreadSignal Studio | Owner  |
| `admin@threadsignal.test`    | ThreadSignal Studio | Admin  |
| `member@threadsignal.test`   | ThreadSignal Studio | Member |
| `viewer@threadsignal.test`   | ThreadSignal Studio | Viewer |
| `outsider@threadsignal.test` | Northstar Workspace | Owner  |

Studio has a mock Growth subscription and four occupied seats; Northstar has a one-seat trial. Seed inserts are idempotent and retain existing fixture edits. Use the local magic-link flow and repository-owned inbox to sign in. SQL integration tests create separate random fixtures and remove them afterward.

## Operations and verification

Run database commands through `./scripts/local` with the repository's Colima services already running. The launcher verifies the expected context, socket, container identities and ports before database access. It never loads the root environment file or uses another Docker configuration.

```sh
./scripts/local pnpm db:reset
./scripts/local pnpm seed
./scripts/local pnpm db:types
./scripts/local pnpm db:lint
./scripts/local pnpm test:integration
```

`db:reset` replaces this project's local database data; stop application tests before running it. `db:types` regenerates `packages/database/src/database.types.ts` from the live public schema. Keep that generated file formatted and rebuild `@threadsignal/database` after changes. The web application uses user-scoped Supabase RPCs, not the unrestricted connection used by migration and test tooling.

Local verification on 2026-09-15 passed database lint and **21/21 integration tests across two files**: 17 database tests plus four service/worker tests. Database coverage includes both tenant directions, anonymous denial, profile escalation, billing privacy, role restrictions, trial creation/expiry, invitation acceptance/replay/revocation, verified-email matching, concurrent onboarding/invitations/owner demotions, and downgrade limits. Generated types and the database package build also passed. Initial sandbox socket denial and a temporary dependency-lock mismatch failed before SQL validation; successful retries supplied the reported evidence.

These results establish local database behavior, not full Phase 1 acceptance. Remote CI, Google OAuth and real billing/email providers are not covered. See [implementation status](../IMPLEMENTATION_STATUS.md) and [credential boundaries](credential-matrix.md) for current scope and remaining review items.
