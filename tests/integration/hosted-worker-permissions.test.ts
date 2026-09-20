import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { demoBrand } from '@threadsignal/knowledge';
import {
  claimKnowledgeJob,
  processKnowledgeJob,
  publishKnowledge,
} from '../../apps/worker/src/jobs/knowledge';
import { LocalKnowledgeStorage } from '../../apps/worker/src/storage';
import { localDatabaseUrl, verifyDocker } from '../../scripts/service-utils.mjs';
import { readWorkerOperation } from '../../scripts/hosted-worker-access.mjs';

const { source: operation } = readWorkerOperation();

describe('Phase 2 dedicated worker PostgreSQL permissions', () => {
  let sql: postgres.Sql;
  beforeAll(() => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 1, connect_timeout: 5, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql?.end({ timeout: 3 });
  });

  // All role creation, fixture rows, and ingestion results roll back together.
  // A pre-existing reviewed local NOLOGIN role is reused without changing it.
  async function isolated(test: (tx: postgres.TransactionSql) => Promise<void>) {
    const rollback = new Error('ROLL_BACK_WORKER_PERMISSION_FIXTURE');
    try {
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(1414743635, 2)`;
        const existing = await tx`select oid from pg_roles where rolname='threadsignal_worker'`;
        if (!existing.length) await tx.unsafe(operation);
        // Supabase's postgres role is not a superuser. Allow only this fixture
        // transaction to assume the worker, without making the worker inherit
        // any administrator privileges. The membership rolls back as well.
        await tx`grant threadsignal_worker to postgres with inherit false, set true`;
        await test(tx);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  async function asWorker<T>(
    tx: postgres.TransactionSql,
    test: (connection: postgres.Sql) => Promise<T>,
  ) {
    await tx`set local role threadsignal_worker`;
    try {
      return await tx.savepoint(async (scoped) => {
        // Exercise the real processor on this transaction: its normal SQL begin
        // boundaries become savepoints, so it cannot commit fixture data/roles.
        const connection = new Proxy(sql, {
          apply(_target, _receiver, args) {
            return Reflect.apply(scoped, scoped, args);
          },
          get(_target, property) {
            if (property === 'begin')
              return (body: (nested: postgres.TransactionSql) => Promise<unknown>) =>
                scoped.savepoint(body);
            return Reflect.get(scoped, property);
          },
        });
        return test(connection);
      });
    } finally {
      await tx`set local role postgres`;
    }
  }

  async function fixture(tx: postgres.TransactionSql) {
    const user = randomUUID();
    const brand = randomUUID();
    const source = randomUUID();
    const job = randomUUID();
    await tx`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
      values(${user},${`${user}@worker-permissions.example`},now(),'{}')`;
    await tx`select set_config('request.jwt.claim.sub',${user},true)`;
    await tx`set local role authenticated`;
    const [organization] = await tx`select public.create_organization('Worker permission fixture',
      ${`worker-permissions-${user.slice(0, 20)}`},${`${user}@worker-permissions.example`}) as id`;
    await tx`set local role postgres`;
    const org = String(organization?.id);
    await tx`insert into public.brands(id,organization_id,name,website_url,profile)
      values(${brand},${org},'Worker fixture','https://clarityscale.example',${tx.json(demoBrand)})`;
    await tx`insert into public.knowledge_sources(id,organization_id,brand_id,name,type,manual_text)
      values(${source},${org},${brand},'Verification notes','manual',
        'Private image retention lasts twenty-four hours. The API supports asynchronous batches.')`;
    await tx`insert into public.knowledge_jobs(id,organization_id,brand_id,source_id,generation,kind)
      values(${job},${org},${brand},${source},1,'ingest')`;
    return { user, org, brand, source, job };
  }

  it('has no privileged attributes, inherited roles, persistent CREATE, or owned objects', async () => {
    await isolated(async (tx) => {
      const [role] = await tx`select oid,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,
        rolreplication,rolbypassrls,rolinherit,rolconnlimit,
        shobj_description(oid,'pg_authid') as description
        from pg_roles where rolname='threadsignal_worker'`;
      expect(role).toMatchObject({
        rolcanlogin: false,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
        rolinherit: false,
        rolconnlimit: 4,
        description: 'ThreadSignal Phase 2 knowledge worker v1',
      });
      expect(await tx`select 1 from pg_auth_members where member=${role?.oid}`).toHaveLength(0);
      expect(await tx`select 1 from pg_class where relowner=${role?.oid}`).toHaveLength(0);
      expect(await tx`select 1 from pg_proc where proowner=${role?.oid}`).toHaveLength(0);
      expect(await tx`select 1 from pg_namespace where nspowner=${role?.oid}`).toHaveLength(0);
      expect(
        await tx`select nspname from pg_namespace where nspname !~ '^pg_temp_'
          and nspname !~ '^pg_toast_temp_'
          and has_schema_privilege('threadsignal_worker',oid,'CREATE')`,
      ).toHaveLength(0);
      const [database] = await tx`select
        has_database_privilege('threadsignal_worker',current_database(),'CONNECT') as connect,
        has_database_privilege('threadsignal_worker',current_database(),'CREATE') as create`;
      expect(database).toEqual({ connect: true, create: false });
      await expect(
        asWorker(tx, async (worker) => {
          await worker`create table public.forbidden_worker_table (id integer)`;
        }),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('refuses bootstrap replay instead of resetting the existing worker role', async () => {
    await isolated(async (tx) => {
      await expect(tx.savepoint((nested) => nested.unsafe(operation))).rejects.toMatchObject({
        code: 'P0001',
        message: 'WORKER_ROLE_ALREADY_EXISTS',
      });
    });
  });

  it('cannot read or mutate identity, membership, billing, Storage, or brand profile data', async () => {
    await isolated(async (tx) => {
      const current = await fixture(tx);
      for (const table of [
        'auth.users',
        'public.profiles',
        'public.organizations',
        'public.organization_members',
        'public.organization_invitations',
        'public.subscriptions',
        'public.audit_logs',
        'storage.objects',
      ]) {
        await expect(
          asWorker(tx, async (worker) => {
            await worker`select * from ${worker(table)} limit 0`;
          }),
        ).rejects.toMatchObject({ code: '42501' });
      }
      await expect(
        asWorker(tx, async (worker) => {
          await worker`select profile from public.brands where id=${current.brand}`;
        }),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        asWorker(tx, async (worker) => {
          await worker`update public.brands set name='Unauthorized' where id=${current.brand}`;
        }),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        asWorker(tx, async (worker) => {
          await worker`select public.archive_brand(${current.brand},true)`;
        }),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        asWorker(tx, async (worker) => {
          await worker`select private.organization_role(${current.org})`;
        }),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('reads queued work across tenants while authenticated and anonymous roles remain isolated', async () => {
    await isolated(async (tx) => {
      const first = await fixture(tx);
      const second = await fixture(tx);
      expect(
        await asWorker(
          tx,
          (worker) => worker`select id from public.knowledge_jobs
          where id in (${first.job},${second.job})`,
        ),
      ).toHaveLength(2);
      await tx`select set_config('request.jwt.claim.sub',${first.user},true)`;
      await tx`set local role authenticated`;
      expect(await tx`select id from public.knowledge_jobs where id=${second.job}`).toHaveLength(0);
      expect(await tx`select id from public.knowledge_jobs where id=${first.job}`).toHaveLength(1);
      await expect(
        tx.savepoint(async (nested) => {
          await nested`update public.knowledge_jobs set status='processing' where id=${first.job}`;
        }),
      ).rejects.toMatchObject({ code: '42501' });
      await tx`set local role postgres`;
      expect(
        await tx`select 1 from pg_policies where policyname like 'worker_%'
          and roles <> array['threadsignal_worker']::name[]`,
      ).toHaveLength(0);
      expect(
        await tx`select 1 from pg_auth_members m join pg_roles role on role.oid=m.member
          join pg_roles granted on granted.oid=m.roleid
          where granted.rolname='threadsignal_worker' and role.rolname in ('anon','authenticated','authenticator','service_role')`,
      ).toHaveLength(0);
      await tx`set local role anon`;
      await expect(
        tx.savepoint((nested) => nested`select id from public.knowledge_jobs limit 0`),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('executes real ingestion, unchanged-content upsert, and vector reuse as the restricted role', async () => {
    await isolated(async (tx) => {
      const current = await fixture(tx);
      const storage = new LocalKnowledgeStorage(undefined);
      expect(
        await asWorker(tx, (worker) => processKnowledgeJob(worker, current.job, storage)),
      ).toEqual({ status: 'completed' });
      const chunks = await tx`select id,checksum,embedding::text from public.knowledge_chunks
        where source_id=${current.source} order by id`;
      expect(chunks.length).toBeGreaterThan(0);
      const [source] = await tx`select status,page_count,chunk_count from public.knowledge_sources
        where id=${current.source}`;
      expect(source).toMatchObject({ status: 'ready', page_count: 1, chunk_count: chunks.length });
      const nextJob = randomUUID();
      await tx`update public.knowledge_sources set generation=2,status='pending' where id=${current.source}`;
      await tx`insert into public.knowledge_jobs(id,organization_id,brand_id,source_id,generation,kind)
        values(${nextJob},${current.org},${current.brand},${current.source},2,'ingest')`;
      expect(await asWorker(tx, (worker) => processKnowledgeJob(worker, nextJob, storage))).toEqual(
        { status: 'completed' },
      );
      expect(
        await tx`select id,checksum,embedding::text from public.knowledge_chunks
          where source_id=${current.source} order by id`,
      ).toEqual(chunks);
      await tx`update public.knowledge_documents set is_included=false where source_id=${current.source}`;
      await tx`update public.knowledge_sources set generation=3,status='pending',
        manual_text='Updated verified documentation. Batch optimization accepts source images through the asynchronous API.'
        where id=${current.source}`;
      const changedJob = randomUUID();
      await tx`insert into public.knowledge_jobs(id,organization_id,brand_id,source_id,generation,kind)
        values(${changedJob},${current.org},${current.brand},${current.source},3,'ingest')`;
      expect(
        await asWorker(tx, (worker) => processKnowledgeJob(worker, changedJob, storage)),
      ).toEqual({ status: 'completed' });
      const changed =
        await tx`select id,checksum from public.knowledge_chunks where source_id=${current.source}`;
      expect(changed.length).toBeGreaterThan(0);
      expect(changed[0]?.id).not.toBe(chunks[0]?.id);
      expect(
        await tx`select is_included from public.knowledge_documents where source_id=${current.source}`,
      ).toEqual([{ is_included: false }]);
    });
  });

  it('records bounded retries and terminal failure using only permitted status columns', async () => {
    await isolated(async (tx) => {
      const current = await fixture(tx);
      await tx`update public.knowledge_sources set type='website',manual_text=null,
        selected_pages=array['https://clarityscale.example/unavailable'] where id=${current.source}`;
      for (let attempt = 1; attempt <= 3; attempt++) {
        expect(
          await asWorker(tx, (worker) =>
            processKnowledgeJob(worker, current.job, new LocalKnowledgeStorage(undefined)),
          ),
        ).toEqual({ status: 'retry_or_failed' });
        const [job] =
          await tx`select status,attempts,error_code from public.knowledge_jobs where id=${current.job}`;
        expect(job).toMatchObject({
          status: attempt === 3 ? 'failed' : 'queued',
          attempts: attempt,
          error_code: 'CRAWL_FAILED',
        });
        await tx`update public.knowledge_jobs set available_at=now()-interval '1 second' where id=${current.job}`;
      }
      const [source] =
        await tx`select status,error_code from public.knowledge_sources where id=${current.source}`;
      expect(source).toEqual({ status: 'failed', error_code: 'CRAWL_FAILED' });
    });
  });

  it('cannot alter source/job identity, source inputs, or user inclusion choices', async () => {
    await isolated(async (tx) => {
      const current = await fixture(tx);
      expect(
        await asWorker(tx, (worker) =>
          processKnowledgeJob(worker, current.job, new LocalKnowledgeStorage(undefined)),
        ),
      ).toEqual({ status: 'completed' });
      const prohibited = [
        () => tx`update public.knowledge_sources set generation=9 where id=${current.source}`,
        () =>
          tx`update public.knowledge_sources set manual_text='Changed' where id=${current.source}`,
        () => tx`update public.knowledge_sources set deleted_at=now() where id=${current.source}`,
        () =>
          tx`update public.knowledge_jobs set source_id=${randomUUID()} where id=${current.job}`,
        () =>
          tx`update public.knowledge_documents set is_included=false where source_id=${current.source}`,
        () =>
          tx`update public.knowledge_chunks set content='Changed' where source_id=${current.source}`,
        () => tx`truncate public.knowledge_jobs`,
      ];
      for (const statement of prohibited) {
        await expect(
          asWorker(tx, async () => {
            await statement();
          }),
        ).rejects.toMatchObject({ code: '42501' });
      }
      await expect(
        asWorker(
          tx,
          (worker) => worker`insert into public.knowledge_jobs
          (organization_id,brand_id,source_id,generation,kind)
          values(${current.org},${current.brand},${current.source},3,'ingest')`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('cannot delete active sources and processes only owner-requested tombstone deletion', async () => {
    await isolated(async (tx) => {
      const current = await fixture(tx);
      expect(
        await asWorker(
          tx,
          (worker) => worker`delete from public.knowledge_sources
          where id=${current.source} returning id`,
        ),
      ).toHaveLength(0);
      await tx`select set_config('request.jwt.claim.sub',${current.user},true)`;
      await tx`set local role authenticated`;
      await tx`select public.delete_knowledge_source(${current.source})`;
      await tx`set local role postgres`;
      const [job] = await tx`select id from public.knowledge_jobs
        where source_id=${current.source} and kind='delete'`;
      expect(
        await asWorker(tx, (worker) =>
          processKnowledgeJob(worker, String(job?.id), new LocalKnowledgeStorage(undefined)),
        ),
      ).toEqual({ status: 'deleted' });
      expect(
        await tx`select id from public.knowledge_sources where id=${current.source}`,
      ).toHaveLength(0);
      expect(
        await tx`select id from public.knowledge_jobs where source_id=${current.source}`,
      ).toHaveLength(0);
    });
  });

  it('keeps the additive local guard identical to the separately reviewed hosted prerequisite', () => {
    const local = readFileSync(
      new URL(
        '../../supabase/migrations/20260923090000_knowledge_worker_organization_guard.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const hosted = readFileSync(
      new URL('../../supabase/operations/phase2-worker-organization-guard.sql', import.meta.url),
      'utf8',
    );
    expect(local).toBe(hosted);
  });

  it('denies helper calls to tenant and anonymous sessions and preserves narrow function authority', async () => {
    await isolated(async (tx) => {
      const current = await fixture(tx);
      await asWorker(tx, (worker) =>
        worker.unsafe(
          operation.slice(operation.indexOf('-- Refuse unexpected inherited authority')),
        ),
      );
      const functions = await tx`select p.proname,p.prosecdef,p.proconfig,
        pg_catalog.pg_get_userbyid(p.proowner) as owner from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('public','private') and p.prokind='f'
        and not exists(select 1 from pg_catalog.pg_depend d where
          d.classid='pg_catalog.pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
        and has_function_privilege('threadsignal_worker',p.oid,'EXECUTE') order by p.proname`;
      expect(functions).toEqual([
        {
          proname: 'worker_knowledge_dispatch',
          prosecdef: true,
          proconfig: ['search_path=""'],
          owner: 'postgres',
        },
        {
          proname: 'worker_lock_knowledge_organization',
          prosecdef: true,
          proconfig: ['search_path=""'],
          owner: 'postgres',
        },
      ]);
      for (const role of ['anon', 'authenticated', 'service_role'] as const) {
        await tx.unsafe(`set local role ${role}`);
        await expect(
          tx.savepoint(
            (nested) => nested`select public.worker_lock_knowledge_organization(${current.job})`,
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          tx.savepoint((nested) => nested`select * from public.worker_knowledge_dispatch(1)`),
        ).rejects.toMatchObject({ code: '42501' });
        await tx`set local role postgres`;
      }
      expect(
        await asWorker(
          tx,
          (worker) =>
            worker`select public.worker_lock_knowledge_organization(${randomUUID()}) as eligible`,
        ),
      ).toEqual([{ eligible: false }]);
      await expect(
        asWorker(tx, (worker) => worker`select * from public.worker_knowledge_dispatch(101)`),
      ).rejects.toMatchObject({ message: 'INVALID_INPUT' });
    });
  });

  it('suppresses paused organization dispatch and claims without consuming an attempt', async () => {
    await isolated(async (tx) => {
      const paused = await fixture(tx);
      const active = await fixture(tx);
      await tx`update public.organizations set status='suspended' where id=${paused.org}`;
      expect(
        await asWorker(tx, (worker) =>
          processKnowledgeJob(worker, paused.job, new LocalKnowledgeStorage(undefined)),
        ),
      ).toEqual({ status: 'skipped' });
      expect(
        await tx`select status,attempts from public.knowledge_jobs where id=${paused.job}`,
      ).toEqual([{ status: 'queued', attempts: 0 }]);
      const dispatched = await asWorker(
        tx,
        (worker) => worker`select * from public.worker_knowledge_dispatch(100)`,
      );
      expect(dispatched.some((job) => job.id === paused.job)).toBe(false);
      expect(dispatched.some((job) => job.id === active.job)).toBe(true);
      expect(dispatched.every((job) => Object.keys(job).sort().join(',') === 'attempts,id')).toBe(
        true,
      );
      await tx`update public.organizations set status='active' where id=${paused.org}`;
      expect(
        await asWorker(tx, (worker) =>
          processKnowledgeJob(worker, paused.job, new LocalKnowledgeStorage(undefined)),
        ),
      ).toEqual({ status: 'completed' });
    });
  });

  it('fences already claimed publication after pause and allows owner-requested cleanup', async () => {
    await isolated(async (tx) => {
      const current = await fixture(tx);
      const claimed = await asWorker(tx, (worker) => claimKnowledgeJob(worker, current.job));
      if (!claimed) throw new Error('Expected a claimed knowledge job.');
      await tx`update public.organizations set status='suspended' where id=${current.org}`;
      expect(await asWorker(tx, (worker) => publishKnowledge(worker, claimed, [], false))).toBe(
        false,
      );
      expect(await tx`select status from public.knowledge_jobs where id=${current.job}`).toEqual([
        { status: 'processing' },
      ]);
      await tx`update public.organizations set status='active' where id=${current.org}`;
      await tx`select set_config('request.jwt.claim.sub',${current.user},true)`;
      await tx`set local role authenticated`;
      await tx`select public.delete_knowledge_source(${current.source})`;
      await tx`set local role postgres`;
      await tx`update public.organizations set status='suspended' where id=${current.org}`;
      const [job] =
        await tx`select id from public.knowledge_jobs where source_id=${current.source} and kind='delete'`;
      expect(
        await asWorker(
          tx,
          (worker) =>
            worker`select id from public.worker_knowledge_dispatch(100) where id=${String(job?.id)}`,
        ),
      ).toHaveLength(1);
      expect(
        await asWorker(tx, (worker) =>
          processKnowledgeJob(worker, String(job?.id), new LocalKnowledgeStorage(undefined)),
        ),
      ).toEqual({ status: 'deleted' });
      expect(
        await tx`select id from public.knowledge_sources where id=${current.source}`,
      ).toHaveLength(0);
    });
  });
});
