import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assertInside, root } from './isolation.mjs';

export function readWorkerOperation() {
  const bootstrap = readFileSync(
    assertInside(join(root, 'supabase/operations/phase2-worker.sql')),
    'utf8',
  );
  const guard = readFileSync(
    assertInside(join(root, 'supabase/operations/phase2-worker-organization-guard.sql')),
    'utf8',
  );
  if (
    createHash('sha256').update(bootstrap).digest('hex') !==
      '5269fd37e6387bd42dc999aa32851ceb74b52bc4f8abdafdf0130651148ff129' ||
    createHash('sha256').update(guard).digest('hex') !==
      '92e11518953a6ac08eb7bcde9252461bc5dd5c35d88f7e205c9b2e59602c47d7'
  )
    throw new Error('Worker operation changed since review.');
  const source = `${guard}\n${bootstrap}`;
  const hash = createHash('sha256').update(source).digest('hex');
  return { source, hash };
}

export async function workerPrivilegeSnapshot(sql) {
  const [role] =
    await sql`select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,rolconnlimit,
    pg_catalog.shobj_description(oid,'pg_authid') as marker
    from pg_catalog.pg_roles where rolname='threadsignal_worker'`;
  if (
    !role ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolreplication ||
    role.rolbypassrls ||
    role.rolinherit ||
    role.rolconnlimit !== 4 ||
    role.marker !== 'ThreadSignal Phase 2 knowledge worker v1'
  )
    throw new Error('Invalid dedicated worker role.');
  const [memberships] =
    await sql`select count(*)::integer as count from pg_catalog.pg_auth_members where member=(select oid from pg_catalog.pg_roles where rolname='threadsignal_worker')`;
  if (memberships.count !== 0) throw new Error('Unexpected worker role membership.');
  const columns = await sql`select n.nspname,c.relname,a.attname,privilege,
    has_column_privilege('threadsignal_worker',c.oid,a.attnum,privilege) as allowed
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) privilege
    where n.nspname='public' and c.relkind='r' order by n.nspname,c.relname,a.attname,privilege`;
  const tables =
    await sql`select n.nspname,c.relname,privilege,has_table_privilege('threadsignal_worker',c.oid,privilege) as allowed
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege
    where n.nspname='public' and c.relkind='r' order by n.nspname,c.relname,privilege`;
  const writable = {
    knowledge_sources: {
      UPDATE: ['status', 'error_code', 'page_count', 'chunk_count', 'last_ingested_at'],
    },
    knowledge_jobs: {
      UPDATE: [
        'status',
        'attempts',
        'available_at',
        'lease_token',
        'lease_expires_at',
        'error_code',
      ],
    },
    knowledge_documents: {
      INSERT: [
        'id',
        'organization_id',
        'brand_id',
        'source_id',
        'document_key',
        'title',
        'canonical_url',
        'page_number',
        'section_heading',
        'content',
        'checksum',
      ],
      UPDATE: ['title', 'canonical_url', 'page_number', 'section_heading', 'content', 'checksum'],
    },
    knowledge_chunks: {
      INSERT: [
        'organization_id',
        'brand_id',
        'source_id',
        'document_id',
        'chunk_index',
        'content',
        'token_count',
        'checksum',
        'embedding',
        'section_heading',
      ],
    },
  };
  const knowledge = Object.keys(writable);
  for (const row of columns) {
    const permitted =
      row.privilege === 'SELECT'
        ? knowledge.includes(row.relname) ||
          (row.relname === 'brands' && ['id', 'website_url'].includes(row.attname))
        : (writable[row.relname]?.[row.privilege] ?? []).includes(row.attname);
    if (row.allowed !== permitted)
      throw new Error('Worker column permissions differ from the reviewed contract.');
  }
  for (const row of tables) {
    const permitted =
      row.privilege === 'SELECT'
        ? knowledge.includes(row.relname)
        : row.privilege === 'DELETE' &&
          ['knowledge_sources', 'knowledge_documents', 'knowledge_chunks'].includes(row.relname);
    if (row.allowed !== permitted)
      throw new Error('Worker table permissions differ from the reviewed contract.');
  }
  return JSON.parse(JSON.stringify({ role, columns, tables }));
}

export async function assertWorkerConnection(sql) {
  const [identity] = await sql`select current_user='threadsignal_worker' as worker`;
  if (!identity.worker) throw new Error('Expected dedicated worker login.');
  await workerPrivilegeSnapshot(sql);
  const operation = readWorkerOperation();
  await sql.unsafe(
    operation.source.slice(operation.source.indexOf('-- Refuse unexpected inherited authority')),
  );
  for (const statement of [
    'set local role postgres',
    'set local role authenticated',
    'set local role service_role',
  ]) {
    let denied = false;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(statement);
        throw new Error('Role escalation unexpectedly permitted.');
      });
    } catch (error) {
      denied = error.code === '42501';
    }
    if (!denied) throw new Error('Worker can assume an unexpected role.');
  }
  // Require actual table access without returning any customer records.
  await sql`select id,website_url from public.brands limit 0`;
  await sql`select * from public.knowledge_jobs limit 0`;
  await sql`select * from public.knowledge_sources limit 0`;
  await sql`select * from public.knowledge_documents limit 0`;
  await sql`select * from public.knowledge_chunks limit 0`;
  const [denied] = await sql`select
    exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where ((n.nspname='public' and c.relname in ('profiles','organization_members')) or (n.nspname='auth' and c.relname='users'))
      and has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE')) as protected_data,
    has_database_privilege(current_user,current_database(),'CREATE') as create_database_objects`;
  if (Object.values(denied).some(Boolean)) throw new Error('Unexpected worker access.');
}

export async function checkHostedWorkerHealth(projectRef, request = fetch) {
  const response = await request('http://127.0.0.1:3003/api/health/ready', {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    return false;
  }
  const result = z
    .object({
      status: z.literal('ready'),
      mode: z.literal('personal-development'),
      projectRef: z.literal(projectRef),
      queuePrefix: z.literal(`threadsignal-hosted-${projectRef}`),
      checks: z.object({
        database: z.literal('up'),
        redis: z.literal('up'),
        heartbeat: z.literal('up'),
        knowledge: z.literal('up'),
      }),
    })
    .safeParse(await response.json());
  return result.success;
}
