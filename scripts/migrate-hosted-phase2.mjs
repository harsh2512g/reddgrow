import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { assertInside, root, state } from './isolation.mjs';
import { readHostedProfile } from './hosted-profile.mjs';
import { hostedMigrations } from './prepare-hosted-supabase.mjs';
import { loadVerifiedServiceRuntime } from './service-utils.mjs';
import {
  readHostedDatabaseConfig,
  loadSupabaseCertificate,
  safeDatabaseError,
} from './hosted-database-config.mjs';

export const phase2Migration = Object.freeze({
  file: '20260916000000_brand_knowledge.sql',
  sha256: '63956c0008d46dcd4356b74b897baacf3d3eb1f005f1377404c2bddca8b0d86c',
});
const digest = (value) => createHash('sha256').update(value).digest('hex');

// Captured from the verified Phase 2 local schema before Phase 3 changes. Contains
// catalog definitions and effective privileges only, never rows or credentials.
export function readPhase2Reference() {
  const path = assertInside(join(root, 'supabase/reference/phase2-schema.json'));
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.size > 1024 * 1024) throw new Error('Invalid Phase 2 reference.');
  const source = readFileSync(path, 'utf8');
  if (digest(source) !== '082b26269896ceedd48739b30d78dc1f92cb64b0dbf2d7d04c389983c2d3493b')
    throw new Error('Reviewed Phase 2 reference changed.');
  return JSON.parse(source);
}

export function reviewedSource(migration) {
  const path = assertInside(join(root, 'supabase/migrations', migration.file));
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid migration file.');
  const source = readFileSync(path, 'utf8');
  if (digest(source) !== migration.sha256) throw new Error('Reviewed migration checksum changed.');
  return source;
}

export function sourceObjects(source) {
  return {
    tables: [...source.matchAll(/create table public\.([a-z_]+)/g)].map((match) => match[1]),
    functions: [
      ...source.matchAll(/create (?:or replace )?function ((?:public|private)\.[a-z_]+)/g),
    ].map((match) => match[1]),
  };
}

// A structural snapshot, never customer records, auth identities, or credentials.
// Empty search_path makes deparsed definitions comparable across connections.
export async function schemaSnapshot(
  sql,
  objects,
  includeStorage = false,
  includeWorkerPolicies = false,
) {
  const tables = objects.tables;
  const functions = objects.functions;
  const rows = {};
  rows.tables = await sql`select c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname = any(${tables}::text[]) order by c.relname`;
  // Local development added section_heading after initial migration. Physical
  // column order is immaterial; compare names, types, defaults and access exactly.
  rows.columns =
    await sql`select c.relname,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod) as type,
    a.attnotnull,pg_catalog.pg_get_expr(d.adbin,d.adrelid) as default_value,
    role, privilege, has_column_privilege(role,c.oid,a.attnum,privilege) as allowed
    from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    left join pg_catalog.pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    cross join unnest(array['anon','authenticated']) role
    cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) privilege
    where n.nspname='public' and c.relname=any(${tables}::text[]) and a.attnum>0 and not a.attisdropped
    order by c.relname,a.attname,role,privilege`;
  rows.grants =
    await sql`select c.relname,role,privilege,has_table_privilege(role,c.oid,privilege) as allowed
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    cross join unnest(array['anon','authenticated']) role
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege
    where n.nspname='public' and c.relname=any(${tables}::text[]) order by c.relname,role,privilege`;
  rows.constraints =
    await sql`select c.relname,k.conname,pg_catalog.pg_get_constraintdef(k.oid) as definition
    from pg_catalog.pg_constraint k join pg_catalog.pg_class c on c.oid=k.conrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any(${tables}::text[]) order by c.relname,k.conname`;
  rows.indexes = await sql`select tablename,indexname,indexdef from pg_catalog.pg_indexes
    where schemaname='public' and tablename=any(${tables}::text[]) order by tablename,indexname`;
  rows.policies =
    await sql`select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
    from pg_catalog.pg_policies where ((schemaname='public' and tablename=any(${tables}::text[]))
    or (${includeStorage} and schemaname='storage' and tablename='objects' and policyname like 'knowledge_files_%'))
    and (${includeWorkerPolicies} or not (roles=array['threadsignal_worker']::name[] and policyname like 'worker_%'))
    order by schemaname,tablename,policyname`;
  rows.triggers =
    await sql`select c.relname,t.tgname,t.tgenabled,pg_catalog.pg_get_triggerdef(t.oid) as definition
    from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and ((n.nspname='public' and c.relname=any(${tables}::text[]))
    or (n.nspname='auth' and c.relname='users' and t.tgname='threadsignal_auth_user_created'))
    order by c.relname,t.tgname`;
  rows.functions =
    await sql`select n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
    pg_catalog.pg_get_functiondef(p.oid) as definition,
    has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where (n.nspname||'.'||p.proname)=any(${functions}::text[]) order by n.nspname,p.proname,arguments`;
  rows.foundation = await sql`select
    exists(select 1 from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace where e.extname='vector' and n.nspname='extensions') as vector,
    exists(select 1 from storage.buckets where id='knowledge-private' and public=false and file_size_limit=10485760) as private_bucket`;
  // Strip driver array metadata before hashing.
  return JSON.parse(JSON.stringify(rows));
}

