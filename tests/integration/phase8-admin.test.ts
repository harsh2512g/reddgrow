import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { demoBrand } from '@threadsignal/knowledge';
import { localDatabaseUrl, verifyDocker } from '../../scripts/service-utils.mjs';
import { claimDraftJob } from '../../apps/worker/src/jobs/drafts';
import {
  activityPageSchema,
  jobsPageSchema,
  organizationDetailSchema,
  organizationsPageSchema,
  overviewSchema,
  retryResultSchema,
  statusResultSchema,
} from '../../apps/web/src/lib/phase8/contracts';

const actors = { platform: randomUUID(), owner: randomUUID(), other: randomUUID() };
const evaluation = {
  summary: 'Private opportunity summary',
  user_need: 'Private customer need',
  intent_category: 'recommendation',
  semantic_relevance: 95,
  buying_intent: 95,
  freshness: 100,
  engagement_velocity: 80,
  rule_fit: 100,
  competitor_context: 80,
  penalty_score: 0,
  final_score: 94,
  risk_level: 'low',
  suggested_action: 'reply',
  is_blocked: false,
  risk_reasons: [],
  matched_capabilities: [],
  missing_capabilities: [],
  matched_competitor_ids: [],
  knowledge_citations: [],
  reasoning_summary: 'Private rationale',
  model_metadata: { provider: 'mock' },
  input_checksum: 'a'.repeat(64),
};

