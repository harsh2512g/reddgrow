import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { z } from 'zod';
import { demoBrand } from '@threadsignal/knowledge';
import { MockRedditProvider, type RedditProvider } from '@threadsignal/reddit';
import { createEmailProvider } from '@threadsignal/email';
import { createAIProvider, providerEmbeddingIdentity } from '@threadsignal/ai';
import { createCrawlerProvider } from '@threadsignal/crawler';
import { createLogger } from '../../packages/shared/src/logger';
import { verifyDeploymentDatabaseAuthority } from '../../packages/database/src/runtime-authority';
import { processKnowledgeJob } from '../../apps/worker/src/jobs/knowledge';
import { processRedditJob } from '../../apps/worker/src/jobs/reddit';
import { processDraftJob } from '../../apps/worker/src/jobs/drafts';
import { processNotification } from '../../apps/worker/src/jobs/notifications';
import {
  processPrivacyJob,
  maintainPrivacy,
  type PrivacyStorage,
} from '../../apps/worker/src/jobs/privacy';
import { LocalKnowledgeStorage } from '../../apps/worker/src/storage';
import { localDatabaseUrl, verifyDocker } from '../../scripts/service-utils.mjs';

const operation = readFileSync(
  new URL('../../supabase/operations/deployment-runtime-roles.sql', import.meta.url),
  'utf8',
);
describe('deployment roles on disposable rollback-only local fixtures', () => {
  let sql: postgres.Sql;
  beforeAll(() => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 1, connect_timeout: 5, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql?.end({ timeout: 3 });
  });

  async function isolated(run: (tx: postgres.TransactionSql) => Promise<void>) {
    const rollback = new Error('ROLL_BACK_DEPLOYMENT_ROLE_FIXTURE');
    try {
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(1414743635,9)`;
        await tx.unsafe(operation);
        await tx`grant threadsignal_runtime_worker,threadsignal_runtime_web to postgres with inherit false,set true`;
        await run(tx);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  async function asRole<T>(
    tx: postgres.TransactionSql,
    role: 'threadsignal_runtime_worker' | 'threadsignal_runtime_web',
    run: (connection: postgres.Sql) => Promise<T>,
  ) {
    await tx.unsafe(`set local role ${role}`);
    try {
      return await tx.savepoint(async (scoped) => {
        const connection = new Proxy(sql, {
          apply(_target, _receiver, args) {
            return Reflect.apply(scoped, scoped, args);
          },
          get(_target, property) {
            if (property === 'begin')
              return (...args: unknown[]) => {
                const body = args.at(-1);
                if (typeof body !== 'function')
                  throw new Error('Fixture transaction callback required');
                return scoped.savepoint((nested) => body(nested));
              };
            return Reflect.get(scoped, property);
          },
        });
        return run(connection);
      });
    } finally {
      await tx`set local role postgres`;
    }
  }
  const asWorker = <T>(
    tx: postgres.TransactionSql,
    run: (connection: postgres.Sql) => Promise<T>,
  ) => asRole(tx, 'threadsignal_runtime_worker', run);

  async function fixture(tx: postgres.TransactionSql) {
    const user = randomUUID(),
      source = randomUUID(),
      job = randomUUID();
    const slug = `runtime-${user.slice(0, 8)}`;
    await tx`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(${user},${`${user}@runtime.example`},now(),'{}')`;
    await tx`select set_config('request.jwt.claim.sub',${user},true)`;
    await tx`set local role authenticated`;
    const [organization] =
      await tx`select public.create_organization('Runtime fixture',${slug},${`${user}@runtime.example`}) as id`;
    const org = z.uuid().parse(organization?.id);
    const [createdBrand] =
      await tx`select public.save_brand(${org},null,${tx.json(demoBrand)}) as id`;
    const brand = z.uuid().parse(createdBrand?.id);
    await tx`set local role postgres`;
    await tx`update public.subscriptions set provider='mock',status='active',plan_key='growth' where organization_id=${org}`;
    await tx`insert into public.knowledge_sources(id,organization_id,brand_id,name,type,manual_text) values(${source},${org},${brand},'Verified product notes','manual','ClarityScale AI supports image optimization and batch upscaling through an asynchronous API. Very compressed source files may still show artifacts. API uploads are deleted after twenty-four hours.')`;
    await tx`insert into public.knowledge_jobs(id,organization_id,brand_id,source_id,generation,kind) values(${job},${org},${brand},${source},1,'ingest')`;
    return { user, org, brand, source, job, slug };
  }

  it('creates no login credentials, privileged attributes, owned objects or inherited roles', async () => {
    await isolated(async (tx) => {
      const roles =
        await tx`select rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls from pg_roles where rolname in ('threadsignal_runtime_worker','threadsignal_runtime_web') order by rolname`;
      expect(roles).toHaveLength(2);
      for (const role of roles)
        expect(role).toMatchObject({
          rolcanlogin: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          rolbypassrls: false,
        });
      expect(
        await tx`select 1 from pg_class c join pg_roles r on r.oid=c.relowner where r.rolname in ('threadsignal_runtime_worker','threadsignal_runtime_web')`,
      ).toHaveLength(0);
      expect(
        await tx`select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname='threadsignal_runtime_worker'`,
      ).toHaveLength(0);
      expect(
        await tx`select granted.rolname,m.inherit_option,m.set_option,m.admin_option from pg_auth_members m join pg_roles member on member.oid=m.member join pg_roles granted on granted.oid=m.roleid where member.rolname='threadsignal_runtime_web' order by granted.rolname`,
      ).toEqual([
        {
          rolname: 'threadsignal_billing_api',
          inherit_option: false,
          set_option: true,
          admin_option: false,
        },
        {
          rolname: 'threadsignal_extension_api',
          inherit_option: false,
          set_option: true,
          admin_option: false,
        },
        {
          rolname: 'threadsignal_tracking_api',
          inherit_option: false,
          set_option: true,
          admin_option: false,
        },
      ]);
      await expect(tx.savepoint((nested) => nested.unsafe(operation))).rejects.toMatchObject({
        message: 'RUNTIME_ROLE_ALREADY_EXISTS',
      });
    });
  });

  it('denies identity access, credential hashes, plan mutation and ordinary user RPCs', async () => {
    await isolated(async (tx) => {
      for (const role of ['threadsignal_runtime_worker', 'threadsignal_runtime_web'] as const) {
        for (const statement of [
          'select id from auth.users limit 0',
          'select id from public.profiles limit 0',
          'select token_hash from public.organization_invitations limit 0',
          'select token_hash from public.extension_sessions limit 0',
          'select key_hash from public.conversion_api_keys limit 0',
          'select receipt_hash from public.tracking_clicks limit 0',
          'select provider_customer_id from public.subscriptions limit 0',
          "update public.subscriptions set plan_key='growth' where false",
          'select public.platform_admin_session()',
          'create table public.forbidden_runtime (id integer)',
        ])
          await expect(
            asRole(tx, role, (connection) => connection.unsafe(statement)),
          ).rejects.toMatchObject({ code: '42501' });
      }
      await expect(
        asRole(
          tx,
          'threadsignal_runtime_web',
          (connection) => connection`select id from public.knowledge_sources limit 0`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await asRole(tx, 'threadsignal_runtime_web', async (connection) => {
        await connection`set local role threadsignal_tracking_api`;
        expect((await connection`select current_user as role`)[0]?.role).toBe(
          'threadsignal_tracking_api',
        );
      });
    });
  });

  it('verifies runtime authority and fails closed when a deployment gains unexpected access', async () => {
    await isolated(async (tx) => {
      await asRole(tx, 'threadsignal_runtime_web', (connection) =>
        verifyDeploymentDatabaseAuthority(connection, 'web'),
      );
      await asWorker(tx, (connection) => verifyDeploymentDatabaseAuthority(connection, 'worker'));
      await expect(
        asWorker(tx, (connection) => verifyDeploymentDatabaseAuthority(connection, 'web')),
      ).rejects.toThrow('DEPLOYMENT_DATABASE_AUTHORITY_INVALID');
      await tx`grant select(token_hash) on public.extension_sessions to threadsignal_runtime_worker`;
      await expect(
        asWorker(tx, (connection) => verifyDeploymentDatabaseAuthority(connection, 'worker')),
      ).rejects.toThrow('DEPLOYMENT_DATABASE_AUTHORITY_INVALID');
    });
  });

  it('allows worker parent locks without organization or brand changes or human approval', async () => {
    await isolated(async (tx) => {
      const current = await fixture(tx);
      await asWorker(tx, async (worker) => {
        expect(
          await worker`select id from public.organizations where id=${current.org} for update`,
        ).toHaveLength(1);
        expect(
          await worker`select id from public.brands where id=${current.brand} for update`,
        ).toHaveLength(1);
      });
      await expect(
        asWorker(
          tx,
          (worker) => worker`update public.organizations set id=id where id=${current.org}`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        asWorker(tx, (worker) => worker`update public.brands set id=id where id=${current.brand}`),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        asWorker(tx, (worker) => worker`select public.approve_draft(${randomUUID()},1,false,true)`),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it.each([
    'grant update(status) on public.organizations to threadsignal_runtime_worker',
    'grant select on public.profiles to threadsignal_runtime_worker',
    'grant execute on function public.approve_draft(uuid,integer,boolean,boolean) to threadsignal_runtime_worker',
    'grant truncate on public.knowledge_sources to threadsignal_runtime_worker',
  ])('refuses drift in the runtime privilege boundary: %s', async (statement) => {
    await isolated(async (tx) => {
      await tx.unsafe(statement);
      await expect(
        asWorker(tx, (connection) => verifyDeploymentDatabaseAuthority(connection, 'worker')),
      ).rejects.toThrow('DEPLOYMENT_DATABASE_AUTHORITY_INVALID');
    });
  });

  it('records general worker AI usage idempotently without accepting forged scope or metadata', async () => {
    await isolated(async (tx) => {
      const current = await fixture(tx);
      const other = await fixture(tx);
      const operationId = randomUUID();
      const metadata = {
        provider: 'openai',
        model: 'fixture-model',
        input_tokens: 123,
        output_tokens: 7,
        estimated_cost_usd: null,
      };
      const record = (
        org = current.org,
        brand = current.brand,
        id = operationId,
        task = 'knowledge.embed',
        usage: Record<string, unknown> = metadata,
      ) =>
        asWorker(
          tx,
          (worker) =>
            worker`select private.record_ai_usage(${org},${brand},${id},${task},${JSON.stringify(usage)}::text::jsonb)`,
        );
      await record();
      await record();
      expect(
        await asWorker(
          tx,
          (worker) =>
            worker`select operation_id,input_tokens,output_tokens,estimated_cost_usd from public.ai_task_usage where operation_id=${operationId}`,
        ),
      ).toEqual([
        {
          operation_id: operationId,
          input_tokens: 123,
          output_tokens: 7,
          estimated_cost_usd: null,
        },
      ]);
      await expect(record(other.org, current.brand, randomUUID())).rejects.toThrow(
        'AI_USAGE_FORBIDDEN',
      );
      await expect(record(other.org, other.brand)).rejects.toThrow('AI_USAGE_OPERATION_CONFLICT');
      await expect(
        record(current.org, current.brand, operationId, 'opportunity.evaluate'),
      ).rejects.toThrow('AI_USAGE_OPERATION_CONFLICT');
      await expect(
        record(current.org, current.brand, randomUUID(), 'brand.extract'),
      ).rejects.toThrow('AI_USAGE_FORBIDDEN');
      for (const patch of [
        { provider: 'unapproved' },
        { input_tokens: -1 },
        { output_tokens: 0.5 },
        { input_tokens: 1_000_001 },
        { estimated_cost_usd: 101 },
        { estimated_cost_usd: -0.01 },
        { input_tokens: '123' },
        { model: 'x'.repeat(151) },
        { secret: 'forbidden extra field' },
      ])
        await expect(
          record(current.org, current.brand, randomUUID(), 'knowledge.embed', {
            ...metadata,
            ...patch,
          }),
        ).rejects.toThrow('INVALID_AI_USAGE');
      await expect(
        record(current.org, current.brand, operationId, 'knowledge.embed', {
          ...metadata,
          input_tokens: 124,
        }),
      ).rejects.toThrow('AI_USAGE_OPERATION_CONFLICT');
    });
  });

  it('limits web AI accounting to authenticated member scope and web tasks through its bridge', async () => {
    await isolated(async (tx) => {
      const current = await fixture(tx);
      const other = await fixture(tx);
      const operationId = randomUUID();
      const metadata = JSON.stringify({ provider: 'mock' });
      await tx`select set_config('request.jwt.claim.sub',${current.user},true)`;
      await tx`set local role authenticated`;
      await expect(
        tx.savepoint(
          (nested) =>
            nested`select private.record_ai_usage(${current.org},${current.brand},${randomUUID()},'brand.extract',${metadata}::jsonb)`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await tx`set local role postgres`;
      // SET ROLE consults session_user; this rollback harness is administratively
      // connected, so inspect the deployment login's actual membership instead.
      expect(
        (
          await tx`select pg_has_role('threadsignal_runtime_web','threadsignal_runtime_worker','SET') as allowed`
        )[0]?.allowed,
      ).toBe(false);
      const record = (
        user: string,
        org = current.org,
        brand = current.brand,
        task = 'brand.extract',
      ) =>
        asRole(tx, 'threadsignal_runtime_web', async (web) => {
          await web`set local role threadsignal_billing_api`;
          await web`select set_config('request.jwt.claim.sub',${user},true)`;
          await web`select private.record_ai_usage(${org},${brand},${operationId},${task},${metadata}::text::jsonb)`;
        });
      await expect(record('')).rejects.toThrow('AI_USAGE_FORBIDDEN');
      await expect(record(other.user)).rejects.toThrow('AI_USAGE_FORBIDDEN');
      await expect(record(current.user, other.org, other.brand)).rejects.toThrow(
        'AI_USAGE_FORBIDDEN',
      );
      await expect(record(current.user, current.org, other.brand)).rejects.toThrow(
        'AI_USAGE_FORBIDDEN',
      );
      await expect(
        record(current.user, current.org, current.brand, 'knowledge.embed'),
      ).rejects.toThrow('AI_USAGE_FORBIDDEN');
      await record(current.user);
      const receipts =
        await tx`select operation_id,provider,input_tokens,output_tokens,estimated_cost_usd from public.ai_task_usage where operation_id=${operationId}`;
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({
        operation_id: operationId,
        provider: 'mock',
        input_tokens: 0,
        output_tokens: 0,
      });
      expect(Number(receipts[0]?.estimated_cost_usd)).toBe(0);
    });
  });

  it('runs actual knowledge, Reddit scoring and draft stages under the restricted worker', async () => {
    await isolated(async (tx) => {
      const current = await fixture(tx);
      const ai = createAIProvider();
      expect(
        await asWorker(tx, (worker) =>
          processKnowledgeJob(worker, current.job, new LocalKnowledgeStorage(undefined), {
            ai,
            crawler: createCrawlerProvider(),
            embeddingIdentity: providerEmbeddingIdentity(ai),
          }),
        ),
      ).toEqual({ status: 'completed' });
      const communityName = `rt${current.user.slice(0, 8)}`;
      await tx`set local role authenticated`;
      const [association] =
        await tx`select public.add_brand_subreddit(${current.brand},${communityName},'{"minimum_score":0}') as id`;
      await tx`set local role postgres`;
      const [community] =
        await tx`select subreddit_id from public.brand_subreddits where id=${String(association?.id)}`;
      const subreddit = z.uuid().parse(community?.subreddit_id);
      const now = new Date(),
        base = new MockRedditProvider({ now: () => now });
      const provider: RedditProvider = {
        mode: 'mock',
        searchSubreddits: async () => [],
        getSubreddit: async () => ({ ...(await base.getSubreddit('SaaS')), name: communityName }),
        getSubredditRules: () => base.getSubredditRules('SaaS'),
        listPosts: async () => {
          const post = await base.getPostById('fixture_001');
          if (!post) throw new Error('Missing fixture post');
          return {
            posts: [
              {
                ...post,
                id: `${communityName}_001`,
                subreddit: communityName,
                permalink: `https://www.reddit.com/r/${communityName}/comments/${communityName}_001`,
              },
            ],
            after: null,
          };
        },
        getPostById: async () => null,
      };
      const [queued] = await tx`select private.queue_reddit_job('sync',${subreddit}) as id`;
      expect(
        (
          await asWorker(tx, (worker) =>
            processRedditJob(worker, String(queued?.id), provider, now),
          )
        ).status,
      ).toBe('completed');
      const jobs =
        await tx`select id from public.reddit_jobs where brand_id=${current.brand} and kind='evaluate'`;
      expect(jobs).toHaveLength(1);
      expect(
        (
          await asWorker(tx, (worker) =>
            processRedditJob(worker, String(jobs[0]?.id), provider, now),
          )
        ).status,
      ).toBe('completed');
      const [opportunity] =
        await tx`select id from public.opportunities where brand_id=${current.brand} and not is_blocked`;
      expect(opportunity).toBeDefined();
      await tx`set local role authenticated`;
      await tx`select public.request_draft(${String(opportunity?.id)},${randomUUID()},'{}')`;
      await tx`set local role postgres`;
      for (let stage = 0; stage < 3; stage++) {
        const [job] =
          await tx`select id from public.draft_jobs where organization_id=${current.org} and status='queued' order by created_at,id limit 1`;
        expect(job).toBeDefined();
        expect(
          (await asWorker(tx, (worker) => processDraftJob(worker, String(job?.id)))).status,
        ).toBe('completed');
      }
      const [draft] =
        await tx`select id,current_version,status from public.drafts where organization_id=${current.org}`;
      expect(draft?.status).not.toBe('approved');
      await expect(
        asWorker(
          tx,
          (worker) =>
            worker`update public.drafts set status='approved',approved_by=${current.user},approved_at=now() where id=${String(draft?.id)}`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
      // The computed feed label is a read model, not approval authority. Each mutation
      // remains protected by the existing independent approval/handoff procedures.
      const label = async () => {
        await tx`set local role authenticated`;
        try {
          return (
            await tx`select public.opportunity_workflow_status(o) as status from public.opportunities o where id=${String(opportunity?.id)}`
          )[0]?.status;
        } finally {
          await tx`set local role postgres`;
        }
      };
      await tx`update public.drafts set status='ready',verified_version=current_version,verification_status='pass',compliance_status='pass' where id=${String(draft?.id)}`;
      expect(await label()).toBe('draft_ready');
      await tx`update public.drafts set status='approved',approved_by=${current.user},approved_at=now() where id=${String(draft?.id)}`;
      expect(await label()).toBe('approved');
      const stranger = await fixture(tx);
      await tx`set local role authenticated`;
      expect(
        await tx`select id from public.opportunities where id=${String(opportunity?.id)}`,
      ).toHaveLength(0);
      const forged = {
        id: opportunity?.id,
        organization_id: current.org,
        status: 'new',
        is_blocked: false,
      };
      expect(
        (
          await tx`select public.opportunity_workflow_status(jsonb_populate_record(null::public.opportunities,${tx.json(forged)})) as status`
        )[0]?.status,
      ).toBe('new');
      await tx`set local role postgres`;
      expect(stranger.org).not.toBe(current.org);
      await tx`select set_config('request.jwt.claim.sub',${current.user},true)`;
      await tx`update public.drafts set published_at=now(),published_version=current_version where id=${String(draft?.id)}`;
      expect(await label()).toBe('published_manually');
      for (const status of ['dismissed', 'archived']) {
        await tx`update public.opportunities set status=${status} where id=${String(opportunity?.id)}`;
        expect(await label()).toBe(status);
      }
      await tx`update public.opportunities set status='blocked',is_blocked=true,risk_level='blocked',suggested_action='blocked' where id=${String(opportunity?.id)}`;
      expect(await label()).toBe('blocked');
      const [post] =
        await tx`select reddit_post_id from public.opportunities where id=${String(opportunity?.id)}`;
      await tx`update public.reddit_posts set body=repeat('Synthetic excerpt. ',100) where id=${String(post?.reddit_post_id)}`;
      await tx`set local role authenticated`;
      expect(
        (
          await tx`select length(body_excerpt) as length from public.reddit_posts where id=${String(post?.reddit_post_id)}`
        )[0]?.length,
      ).toBe(500);
      await tx`set local role postgres`;
      await tx`select private.purge_reddit_post(${String(post?.reddit_post_id)})`;
      expect(
        (
          await tx`select body_excerpt from public.reddit_posts where id=${String(post?.reddit_post_id)}`
        )[0]?.body_excerpt,
      ).toBeNull();
    });
  });

  it('exports the full safe schema and performs confirmed tenant cleanup without Auth grants', async () => {
    await isolated(async (tx) => {
      const current = await fixture(tx);
      let artifact: Uint8Array | undefined;
      const storage: PrivacyStorage = {
        readOriginal: async () => new Uint8Array(),
        writeExport: async (_path, bytes) => {
          artifact = bytes;
        },
        remove: async () => {},
      };
      await tx`set local role authenticated`;
      const [request] = await tx`select public.begin_organization_export(${current.org}) as id`;
      await tx`set local role postgres`;
      expect(
        await asWorker(tx, (worker) => processPrivacyJob(worker, String(request?.id), storage)),
      ).toEqual({ processed: true, kind: 'export' });
      const exported = z
        .object({ organizationId: z.uuid(), organizations: z.array(z.object({ id: z.uuid() })) })
        .parse(JSON.parse(gunzipSync(artifact!).toString('utf8')));
      expect(exported.organizationId).toBe(current.org);
      expect(exported.organizations).toEqual([{ id: current.org }]);
      await tx`set local role authenticated`;
      const [deletion] =
        await tx`select public.confirm_organization_deletion(${current.org},${current.slug}) as id`;
      await tx`set local role postgres`;
      expect(
        await asWorker(tx, (worker) => processPrivacyJob(worker, String(deletion?.id), storage)),
      ).toEqual({ processed: true, kind: 'delete' });
      expect(await tx`select id from public.organizations where id=${current.org}`).toHaveLength(0);
      expect(await tx`select id from auth.users where id=${current.user}`).toHaveLength(1);
    });
  });

  it('runs notification, analytics, cleanup and retention helpers while keeping current records', async () => {
    await isolated(async (tx) => {
      const current = await fixture(tx);
      const [delivery] =
        await tx`select id from public.notification_deliveries where organization_id=${current.org} and type='welcome'`;
      expect(delivery).toBeDefined();
      const provider = createEmailProvider(
        'console',
        createLogger({ service: 'runtime-role-test', level: 'silent' }),
      );
      expect(
        await asWorker(tx, (worker) => processNotification(worker, String(delivery?.id), provider)),
      ).toEqual({ processed: true, delivery: 'suppressed' });
      await asWorker(tx, async (worker) => {
        await worker`select private.maintain_billing_periods(1)`;
        await worker`select private.schedule_notifications(1)`;
        await worker`select private.refresh_attribution_analytics(1)`;
        await worker`select private.cleanup_expired_extension_sessions()`;
        await maintainPrivacy(worker, {
          readOriginal: async () => new Uint8Array(),
          writeExport: async () => {},
          remove: async () => {},
        });
      });
      expect(
        await tx`select id from public.audit_logs where organization_id=${current.org}`,
      ).not.toHaveLength(0);
    });
  });
});
