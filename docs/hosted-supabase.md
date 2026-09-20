# Personal hosted Supabase development

**Phase 2 update:** the owner subsequently authorized an administrative database connection and the Phase 2 migration has been applied and verified. See [migration commands and evidence](phase-2-hosted-migration.md). The bootstrap instructions below describe the original Phase 1 setup; do not rerun `setup.sql` against this initialized project. Root `.env.local` is now read only by the dedicated migration command for the newly authorized `DATABASE_URL`; web and worker launchers still ignore it.

This profile connects the Phase 1 web application to the owner's newly created personal Supabase project. It does not deploy ThreadSignal, enable later phases, copy local users, or enable real Reddit, AI, application email, billing, or crawler providers. The normal local profile remains independent.

The project URL and publishable key identify the application and permit only the access allowed by Supabase Auth, PostgreSQL grants, and row-level security. They do not provide dashboard, SQL Editor, or migration administration access. Never share database passwords, account passwords, personal access tokens, secret API keys, or service-role keys in chat. No such key is needed by this Phase 1 web profile.

## Prepare and review the schema locally

```sh
./scripts/local pnpm supabase:prepare
```

This command performs no cloud operation. It writes two ignored, repository-local artifacts:

- `.threadsignal/hosted/setup.sql`: the exact reviewed Phase 0 and Phase 1 migrations in order, wrapped in one transaction with an advisory lock and preflight checks.
- `.threadsignal/hosted/verify.sql`: read-only catalog and privilege checks; it does not return user identities or customer rows.

The generator checks the filenames and SHA-256 of both migrations. Unexpected, modified, missing, oversized, or symlinked inputs are rejected. Future migration changes require reviewing and updating this bootstrap manifest; the generator does not automatically incorporate a later phase. Existing migration source files are unchanged.

Read the entire setup file before executing it. It creates eight application tables, organization and plan types, private helper functions, authenticated RPCs, RLS policies, the Auth profile trigger, pgvector, a private knowledge bucket, and the central three-plan catalog. It contains no `seed.sql` content, demo accounts, local organization records, project keys, or project-specific URLs. It changes default privileges for future public objects and restricts the newly created application schema.

The setup deliberately refuses if the project already contains public application objects, any `private` schema, Auth users, a `knowledge-private` bucket, or nonempty Supabase CLI migration history. This includes an already initialized ThreadSignal project. Extension-owned objects, Supabase system schemas, and unrelated existing storage buckets are preserved. If a guard fails, investigate the existing project; do not delete its data or weaken the guard to make setup pass. A transaction failure rolls back this setup.

The owner supplied this new personal project's public connection details and confirmed its purpose, authorizing the scoped application connection and read-only connectivity checks. Those details do not provide SQL administration access. Applying SQL and changing dashboard settings are separate external writes: the following steps are prepared for the owner to review and perform. Do not reinterpret the public connection setup as permission to alter existing cloud data or use another account.

## Owner dashboard steps after review

1. Open your new personal project in your own Supabase dashboard. Confirm the selected project and that it has no application tables or Auth users.
2. Open **SQL Editor**, use the `postgres` role, and run the reviewed `.threadsignal/hosted/setup.sql` as one complete query. Do not run the local seed or `db:reset` against the hosted database.
3. Run `.threadsignal/hosted/verify.sql`. All eight expected tables must exist with RLS enabled and anonymous access false. All eleven RPCs must exist, use `security_definer`, deny anonymous execution, and allow authenticated execution with an empty `search_path`. The final row must report pgvector, the private bucket, and the profile trigger present, with direct billing-email and invitation-hash visibility false. Inspect the listed policies too. These catalog checks complement the local tenant-isolation tests; they do not claim a hosted two-user isolation journey has been executed.
4. Under **Authentication → URL Configuration**, set **Site URL** to `http://localhost:3002`. Add `http://localhost:3002/auth/callback**` to allowed redirect URLs. The narrowly scoped suffix allows the app's `?next=...` and the SDK's `sb_flow_id` callback parameters. Do not broaden the host, port, or application path. Preserve those query parameters when following a link and use this exact host and port consistently.
5. Keep the email provider enabled and email verification enabled. The magic-link email template must keep the standard `{{ .ConfirmationURL }}` link so Supabase completes its PKCE verification and forwards the code to ThreadSignal's callback. Do not substitute a direct application callback with the email token: the current flow uses the browser's PKCE verifier.
6. Confirm that the project can deliver an Auth email to the personal address you intend to test. Supabase's built-in email service currently delivers only to addresses in the Supabase project team and is limited to two messages per hour. Broader delivery requires your own newly configured personal SMTP provider. SMTP configuration and external email testing are separate owner-authorized steps. Google OAuth remains disabled. See [Supabase's current email restrictions](https://supabase.com/docs/guides/auth/auth-smtp).

Supabase Auth sends the signup/login email. ThreadSignal's `EMAIL_PROVIDER=console` governs its own application notification adapter; it does not redirect hosted Supabase Auth email into the local Mailpit inbox. The `.test` demo identities work only with local Supabase/Mailpit and must not be used to test hosted email delivery.

## Run the dedicated web profile

The owner-provided details are stored in `.threadsignal/hosted-supabase.json`, ignored by Git and created with owner-only file permissions. The format is:

```json
{
  "purpose": "personal-development",
  "projectRef": "<20-lowercase-letter-project-reference>",
  "url": "https://<same-project-reference>.supabase.co",
  "publishableKey": "sb_publishable_<public-application-key>"
}
```

The project reference and URL must match. The launcher validates the complete profile and rejects unknown fields, secret keys, unsafe URLs, and symlinks. Keep existing dotenv files unused.

The hosted web profile uses the existing owned Colima Redis service. Start those project services if stopped, check the configured public connection, and run the dedicated web app:

```sh
./scripts/local pnpm services:start
./scripts/local pnpm supabase:check
./scripts/local pnpm dev:hosted
```

To build this profile without starting the app, use `./scripts/local pnpm build:hosted`. Public connection checking reports Auth connectivity separately from database readiness; a successful Auth response does not establish that migrations were applied.

The hosted web address is `http://localhost:3002`. Keep the browser tab that requested the magic link open and follow the newest email link in that same browser; an unrelated browser does not have the required PKCE verifier. Create a fresh workspace after signing in. No local memberships, plans, or demo accounts are copied into the cloud project.

The existing root `.env.local` remains unused. Use only the dedicated, ignored project profile described by the launcher; do not add a hosted service-role key or database URL. Redis for login rate limits stays in the repository's verified Colima instance. The background worker and local database commands remain on the local profile and do not acquire hosted database credentials. The hostname differs from the ordinary `127.0.0.1:3000` profile to keep local and hosted browser cookies separate.

## Migration history and verification limits

SQL Editor execution does **not** update `supabase_migrations.schema_migrations`. This bootstrap leaves Supabase's migration metadata unchanged and creates no parallel history table. Before later adopting the Supabase CLI for this hosted project, separately authorize and configure a new personal CLI connection, verify the applied schema against these exact two migration hashes, then reconcile the two applied versions (`20260913000000`, `20260915000000`) through Supabase's supported migration-history repair workflow. Do not run an unreviewed `db push` against a project initialized through this file.

Successful offline generation does not mean the hosted schema is installed. A reachable Auth API does not prove the database schema exists, email is deliverable, or tenant isolation has passed against the hosted project. Hosted SQL application, dashboard changes, live signup, organization creation, and cross-tenant behavior must be reported separately with their actual evidence.