export function assertSnapshotsEqual(actual, expected, label) {
  const differences = Object.keys(expected).filter(
    (key) => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]),
  );
  if (differences.length) throw new Error(`${label} mismatch: ${differences.join(', ')}.`);
}

export async function migrateHostedPhase2(command) {
  if (!['check', 'apply'].includes(command)) throw new Error('Expected check or apply.');
  const profile = readHostedProfile();
  const baseline = hostedMigrations.map(reviewedSource).join('\n');
  const source = reviewedSource(phase2Migration);
  const beforeObjects = sourceObjects(baseline);
  const afterObjects = sourceObjects(source);
  const runtime = loadVerifiedServiceRuntime();
  if (!runtime) throw new Error('Start the owned local services to compare the verified schema.');
  const local = postgres(runtime.DATABASE_URL, {
    max: 1,
    connect_timeout: 5,
    onnotice: () => undefined,
  });
  let remote;
  try {
    const expected = readPhase2Reference();
    if (
      expected.baseline.tables.length !== 8 ||
      expected.phase2.tables.length !== 8 ||
      !expected.phase2.foundation[0]?.private_bucket ||
      !expected.phase2.foundation[0]?.vector
    )
      throw new Error('Local reference schema is incomplete.');
    const config = readHostedDatabaseConfig(profile.projectRef);
    config.ssl.ca = await loadSupabaseCertificate();
    remote = postgres(config);
    const outcome = await remote.begin(command === 'check' ? 'read only' : '', async (sql) => {
      await sql`set local search_path = ''`;
      await sql`set local lock_timeout = '5s'`;
      await sql`set local statement_timeout = '120s'`;
      await sql`select pg_catalog.pg_advisory_xact_lock(1414743635, 1)`;
      const [identity] = await sql`select current_user='postgres' as administrator`;
      if (!identity.administrator)
        throw new Error('Migration requires the personal project database administrator.');
      assertSnapshotsEqual(
        await schemaSnapshot(sql, beforeObjects),
        expected.baseline,
        'Phase 1 baseline',
      );
      const current = await schemaSnapshot(sql, afterObjects, true);
      if (current.tables.length) {
        assertSnapshotsEqual(current, expected.phase2, 'Existing Phase 2');
        return 'already-applied-and-verified';
      }
      if (current.functions.length || current.policies.length)
        throw new Error('Partial Phase 2 objects require review.');
      if (command === 'check') return 'ready-to-apply';
      // Only hash-reviewed Phase 2 SQL; never reset, seed, or replay the bootstrap.
      await sql.unsafe(source);
      assertSnapshotsEqual(
        await schemaSnapshot(sql, beforeObjects),
        expected.baseline,
        'Preserved Phase 1',
      );
      assertSnapshotsEqual(
        await schemaSnapshot(sql, afterObjects, true),
        expected.phase2,
        'Migrated Phase 2',
      );
      await sql`notify pgrst, 'reload schema'`;
      return 'applied-and-verified';
    });
    const result = {
      projectRef: profile.projectRef,
      outcome,
      migration: phase2Migration,
      baselineSha256: digest(JSON.stringify(expected.baseline)),
      phase2Sha256: digest(JSON.stringify(expected.phase2)),
      verifiedAt: new Date().toISOString(),
      clientTls: 'verified-ca-and-hostname',
      migrationHistory: 'unchanged-sql-editor-baseline',
    };
    const directory = assertInside(join(state, 'hosted'));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(
      assertInside(join(directory, 'phase2-migration-result.json')),
      JSON.stringify(result, null, 2) + '\n',
      { mode: 0o600 },
    );
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally {
    await Promise.allSettled([local.end({ timeout: 2 }), remote?.end({ timeout: 2 })]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.THREADSIGNAL_LOCAL !== '1' || process.argv.length !== 3)
    throw new Error('Use the isolated runner with check or apply.');
  try {
    await migrateHostedPhase2(process.argv[2]);
  } catch (error) {
    // Only controlled structural diagnostics, never server responses or parameters.
    const message =
      error instanceof Error &&
      /^(Phase 1 baseline|Preserved Phase 1|Existing Phase 2|Migrated Phase 2) mismatch: [a-z, ]+\.$/.test(
        error.message,
      )
        ? error.message
        : safeDatabaseError(error);
    process.stderr.write(`Hosted migration failed: ${message}\n`);
    process.exitCode = 1;
  }
}
