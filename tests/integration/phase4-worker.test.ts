import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { z } from 'zod';
import { MockRedditProvider, type RedditProvider } from '@threadsignal/reddit';
import { createAIProvider, type AIProvider } from '@threadsignal/ai';
import { demoBrand } from '@threadsignal/knowledge';
import { fixturePages } from '@threadsignal/crawler';
import { processRedditJob } from '../../apps/worker/src/jobs/reddit';
import { claimDraftJob, processDraftJob, draftPayload } from '../../apps/worker/src/jobs/drafts';
import { processKnowledgeJob } from '../../apps/worker/src/jobs/knowledge';
import { LocalKnowledgeStorage } from '../../apps/worker/src/storage';
import { localDatabaseUrl, verifyDocker } from '../../scripts/service-utils.mjs';

describe('Phase 4 durable drafting pipeline', () => {
  let sql: ReturnType<typeof postgres>;
  let organization: string;
  let brand: string;
  let subreddit: string;
  const user = randomUUID();
  const clock = new Date();
  const communityName = `p4${user.slice(0, 8)}`;
  const base = new MockRedditProvider({ now: () => clock });
  const remap = (post: Awaited<ReturnType<RedditProvider['getPostById']>>) =>
    post
      ? {
          ...post,
          id: `${communityName}_${post.id}`,
          subreddit: communityName,
          permalink: `https://www.reddit.com/r/${communityName}/comments/${communityName}_${post.id}`,
        }
      : null;
  const provider: RedditProvider = {
    mode: 'mock',
    searchSubreddits: async () => [],
    getSubreddit: async () => ({ ...(await base.getSubreddit('SaaS')), name: communityName }),
    getSubredditRules: () => base.getSubredditRules('SaaS'),
    listPosts: async (input) => {
      const result = await base.listPosts({ ...input, subreddit: 'SaaS' });
      return { ...result, posts: result.posts.map((post) => remap(post)!) };
    },
    getPostById: async (id) => remap(await base.getPostById(id.slice(communityName.length + 1))),
  };
  const ownedJobs = new Set<string>();
  const asOwner = async <T>(run: (tx: postgres.TransactionSql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${user},true)`;
      await tx`set local role authenticated`;
      return run(tx);
    });
  async function enqueue(
    kind: 'sync' | 'refresh' | 'evaluate' | 'rules',
    postId: string | null = null,
  ) {
    const [row] =
      await sql`select private.queue_reddit_job(${kind},${kind === 'sync' || kind === 'rules' ? subreddit : null}::uuid,'new',${kind === 'evaluate' ? brand : null}::uuid,${postId}::uuid) as id`;
    const id = z.uuid().parse(row?.id);
    ownedJobs.add(id);
    return id;
  }
  async function evaluations() {
    const rows =
      await sql`select id from public.reddit_jobs where brand_id=${brand} and status='queued' order by created_at,id`;
    for (const row of rows) {
      const id = z.uuid().parse(row.id);
      ownedJobs.add(id);
      const result = await processRedditJob(sql, id, provider, clock);
      expect(['completed', 'filtered', 'skipped']).toContain(result.status);
    }
  }
  beforeAll(async () => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 5, connect_timeout: 5, onnotice: () => {} });
    await sql`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(${user},${`${user}@opportunity.example`},now(),'{}')`;
    organization = await asOwner(async (tx) =>
      String(
        (
          await tx`select public.create_organization('Draft worker',${`worker-${user.slice(0, 8)}`},${`${user}@opportunity.example`}) as id`
        )[0]?.id,
      ),
    );
    brand = await asOwner(async (tx) =>
      String(
        (
          await tx`select public.save_brand(${organization}::uuid,null,${tx.json(demoBrand)}::jsonb) as id`
        )[0]?.id,
      ),
    );
    // Verified brand knowledge is ingested by the real Phase 2 pipeline before evaluation.
    const source = randomUUID(),
      knowledgeJob = randomUUID();
    await sql`insert into public.knowledge_sources(id,organization_id,brand_id,name,type,selected_pages) values(${source},${organization},${brand},'Opportunity evidence','website',${fixturePages.map((p) => p.url)})`;
    await sql`insert into public.knowledge_jobs(id,organization_id,brand_id,source_id,generation,kind) values(${knowledgeJob},${organization},${brand},${source},1,'ingest')`;
    expect(
      await processKnowledgeJob(sql, knowledgeJob, new LocalKnowledgeStorage(undefined)),
    ).toEqual({ status: 'completed' });
    const association = await asOwner(async (tx) =>
      String(
        (
          await tx`select public.add_brand_subreddit(${brand}::uuid,${communityName},'{"minimum_score":0}'::jsonb) as id`
        )[0]?.id,
      ),
    );
    await sql`update public.subscriptions set plan_key='growth',status='active' where organization_id=${organization}`;
    subreddit = String(
      (await sql`select subreddit_id from public.brand_subreddits where id=${association}`)[0]
        ?.subreddit_id,
    );
  });
  beforeAll(async () => {
    expect((await processRedditJob(sql, await enqueue('sync'), provider, clock)).status).toBe(
      'completed',
    );
    await evaluations();
  });
  afterAll(async () => {
    if (sql) {
      if (organization) await sql`delete from public.organizations where id=${organization}`;
      if (subreddit)
        await sql`delete from public.subreddits where id=${subreddit} and name=${communityName}`;
      if (ownedJobs.size)
        await sql`delete from public.reddit_jobs where id=any(${[...ownedJobs]}::uuid[])`;
      await sql`delete from auth.users where id=${user}`;
      await sql.end({ timeout: 3 });
    }
  });
  async function request() {
    const [opportunity] =
      await sql`select id from public.opportunities where brand_id=${brand} and not is_blocked and status not in ('dismissed','archived') order by final_score desc limit 1`;
    return asOwner(async (tx) =>
      String(
        (await tx`select public.request_draft(${opportunity?.id},${randomUUID()},'{}') as id`)[0]
          ?.id,
      ),
    );
  }
  async function pending(draft: string) {
    return sql`select id,kind from public.draft_jobs where draft_id=${draft} and status='queued' order by created_at,id`;
  }
  async function drain(draft: string) {
    for (let i = 0; i < 5; i++) {
      const jobs = await pending(draft);
      if (!jobs.length) return;
      for (const job of jobs)
        expect(await processDraftJob(sql, String(job.id))).toEqual({ status: 'completed' });
    }
    throw new Error('Draft pipeline did not settle.');
  }
  async function get(draft: string) {
    return (await sql`select * from public.drafts where id=${draft}`)[0]!;
  }
  it('runs generation, independent verification and all twelve compliance checks', async () => {
    const draft = await request();
    await drain(draft);
    const row = await get(draft);
    expect(['ready', 'warning']).toContain(row.status);
    expect(row.current_content).toContain(demoBrand.disclosure_text);
    expect(row.current_version).toBe(1);
    expect(row.verified_version).toBe(1);
    expect(
      await sql`select id from public.draft_claims where draft_id=${draft} and status='verified'`,
    ).not.toHaveLength(0);
    const [check] =
      await sql`select checks,safe_to_approve from public.draft_compliance_checks where draft_id=${draft}`;
    expect(check?.checks).toHaveLength(12);
    expect(check?.safe_to_approve).toBe(true);
    const receipts =
      await sql`select task,input_tokens,output_tokens,estimated_cost_usd from public.ai_task_usage where draft_id=${draft}`;
    expect(receipts).toHaveLength(3);
    expect(
      receipts.every(
        (r) => r.input_tokens === 0 && r.output_tokens === 0 && Number(r.estimated_cost_usd) === 0,
      ),
    ).toBe(true);
  });
  it('blocks unsupported human edits and restores a reviewed version before approval and copy', async () => {
    const draft = await request();
    await drain(draft);
    const initial = await get(draft);
    await asOwner(
      (tx) =>
        tx`select public.save_draft_edit(${draft},1,${initial.current_content + ' ClarityScale AI guarantees quantum teleportation for every image.'})`,
    );
    await drain(draft);
    expect((await get(draft)).status).toBe('blocked');
    await expect(
      asOwner((tx) => tx`select public.approve_draft(${draft},2,true,true)`),
    ).rejects.toThrow('DRAFT_APPROVAL_BLOCKED');
    await asOwner((tx) => tx`select public.restore_draft_version(${draft},2,1)`);
    await drain(draft);
    await asOwner((tx) => tx`select public.approve_draft(${draft},3,true,true)`);
    expect((await get(draft)).status).toBe('approved');
    await asOwner((tx) => tx`select public.record_draft_copy(${draft},3)`);
    expect(
      await sql`select id from public.audit_logs where target_id=${draft} and action='draft.copied'`,
    ).toHaveLength(1);
    await expect(
      asOwner((tx) => tx`select public.save_draft_edit(${draft},1,'A stale browser edit.')`),
    ).rejects.toThrow('DRAFT_VERSION_CONFLICT');
  });
  it('regenerates without product recommendations, preserving truthful affiliation', async () => {
    const draft = await request();
    await drain(draft);
    await asOwner(
      (tx) =>
        tx`select public.regenerate_draft(${draft},1,${randomUUID()},'{"action":"no_brand","length":"concise"}')`,
    );
    await drain(draft);
    const row = await get(draft);
    expect(row.current_version).toBe(2);
    expect(row.current_content).toContain(demoBrand.disclosure_text);
    expect(['ready', 'warning']).toContain(row.status);
    const [claim] =
      await sql`select count(*)::int as n from public.draft_claims c join public.draft_versions v on v.id=c.draft_version_id where c.draft_id=${draft} and v.version=2 and c.status<>'general_advice'`;
    expect(claim?.n).toBe(0);
  });
  it('claims duplicate delivery once and recovers only an expired lease', async () => {
    const draft = await request(),
      id = String((await pending(draft))[0]?.id);
    const claims = await Promise.all([claimDraftJob(sql, id), claimDraftJob(sql, id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await processDraftJob(sql, id)).toEqual({ status: 'skipped' });
    await sql`update public.draft_jobs set lease_expires_at=now()-interval '1 second' where id=${id}`;
    expect(await processDraftJob(sql, id)).toEqual({ status: 'completed' });
    await drain(draft);
    expect(await sql`select id from public.draft_versions where draft_id=${draft}`).toHaveLength(1);
  });
  it('does not publish a generation after its context or lease changes', async () => {
    const draft = await request(),
      id = String((await pending(draft))[0]?.id),
      baseAI = createAIProvider();
    const [original] = await sql`select profile from public.brands where id=${brand}`;
    const changing: AIProvider = {
      mode: 'mock',
      generateStructured: (input) => baseAI.generateStructured(input),
      embed: async (input) => {
        await sql`update public.brands set profile=jsonb_set(profile,'{description}','"Changed description while generation was in progress."') where id=${brand}`;
        return baseAI.embed(input);
      },
    };
    try {
      expect(await processDraftJob(sql, id, changing)).toEqual({ status: 'stale' });
      expect((await get(draft)).current_version).toBe(0);
      expect((await sql`select status from public.draft_jobs where id=${id}`)[0]?.status).toBe(
        'queued',
      );
    } finally {
      await sql`update public.brands set profile=${sql.json(original?.profile)} where id=${brand}`;
    }
    await sql`update public.draft_jobs set available_at=now()-interval '1 second' where id=${id}`;
    const stolen: AIProvider = {
      ...changing,
      embed: async (input) => {
        await sql`update public.draft_jobs set lease_token=${randomUUID()} where id=${id}`;
        return baseAI.embed(input);
      },
    };
    expect(await processDraftJob(sql, id, stolen)).toEqual({ status: 'stale' });
    expect((await get(draft)).current_version).toBe(0);
    await sql`update public.draft_jobs set lease_expires_at=now()-interval '1 second' where id=${id}`;
    expect(await processDraftJob(sql, id)).toEqual({ status: 'completed' });
    await drain(draft);
  });
  it('bounds provider failures, redacts errors and marks exhausted leases visibly failed', async () => {
    const draft = await request(),
      id = String((await pending(draft))[0]?.id),
      baseAI = createAIProvider();
    const broken: AIProvider = {
      mode: 'mock',
      generateStructured: (input) => baseAI.generateStructured(input),
      embed: async () => {
        throw new Error('Untrusted provider response must not be stored.');
      },
    };
    for (let i = 0; i < 3; i++) {
      expect(await processDraftJob(sql, id, broken)).toEqual({
        status: 'retry_or_failed',
        code: 'DRAFT_PROCESSING_FAILED',
      });
      await sql`update public.draft_jobs set available_at=now()-interval '1 second' where id=${id}`;
    }
    expect(
      (await sql`select status,attempts,error_code from public.draft_jobs where id=${id}`)[0],
    ).toMatchObject({ status: 'failed', attempts: 3, error_code: 'DRAFT_PROCESSING_FAILED' });
    expect((await get(draft)).status).toBe('error');
    const abandoned = await request(),
      abandonedJob = String((await pending(abandoned))[0]?.id);
    await claimDraftJob(sql, abandonedJob);
    await sql`update public.draft_jobs set attempts=3,lease_expires_at=now()-interval '1 second' where id=${abandonedJob}`;
    expect(await claimDraftJob(sql, abandonedJob)).toBeNull();
    expect((await get(abandoned)).error_code).toBe('LEASE_EXPIRED');
  });
  it('invalidates approval when an evidence document is excluded', async () => {
    const draft = await request();
    await drain(draft);
    const [document] =
      await sql`select doc.id from public.knowledge_documents doc where doc.brand_id=${brand} and doc.is_included order by id limit 1`;
    try {
      await sql`update public.knowledge_documents set is_included=false where id=${document?.id}`;
      await expect(
        asOwner((tx) => tx`select public.approve_draft(${draft},1,true,true)`),
      ).rejects.toThrow('DRAFT_CONTEXT_CHANGED');
    } finally {
      await sql`update public.knowledge_documents set is_included=true where id=${document?.id}`;
    }
  });
  it('reuses only tenant-scoped retrieval IDs across the three stages', async () => {
    const draft = await request(),
      base = createAIProvider();
    let embeddingCalls = 0;
    const ai: AIProvider = {
      mode: 'mock',
      generateStructured: (input) => base.generateStructured(input),
      embed: async (input) => {
        embeddingCalls++;
        return base.embed(input);
      },
    };
    for (let i = 0; i < 3; i++)
      for (const job of await pending(draft))
        expect(await processDraftJob(sql, String(job.id), ai)).toEqual({ status: 'completed' });
    expect(embeddingCalls).toBe(1);
    expect(['ready', 'warning']).toContain((await get(draft)).status);
  });
  it('checks no-vendor instructions at the end of a long post without truncating them', async () => {
    // Keep this synthetic suite's previous requests outside the one-minute rate window.
    await sql`update public.draft_jobs set created_at=now()-interval '2 minutes' where organization_id=${organization}`;
    const draft = await request();
    const [post] =
      await sql`select p.id,p.body from public.drafts d join public.opportunities o on o.id=d.opportunity_id join public.reddit_posts p on p.id=o.reddit_post_id where d.id=${draft}`;
    try {
      await sql`update public.reddit_posts set body=${String(post?.body) + ' ' + 'additional context '.repeat(800) + ' No vendor responses, please.'} where id=${post?.id}`;
      await drain(draft);
      expect((await get(draft)).status).toBe('blocked');
      const [check] =
        await sql`select checks from public.draft_compliance_checks where draft_id=${draft}`;
      expect(check?.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'NO_VENDORS_REQUEST', status: 'fail' }),
        ]),
      );
    } finally {
      await sql`update public.reddit_posts set body=${post?.body} where id=${post?.id}`;
    }
  });
  it('rejects queue payloads containing content or credentials', () => {
    expect(
      draftPayload.safeParse({ jobId: randomUUID(), draft: 'Do not put content in Redis.' })
        .success,
    ).toBe(false);
  });
});
