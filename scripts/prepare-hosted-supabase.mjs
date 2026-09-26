import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertInside, root, state } from './isolation.mjs';

// This bootstrap is intentionally limited to the reviewed Phase 0/1 migrations.
// Later migrations, or changes to these files, require another bootstrap review.
export const hostedMigrations = Object.freeze([
  Object.freeze({
    file: '20260913000000_foundation.sql',
    sha256: '77e5c29d4f4924e3bb1cc8451939afe296e33d37e01257736785bdf39306d8ab',
  }),
  Object.freeze({
    file: '20260915000000_auth_organizations.sql',
    sha256: '54b5067f07c796d8108c17c5dab41d615ecbfe098718c733e50cc73e6ca25d4d',
  }),
]);

export const hostedPublicObjectsSql = `with recursive extension_objects(classid, objid) as (
  select classid, objid from pg_catalog.pg_depend
  where refclassid = 'pg_catalog.pg_extension'::regclass and deptype = 'e'
  union
  select d.classid, d.objid from pg_catalog.pg_depend d
  join extension_objects e on e.classid = d.refclassid and e.objid = d.refobjid
  where d.deptype in ('i', 'a')
)
select 1 from pg_catalog.pg_depend d
join pg_catalog.pg_namespace n on n.oid = d.refobjid
where d.refclassid = 'pg_catalog.pg_namespace'::regclass
  and n.nspname = 'public'
  -- Supabase's initial default grants are expected and deliberately hardened.
  and d.classid <> 'pg_catalog.pg_default_acl'::regclass
  and not exists (
    select 1 from extension_objects e where e.classid = d.classid and e.objid = d.objid
  )`;

export const hostedPreflightSql = `do $threadsignal_preflight$
declare
  has_history boolean;
begin
  if current_user <> 'postgres' then
    raise exception 'Use the personal project SQL Editor as postgres; no application API key can apply this setup.';
  end if;
  if to_regclass('auth.users') is null or to_regclass('storage.buckets') is null then
    raise exception 'Expected a newly created Supabase project with Auth and Storage available.';
  end if;
  if to_regnamespace('private') is not null then
    raise exception 'An existing private schema requires review. Nothing has been applied.';
  end if;

  -- Namespace dependencies cover relations (including sequences/views), routines,
  -- types, operators, collations and text-search objects. Extension members and
  -- their automatically created internal objects are managed by Supabase/Postgres.
  if exists (
    ${hostedPublicObjectsSql}
  ) then
    raise exception 'The public schema already has application objects. Review the existing project; do not drop objects to bypass this check.';
  end if;
  if exists (select 1 from auth.users) then
    raise exception 'Existing Auth users require an explicit migration review. No profiles were imported.';
  end if;
  if exists (select 1 from storage.buckets where id = 'knowledge-private') then
    raise exception 'The knowledge-private bucket already exists. Its settings and contents were preserved.';
  end if;
  if to_regnamespace('supabase_migrations') is not null then
    if not exists (
      select 1 from pg_catalog.pg_class
      where oid = to_regclass('supabase_migrations.schema_migrations') and relkind = 'r'
    ) then
      raise exception 'An unexpected Supabase migration schema requires review.';
    end if;
    execute 'select exists (select 1 from supabase_migrations.schema_migrations)' into has_history;
    if has_history then
      raise exception 'Existing CLI migration history requires review before installing ThreadSignal.';
    end if;
  end if;
end;
$threadsignal_preflight$;`;

export const hostedVerificationSql = `-- Read-only structure and privilege checks. No customer rows or Auth identities are returned.
begin read only;
set local statement_timeout = '15s';
with expected(name) as (
  values ('profiles'), ('plan_catalog'), ('organizations'), ('organization_members'),
    ('organization_invitations'), ('subscriptions'), ('organization_data_requests'), ('audit_logs')
)
select e.name as expected_table, c.oid is not null as exists,
  coalesce(c.relrowsecurity, false) as rls_enabled,
  case when c.oid is null then null else
    has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
    or has_table_privilege('anon', c.oid, 'DELETE, TRUNCATE, TRIGGER')
  end as anonymous_access
from expected e
left join pg_catalog.pg_namespace n on n.nspname = 'public'
left join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = e.name and c.relkind = 'r'
order by e.name;

with expected(name) as (
  values ('create_organization'), ('get_organization_settings'), ('update_organization'),
    ('get_organization_plan'), ('list_organization_members'), ('invite_member'),
    ('accept_invitation'), ('revoke_invitation'), ('change_member_role'),
    ('remove_member'), ('request_organization_data')
)
select e.name as expected_rpc, p.oid is not null as exists,
  p.prosecdef as security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anonymous_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  p.proconfig as function_configuration
from expected e
left join pg_catalog.pg_namespace n on n.nspname = 'public'
left join pg_catalog.pg_proc p on p.pronamespace = n.oid and p.proname = e.name
order by e.name;

select t.tablename, t.policyname, t.roles, t.cmd from pg_catalog.pg_policies t
where t.schemaname = 'public' and t.tablename in (
  'profiles', 'plan_catalog', 'organizations', 'organization_members',
  'organization_invitations', 'subscriptions', 'organization_data_requests', 'audit_logs'
) order by t.tablename, t.policyname;

select
  exists(select 1 from pg_catalog.pg_extension where extname = 'vector') as vector_installed,
  exists(select 1 from storage.buckets where id = 'knowledge-private' and public = false and file_size_limit = 10485760) as private_bucket_configured,
  exists(select 1 from pg_catalog.pg_trigger where tgname = 'threadsignal_auth_user_created' and tgrelid = 'auth.users'::regclass and tgenabled <> 'D') as profile_trigger_enabled,
  has_column_privilege('authenticated', to_regclass('public.organizations'), 'billing_email', 'SELECT') as direct_billing_email_visible,
  has_column_privilege('authenticated', to_regclass('public.organization_invitations'), 'token_hash', 'SELECT') as invitation_hash_visible;
rollback;
`;