describe('Phase 8 platform operations authority and lifecycle', () => {
  let sql: postgres.Sql;
  let organization: string;
  let otherOrganization: string;
  let brand: string;
  const communities: string[] = [];
  const retries: string[] = [];
  async function asUser<T>(actor: string, operation: (tx: postgres.TransactionSql) => Promise<T>) {
    return sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${actor},true),set_config('request.jwt.claims',${JSON.stringify({ sub: actor, role: 'authenticated' })},true)`;
      await tx`set local role authenticated`;
      return operation(tx);
    });
  }
  async function retry(
    family: string,
    id: string,
    key: string = randomUUID(),
    actor = actors.platform,
  ) {
    const [row] = await asUser(
      actor,
      (tx) =>
        tx`select public.platform_admin_retry_job(${family},${id},'provider_failure',${key}) as value`,
    );
    const result = retryResultSchema.parse(row?.value);
    retries.push(result.job_id);
    return result;
  }
  async function pause(value: boolean, key: string = randomUUID(), actor = actors.platform) {
    const [row] = await asUser(
      actor,
      (tx) =>
        tx`select public.platform_admin_set_organization_status(${organization},${value},'maintenance',${key}) as value`,
    );
    return statusResultSchema.parse(row?.value);
  }
  async function failedKnowledge(kind: 'ingest' | 'delete' = 'ingest') {
    const [source] =
      await sql`insert into public.knowledge_sources(organization_id,brand_id,name,type,status,manual_text,deleted_at)
      values(${organization},${brand},'Private source name','manual',${kind === 'delete' ? 'deleting' : 'failed'},'PRIVATE_DOCUMENT_TEXT',${kind === 'delete' ? new Date() : null}) returning id`;
    const [job] =
      await sql`insert into public.knowledge_jobs(organization_id,brand_id,source_id,generation,kind,status,attempts,error_code)
      values(${organization},${brand},${String(source?.id)},1,${kind},'failed',3,'PROVIDER_UNAVAILABLE') returning id`;
    return { id: String(job?.id), source: String(source?.id) };
  }
  async function failedNotification() {
    const [row] =
      await sql`insert into public.notification_deliveries(organization_id,user_id,type,dedupe_key,status,attempts,first_attempt_at,delivery_fingerprint,payload)
      values(${organization},${actors.owner},'welcome',${randomUUID()},'failed',3,now(),${'a'.repeat(64)},'{"private_marker":"PRIVATE_EMAIL_PAYLOAD"}') returning id`;
    return String(row?.id);
  }
  async function failedDraft() {
    const name = `p8_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
    const [community] =
      await sql`insert into public.subreddits(name,display_name) values(${name},${name}) returning id`;
    const subreddit = String(community?.id);
    communities.push(subreddit);
    await sql`insert into public.brand_subreddits(organization_id,brand_id,subreddit_id) values(${organization},${brand},${subreddit})`;
    const [post] =
      await sql`insert into public.reddit_posts(provider,provider_post_id,subreddit_id,title,body,created_at_provider)
      values('mock',${`p8_${randomUUID().replaceAll('-', '')}`},${subreddit},'PRIVATE_REDDIT_TITLE','PRIVATE_REDDIT_BODY',now()) returning id`;
    const [opportunity] =
      await sql`select private.publish_opportunity(${brand},${String(post?.id)},${sql.json(evaluation)}) as id`;
    const [draft] = await asUser(
      actors.owner,
      (tx) =>
        tx`select public.request_draft(${String(opportunity?.id)},${randomUUID()},'{}') as id`,
    );
    const draftId = String(draft?.id);
    await sql`update public.drafts set status='error',error_code='PROVIDER_UNAVAILABLE' where id=${draftId}`;
    const [job] =
      await sql`update public.draft_jobs set status='failed',attempts=3,error_code='PROVIDER_UNAVAILABLE' where draft_id=${draftId} returning id`;
    return { id: String(job?.id), draft: draftId, post: String(post?.id), subreddit };
  }
  beforeAll(async () => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 6, connect_timeout: 5, onnotice: () => {} });
    for (const actor of Object.values(actors))
      await sql`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(${actor},${`${actor}@phase8.example`},now(),'{"is_platform_admin":true}')`;
    // Synthetic test fixture only. No seeded/demo or existing identity receives this flag.
    await sql`update public.profiles set is_platform_admin=true where id=${actors.platform}`;
    for (const actor of [actors.owner, actors.other]) {
      const [row] = await asUser(
        actor,
        (tx) =>
          tx`select public.create_organization('Operations fixtures',${`p8-${actor}`},${`${actor}@phase8.example`}) as id`,
      );
      if (actor === actors.owner) organization = String(row?.id);
      else otherOrganization = String(row?.id);
    }
  });
  beforeEach(async () => {
    await sql`update public.organizations set status='active',deleted_at=null where id=${organization}`;
    await sql`delete from public.brands where organization_id=${organization}`;
    if (communities.length)
      await sql`delete from public.subreddits where id in ${sql(communities)}`;
    communities.length = 0;
    await sql`delete from public.usage_counters where organization_id=${organization}`;
    await sql`delete from public.notification_deliveries where organization_id=${organization}`;
    await sql`delete from public.organization_data_requests where organization_id=${organization}`;
    await sql`delete from private.platform_operations_audit where actor_user_id=${actors.platform}`;
    await sql`delete from private.platform_job_retries where actor_user_id=${actors.platform}`;
    await sql`update public.subscriptions set status='trialing',current_period_end=now()+interval '7 days' where organization_id=${organization}`;
    const [row] = await asUser(
      actors.owner,
      (tx) =>
        tx`select public.save_brand(${organization},null,${tx.json({ ...demoBrand, competitors: [] })}) as id`,
    );
    brand = String(row?.id);
  });
  afterAll(async () => {
    if (!sql) return;
    await sql`delete from private.platform_operations_audit where actor_user_id=${actors.platform}`;
    await sql`delete from private.platform_job_retries where actor_user_id=${actors.platform}`;
    if (organization)
      await sql`delete from public.organizations where id in (${organization},${otherOrganization})`;
    if (communities.length)
      await sql`delete from public.subreddits where id in ${sql(communities)}`;
    if (retries.length) await sql`delete from public.reddit_jobs where id in ${sql(retries)}`;
    await sql`delete from auth.users where id in ${sql(Object.values(actors))}`;
    await sql.end({ timeout: 5 });
  });

  it('separates platform authority from owner role and ignores self-authored Auth metadata', async () => {
    const [owner] = await asUser(
      actors.owner,
      (tx) => tx`select public.platform_admin_session() as value`,
    );
    const [platform] = await asUser(
      actors.platform,
      (tx) => tx`select public.platform_admin_session() as value`,
    );
    expect(owner?.value).toBe(false);
    expect(platform?.value).toBe(true);
    await expect(
      asUser(
        actors.owner,
        (tx) => tx`update public.profiles set is_platform_admin=true where id=${actors.owner}`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    for (const actor of [actors.owner, actors.other]) {
      await expect(
        asUser(actor, (tx) => tx`select public.platform_admin_overview()`),
      ).rejects.toThrow('PLATFORM_ADMIN_REQUIRED');
      await expect(
        asUser(actor, (tx) => tx`select public.platform_admin_organizations()`),
      ).rejects.toThrow('PLATFORM_ADMIN_REQUIRED');
      await expect(
        asUser(actor, (tx) => tx`select public.platform_admin_organization(${organization})`),
      ).rejects.toThrow('PLATFORM_ADMIN_REQUIRED');
      await expect(asUser(actor, (tx) => tx`select public.platform_admin_jobs()`)).rejects.toThrow(
        'PLATFORM_ADMIN_REQUIRED',
      );
      await expect(pause(true, randomUUID(), actor)).rejects.toThrow('PLATFORM_ADMIN_REQUIRED');
      await expect(retry('knowledge', randomUUID(), randomUUID(), actor)).rejects.toThrow(
        'PLATFORM_ADMIN_REQUIRED',
      );
    }
  });
  it('keeps admin metadata and mutation helpers unavailable to anonymous or raw table access', async () => {
    await failedKnowledge();
    const [privileges] =
      await sql`select has_function_privilege('anon','public.platform_admin_overview()','EXECUTE') as anon,
      has_function_privilege('authenticated','private.platform_metrics(uuid)','EXECUTE') as helper,
      has_table_privilege('authenticated','private.platform_operations_audit','SELECT') as audit,
      has_table_privilege('authenticated','private.platform_job_metadata','SELECT') as jobs`;
    expect(privileges).toMatchObject({ anon: false, helper: false, audit: false, jobs: false });
    const rows = await asUser(
      actors.platform,
      (tx) => tx`select id from public.knowledge_sources where organization_id=${organization}`,
    );
    expect(rows).toEqual([]);
  });
  it('audits aggregate, organization and job reads without exposing content or personal fields', async () => {
    await failedKnowledge();
    await failedNotification();
    const [overview] = await asUser(
      actors.platform,
      (tx) => tx`select public.platform_admin_overview() as value`,
    );
    const [detail] = await asUser(
      actors.platform,
      (tx) => tx`select public.platform_admin_organization(${organization}) as value`,
    );
    const [jobs] = await asUser(
      actors.platform,
      (tx) =>
        tx`select public.platform_admin_jobs(50,null,null,null,null,${organization}) as value`,
    );
    overviewSchema.parse(overview?.value);
    organizationDetailSchema.parse(detail?.value);
    const parsed = jobsPageSchema.parse(jobs?.value);
    expect(parsed.items.some((item) => item.family === 'knowledge')).toBe(true);
    const serialized = JSON.stringify([overview?.value, detail?.value, jobs?.value]);
    for (const sensitive of [
      'PRIVATE_DOCUMENT_TEXT',
      'PRIVATE_EMAIL_PAYLOAD',
      'Private source name',
      'billing_email',
      'lease_token',
      'provider_customer_id',
      '@phase8.example',
    ])
      expect(serialized).not.toContain(sensitive);
    const audits =
      await sql`select action from private.platform_operations_audit where actor_user_id=${actors.platform}`;
    expect(audits.map((row) => row.action).sort()).toEqual([
      'jobs.list',
      'organization.read',
      'overview.read',
    ]);
  });
  it('paginates organization summaries and validates all cursor/filter bounds', async () => {
    const [page] = await asUser(
      actors.platform,
      (tx) => tx`select public.platform_admin_organizations(1) as value`,
    );
    const parsed = organizationsPageSchema.parse(page?.value);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.next_cursor).toBe(parsed.items[0]?.id);
    const [next] = await asUser(
      actors.platform,
      (tx) => tx`select public.platform_admin_organizations(1,${parsed.next_cursor}) as value`,
    );
    expect(organizationsPageSchema.parse(next?.value).items[0]?.id).not.toBe(parsed.items[0]?.id);
    await expect(
      asUser(actors.platform, (tx) => tx`select public.platform_admin_jobs(51)`),
    ).rejects.toThrow('INVALID_PAGINATION');
    await expect(
      asUser(actors.platform, (tx) => tx`select public.platform_admin_jobs(25,now(),null)`),
    ).rejects.toThrow('INVALID_PAGINATION');
    await expect(
      asUser(
        actors.platform,
        (tx) => tx`select public.platform_admin_jobs(25,null,null,'unknown')`,
      ),
    ).rejects.toThrow('INVALID_PAGINATION');
  });
  it('paginates jobs across tied timestamps without repeats and filters organization', async () => {
    const a = await failedKnowledge();
    const b = await failedKnowledge();
    const c = await failedKnowledge();
    await sql`update public.knowledge_jobs set created_at='2026-01-01T00:00:00Z' where id in (${a.id},${b.id},${c.id})`;
    const seen: string[] = [];
    let cursor: { created_at: string; id: string } | null = null;
    for (let i = 0; i < 3; i++) {
      const before: string | null = cursor?.created_at ?? null;
      const beforeId: string | null = cursor?.id ?? null;
      const [row] = await asUser(
        actors.platform,
        (tx) =>
          tx`select public.platform_admin_jobs(1,${before},${beforeId},'knowledge','failed',${organization}) as value`,
      );
      const page = jobsPageSchema.parse(row?.value);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.next_cursor;
    }
    expect(new Set(seen)).toEqual(new Set([a.id, b.id, c.id]));
    expect(cursor).toBeNull();
  });
  it('pauses atomically, audits a bounded reason, preserves another tenant, and supports exact replay', async () => {
    const key = randomUUID();
    expect(await pause(true, key)).toMatchObject({ status: 'suspended', replayed: false });
    expect(await pause(true, key)).toMatchObject({ status: 'suspended', replayed: true });
    await expect(pause(false, key)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await expect(
      asUser(actors.owner, (tx) => tx`select public.get_organization_settings(${organization})`),
    ).rejects.toThrow('FORBIDDEN');
    const [other] = await asUser(
      actors.other,
      (tx) => tx`select public.get_organization_settings(${otherOrganization}) as value`,
    );
    expect(other?.value).toBeDefined();
    expect(await pause(false)).toMatchObject({ status: 'active' });
    const audits =
      await sql`select parameters from private.platform_operations_audit where actor_user_id=${actors.platform} and action='organization.status'`;
    expect(audits).toHaveLength(2);
    expect(audits[0]?.parameters.reason).toBe('maintenance');
    await expect(
      asUser(
        actors.platform,
        (tx) =>
          tx`select public.platform_admin_set_organization_status(${organization},true,'private freeform note',${randomUUID()})`,
      ),
    ).rejects.toThrow('INVALID_PLATFORM_OPERATION');
  });
  it('refuses to resume a deleted organization', async () => {
    await sql`update public.organizations set status='deleted',deleted_at=now() where id=${organization}`;
    await expect(pause(false)).rejects.toThrow('ORGANIZATION_NOT_FOUND');
  });
  it('retries failed knowledge through a new fenced generation, idempotently', async () => {
    const failed = await failedKnowledge();
    const key = randomUUID();
    const first = await retry('knowledge', failed.id, key);
    expect(first.job_id).not.toBe(failed.id);
    expect(await retry('knowledge', failed.id, key)).toEqual({ ...first, replayed: true });
    await expect(retry('knowledge', failed.id)).rejects.toThrow('JOB_ALREADY_RETRIED');
    const [source] =
      await sql`select generation,status from public.knowledge_sources where id=${failed.source}`;
    expect(source).toMatchObject({ generation: 2, status: 'pending' });
    const [audit] =
      await sql`select count(*)::integer as count from private.platform_operations_audit where actor_user_id=${actors.platform} and action='job.retry'`;
    expect(audit?.count).toBe(1);
  });
  it('rejects nonterminal, stale generation, and paused knowledge retries', async () => {
    const failed = await failedKnowledge();
    for (const status of ['queued', 'processing', 'completed']) {
      await sql`update public.knowledge_jobs set status=${status} where id=${failed.id}`;
      await expect(retry('knowledge', failed.id)).rejects.toThrow('JOB_NOT_RETRYABLE');
    }
    await sql`update public.knowledge_jobs set status='failed' where id=${failed.id}`;
    await pause(true);
    await expect(retry('knowledge', failed.id)).rejects.toThrow('ORGANIZATION_UNAVAILABLE');
    await pause(false);
    await sql`update public.knowledge_sources set generation=2 where id=${failed.source}`;
    await expect(retry('knowledge', failed.id)).rejects.toThrow('JOB_CONTEXT_CHANGED');
  });
  it('retains physical deletion retry semantics without restoring customer text', async () => {
    const failed = await failedKnowledge('delete');
    await sql`update public.knowledge_sources set manual_text=null where id=${failed.source}`;
    const retried = await retry('knowledge', failed.id);
    const [job] =
      await sql`select kind,generation from public.knowledge_jobs where id=${retried.job_id}`;
    const [source] =
      await sql`select status,manual_text,deleted_at from public.knowledge_sources where id=${failed.source}`;
    expect(job).toMatchObject({ kind: 'delete', generation: 2 });
    expect(source).toMatchObject({ status: 'deleting', manual_text: null });
    expect(source?.deleted_at).not.toBeNull();
  });
  it('permits paused cleanup retries while refusing new ingestion in that same organization', async () => {
    const cleanup = await failedKnowledge('delete');
    const ingest = await failedKnowledge();
    await sql`update public.knowledge_sources set manual_text=null where id=${cleanup.source}`;
    await pause(true);
    expect((await retry('knowledge', cleanup.id)).job_id).not.toBe(cleanup.id);
    await expect(retry('knowledge', ingest.id)).rejects.toThrow('ORGANIZATION_UNAVAILABLE');
    const [org] = await sql`select status from public.organizations where id=${organization}`;
    expect(org?.status).toBe('suspended');
  });
  it('serializes distinct retry requests for one failed job', async () => {
    const failed = await failedKnowledge();
    const results = await Promise.allSettled([
      retry('knowledge', failed.id),
      retry('knowledge', failed.id),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
  it('preserves draft reservation and rejects stale approved or changed versions', async () => {
    const failed = await failedDraft();
    const [before] =
      await sql`select quantity from public.usage_counters where organization_id=${organization} and metric='ai_drafts'`;
    expect((await retry('draft', failed.id)).job_id).toBe(failed.id);
    const [after] =
      await sql`select quantity from public.usage_counters where organization_id=${organization} and metric='ai_drafts'`;
    expect(after?.quantity).toBe(before?.quantity);
    const second = await failedDraft();
    await sql`update public.drafts set current_version=1 where id=${second.draft}`;
    await expect(retry('draft', second.id)).rejects.toThrow('JOB_CONTEXT_CHANGED');
  });
  it('blocks a paused organization before draft claim consumes any attempt', async () => {
    const failed = await failedDraft();
    await sql`update public.draft_jobs set status='queued',attempts=0 where id=${failed.id}`;
    await pause(true);
    expect(await claimDraftJob(sql, failed.id)).toBeNull();
    const [job] = await sql`select attempts,status from public.draft_jobs where id=${failed.id}`;
    expect(job).toMatchObject({ attempts: 0, status: 'queued' });
  });
  it('keeps notification idempotency context and refuses expired retry windows', async () => {
    const id = await failedNotification();
    expect((await retry('notification', id)).job_id).toBe(id);
    const [row] =
      await sql`select delivery_fingerprint,first_attempt_at,attempts from public.notification_deliveries where id=${id}`;
    expect(row?.delivery_fingerprint).toBe('a'.repeat(64));
    expect(row?.first_attempt_at).not.toBeNull();
    expect(row?.attempts).toBe(0);
    const expired = await failedNotification();
    await sql`update public.notification_deliveries set first_attempt_at=now()-interval '24 hours' where id=${expired}`;
    await expect(retry('notification', expired)).rejects.toThrow(
      'NOTIFICATION_RETRY_WINDOW_EXPIRED',
    );
  });
  it('retries active Reddit context but refuses paused monitoring and deleted posts', async () => {
    const context = await failedDraft();
    const [failed] =
      await sql`insert into public.reddit_jobs(kind,organization_id,brand_id,reddit_post_id,dedupe_key,status,attempts) values('evaluate',${organization},${brand},${context.post},${randomUUID()},'failed',3) returning id`;
    const id = String(failed?.id);
    await sql`update public.brand_subreddits set status='paused' where brand_id=${brand} and subreddit_id=${context.subreddit}`;
    await expect(retry('reddit', id)).rejects.toThrow('JOB_CONTEXT_CHANGED');
    await sql`update public.brand_subreddits set status='active' where brand_id=${brand} and subreddit_id=${context.subreddit}`;
    expect((await retry('reddit', id)).job_id).not.toBe(id);
    const [deletedJob] =
      await sql`insert into public.reddit_jobs(kind,organization_id,brand_id,reddit_post_id,dedupe_key,status,attempts) values('evaluate',${organization},${brand},${context.post},${randomUUID()},'failed',3) returning id`;
    await sql`select private.purge_reddit_post(${context.post})`;
    await expect(retry('reddit', String(deletedJob?.id))).rejects.toThrow('JOB_CONTEXT_CHANGED');
  });
  it('retries only confirmed failed exports and preserves owner/deadline authority', async () => {
    const [request] = await asUser(
      actors.owner,
      (tx) => tx`select public.begin_organization_export(${organization}) as id`,
    );
    const id = String(request?.id);
    await sql`update public.privacy_jobs set status='failed',attempts=3 where id=${id}`;
    await sql`update public.organization_data_requests set status='failed',expires_at=now()-interval '1 hour' where id=${id}`;
    await expect(retry('privacy', id)).rejects.toThrow('JOB_CONTEXT_CHANGED');
    await sql`update public.organization_data_requests set expires_at=null,confirmed_at=null where id=${id}`;
    await expect(retry('privacy', id)).rejects.toThrow('JOB_CONTEXT_CHANGED');
    await sql`update public.organization_data_requests set confirmed_at=now() where id=${id}`;
    await sql`update public.organization_members set role='admin' where organization_id=${organization} and user_id=${actors.owner}`;
    await expect(retry('privacy', id)).rejects.toThrow('JOB_CONTEXT_CHANGED');
    await sql`update public.organization_members set role='owner' where organization_id=${organization} and user_id=${actors.owner}`;
    expect((await retry('privacy', id)).job_id).toBe(id);
    const [page] = await asUser(
      actors.platform,
      (tx) =>
        tx`select public.platform_admin_jobs(25,null,null,'privacy',null,${organization}) as value`,
    );
    expect(jobsPageSchema.parse(page?.value).items[0]).toMatchObject({
      family: 'privacy',
      kind: 'export',
      status: 'queued',
    });
  });
  it('allows cleanup retry after confirmed deletion without reviving the organization', async () => {
    const [row] = await asUser(
      actors.owner,
      (tx) =>
        tx`select public.confirm_organization_deletion(${organization},${`p8-${actors.owner}`}) as id`,
    );
    const id = String(row?.id);
    await sql`update public.privacy_jobs set status='failed',attempts=3 where id=${id}`;
    await sql`update public.organization_data_requests set status='failed' where id=${id}`;
    expect((await retry('privacy', id)).job_id).toBe(id);
    const [org] =
      await sql`select status,deleted_at from public.organizations where id=${organization}`;
    expect(org?.status).toBe('deleted');
    expect(org?.deleted_at).not.toBeNull();
    await expect(pause(false)).rejects.toThrow('ORGANIZATION_NOT_FOUND');
  });
  it('provides tenant-scoped paginated activity without raw metadata', async () => {
    await sql`insert into public.audit_logs(organization_id,actor_user_id,action,target_type,metadata) values(${organization},${actors.owner},'brand.updated','brand','{"private_text":"PRIVATE_AUDIT_TEXT"}')`;
    const [row] = await asUser(
      actors.owner,
      (tx) => tx`select public.get_organization_activity(${organization},1) as value`,
    );
    const parsed = activityPageSchema.parse(row?.value);
    expect(parsed.items).toHaveLength(1);
    expect(JSON.stringify(parsed)).not.toContain('PRIVATE_AUDIT_TEXT');
    await expect(
      asUser(actors.other, (tx) => tx`select public.get_organization_activity(${organization})`),
    ).rejects.toThrow('FORBIDDEN');
    await expect(
      asUser(actors.platform, (tx) => tx`select public.get_organization_activity(${organization})`),
    ).rejects.toThrow('FORBIDDEN');
  });

  it('bounds manual retries to recent job history while preserving an existing receipt', async () => {
    const failed = await failedKnowledge();
    const key = randomUUID();
    const first = await retry('knowledge', failed.id, key);
    await sql`update public.knowledge_jobs set created_at=now()-interval '91 days' where id=${failed.id}`;
    expect(await retry('knowledge', failed.id, key)).toEqual({ ...first, replayed: true });
    const old = await failedKnowledge();
    await sql`update public.knowledge_jobs set created_at=now()-interval '91 days' where id=${old.id}`;
    await expect(retry('knowledge', old.id)).rejects.toThrow('JOB_NOT_RETRYABLE');
    const [page] = await asUser(
      actors.platform,
      (tx) =>
        tx`select public.platform_admin_jobs(50,null,null,'knowledge','failed',${organization}) as value`,
    );
    expect(
      jobsPageSchema.parse(page?.value).items.find((item) => item.id === old.id)?.retry_available,
    ).toBe(false);
  });

  it('prunes old operator evidence in bounded batches without resetting eligible retry limits', async () => {
    const failed = await failedKnowledge();
    const missing = randomUUID();
    const rollback = new Error('ROLLBACK_RETENTION_FIXTURE');
    await expect(
      sql.begin(async (tx) => {
        const [old] =
          await tx`insert into private.platform_operations_audit(actor_user_id,action,created_at) values(${actors.platform},'overview.read','1900-01-01T00:00:00Z') returning id`;
        await tx`insert into private.platform_job_retries(family,job_id,retry_job_id,actor_user_id,created_at) values('knowledge',${failed.id},${failed.id},${actors.platform},'1900-01-01T00:00:00Z'),('knowledge',${missing},${missing},${actors.platform},'1900-01-01T00:00:00Z')`;
        const [receipt] = await tx`select private.maintain_platform_operations(500) as value`;
        expect(Number(receipt?.value.audits_deleted)).toBeGreaterThanOrEqual(1);
        expect(
          await tx`select id from private.platform_operations_audit where id=${String(old?.id)}`,
        ).toHaveLength(0);
        expect(
          await tx`select job_id from private.platform_job_retries where job_id=${failed.id}`,
        ).toHaveLength(1);
        expect(
          await tx`select job_id from private.platform_job_retries where job_id=${missing}`,
        ).toHaveLength(0);
        // Restore any other old local metadata touched by the maintenance batch too.
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    await expect(
      asUser(actors.platform, (tx) => tx`select private.maintain_platform_operations(100)`),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('has matching keyset indexes for job history, activity and default score ordering', async () => {
    const rows =
      await sql`select indexname,indexdef from pg_catalog.pg_indexes where schemaname='public' and indexname in ('knowledge_jobs_history_idx','reddit_jobs_history_idx','draft_jobs_history_idx','notification_deliveries_history_idx','privacy_jobs_history_idx','audit_logs_activity_cursor_idx','opportunities_score_cursor_idx')`;
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      const definition = String(row.indexdef);
      expect(definition).toContain('id DESC');
      if (row.indexname === 'opportunities_score_cursor_idx')
        expect(definition).toContain('organization_id, brand_id, final_score DESC, id DESC');
      else expect(definition).toContain('created_at DESC');
    }
  });
});