export function prepareHostedArtifacts(migrationsDirectory = join(root, 'supabase/migrations')) {
  const directory = assertInside(migrationsDirectory);
  // This bootstrap remains Phase 0/1 only; later deltas require separate review.
  const entries = readdirSync(directory)
    .filter(
      (entry) =>
        ![
          '20260916000000_brand_knowledge.sql',
          '20260918000000_opportunity_pipeline.sql',
          '20260919000000_draft_workflow.sql',
          '20260920000000_extension_workflow.sql',
          '20260920010000_extension_role_activation.sql',
          '20260920020000_extension_session_history.sql',
          '20260921000000_attribution.sql',
          '20260921010000_tracking_origin.sql',
          '20260921020000_attribution_integrity.sql',
          '20260921030000_attribution_url_and_delivery.sql',
          '20260921040000_numeric_tracking_hosts.sql',
          '20260921050000_conversion_identity.sql',
          '20260922000000_billing_notifications.sql',
          '20260922010000_billing_permissions.sql',
          '20260922020000_billing_usage_meter.sql',
          '20260922030000_billing_checkout_binding.sql',
          '20260922040000_notification_lifecycle_freshness.sql',
          '20260922050000_notification_digest_schedule.sql',
          '20260923000000_platform_operations.sql',
          '20260923010000_privacy_lifecycle.sql',
          '20260923020000_platform_privacy_jobs.sql',
          '20260923030000_operations_lifecycle_guards.sql',
          '20260923040000_privacy_request_limits.sql',
          '20260923050000_operations_retention.sql',
          '20260923060000_feed_cursor_index.sql',
          '20260923070000_paused_cleanup_retry.sql',
          '20260923080000_privacy_bucket_boundary.sql',
          '20260923090000_knowledge_worker_organization_guard.sql',
          '20260924000000_feed_excerpt_and_workflow.sql',
          '20260924010000_ai_usage_actuals.sql',
          '20260924020000_ai_unknown_usage_metrics.sql',
          '20260924030000_knowledge_embedding_identity.sql',
          '20260924040000_invitation_retention.sql',
          '20260924050000_general_ai_usage.sql',
          '20260926000000_draft_attempt_accounting.sql',
        ].includes(entry),
    )
    .sort();
  if (
    entries.length !== hostedMigrations.length ||
    entries.some((entry, index) => entry !== hostedMigrations[index]?.file)
  ) {
    throw new Error('Hosted setup requires exactly the reviewed Phase 0/1 migration files.');
  }
  const sources = hostedMigrations.map(({ file, sha256 }) => {
    const path = assertInside(join(directory, file));
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.size > 1024 * 1024) {
      throw new Error('Hosted setup accepts regular reviewed migration files only.');
    }
    const source = readFileSync(path, 'utf8');
    if (createHash('sha256').update(source).digest('hex') !== sha256) {
      throw new Error(
        'A migration changed since hosted bootstrap review. Review it before updating the manifest.',
      );
    }
    return `-- Source: supabase/migrations/${file}\n-- SHA-256: ${sha256}\n${source}`;
  });
  return {
    setup: `-- ThreadSignal Phase 1: owner-reviewed, one-time bootstrap for an EMPTY personal development project.
-- Generated offline. Review this entire file before running it in your own Supabase SQL Editor.
-- No seed file, credentials, project URL or demo users are included.
-- This file does NOT update Supabase CLI migration history. See docs/hosted-supabase.md.
-- Re-running against an initialized project intentionally refuses before any schema changes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
select pg_catalog.pg_advisory_xact_lock(1414743635, 1);
${hostedPreflightSql}

${sources.join('\n')}
notify pgrst, 'reload schema';
commit;
`,
    verify: hostedVerificationSql,
  };
}

export function writeHostedArtifacts() {
  const artifacts = prepareHostedArtifacts();
  const directory = assertInside(join(state, 'hosted'));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const [name, content] of [
    ['setup.sql', artifacts.setup],
    ['verify.sql', artifacts.verify],
  ]) {
    writeFileSync(assertInside(join(directory, name)), content, { mode: 0o600 });
  }
  return { setup: join(directory, 'setup.sql'), verify: join(directory, 'verify.sql') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.THREADSIGNAL_LOCAL !== '1') throw new Error('Use the isolated local runner.');
  if (process.argv.length !== 2)
    throw new Error('This offline generator accepts no project or credential arguments.');
  writeHostedArtifacts();
  process.stdout.write(
    'Prepared .threadsignal/hosted/setup.sql and verify.sql locally. No Supabase connection or database changes were made.\n',
  );
}
