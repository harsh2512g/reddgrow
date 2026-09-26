import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { z } from 'zod';
import { MockRedditProvider, RedditProviderError, type RedditProvider } from '@threadsignal/reddit';
import { createAIProvider, type AIProvider } from '@threadsignal/ai';
import { demoBrand } from '@threadsignal/knowledge';
import { fixturePages } from '@threadsignal/crawler';
import {
  claimRedditJob,
  processRedditJob,
  scheduleRedditJobs,
  redditPayload,
} from '../../apps/worker/src/jobs/reddit';
import { processKnowledgeJob } from '../../apps/worker/src/jobs/knowledge';
import { LocalKnowledgeStorage } from '../../apps/worker/src/storage';
import { localDatabaseUrl, verifyDocker } from '../../scripts/service-utils.mjs';

describe('Phase 3 durable opportunity pipeline', () => {
  let sql: ReturnType<typeof postgres>;
  let organization: string;
  let brand: string;
  let subreddit: string;
  const user = randomUUID();
  const clock = new Date();
  const communityName = `p3${user.slice(0, 8)}`;
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
          await tx`select public.create_organization('Opportunity worker',${`worker-${user.slice(0, 8)}`},${`${user}@opportunity.example`}) as id`
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
    subreddit = String(
      (await sql`select subreddit_id from public.brand_subreddits where id=${association}`)[0]
        ?.subreddit_id,
    );
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
  it('ingests mock listings and produces high, medium, low and blocked opportunities automatically', async () => {
    expect((await processRedditJob(sql, await enqueue('sync'), provider, clock)).status).toBe(
      'completed',
    );
    await evaluations();
    const rows =
      await sql`select final_score,is_blocked,knowledge_citations from public.opportunities where brand_id=${brand}`;
    const scores = rows.filter((r) => !r.is_blocked).map((r) => Number(r.final_score));
    expect(scores.some((n) => n >= 90)).toBe(true);
    expect(scores.some((n) => n >= 60 && n < 80)).toBe(true);
    expect(scores.some((n) => n >= 40 && n < 60)).toBe(true);
    expect(rows.some((r) => r.is_blocked)).toBe(true);
    expect(
      rows.some((r) => Array.isArray(r.knowledge_citations) && r.knowledge_citations.length > 0),
    ).toBe(true);
  });
  it('replays listings/evaluations without duplicate posts, opportunities or usage', async () => {
    const before =
      await sql`select id from public.opportunities where brand_id=${brand} order by id`;
    const usage =
      await sql`select quantity from public.usage_counters where organization_id=${organization}`;
    await processRedditJob(sql, await enqueue('sync'), provider, clock);
    await evaluations();
    expect(
      await sql`select id from public.opportunities where brand_id=${brand} order by id`,
    ).toEqual(before);
    expect(
      await sql`select quantity from public.usage_counters where organization_id=${organization}`,
    ).toEqual(usage);
    expect(
      await sql`select provider_post_id from public.reddit_posts group by provider,provider_post_id having count(*)>1`,
    ).toHaveLength(0);
  });
  it('honors the billing grace period consistently when scheduling, ingesting and evaluating', async () => {
    const [subscription] =
      await sql`select status,grace_ends_at from public.subscriptions where organization_id=${organization}`;
    try {
      await sql`update public.subscriptions set status='past_due',grace_ends_at=now()+interval '3 days' where organization_id=${organization}`;
      expect((await processRedditJob(sql, await enqueue('sync'), provider, clock)).status).toBe(
        'completed',
      );
      expect((await processRedditJob(sql, await enqueue('rules'), provider, clock)).status).toBe(
        'completed',
      );
      const pending =
        await sql`select id from public.reddit_jobs where brand_id=${brand} and kind='evaluate' and status='queued'`;
      expect(pending.length).toBeGreaterThan(0);
      const evaluationResults = [];
      for (const row of pending) {
        evaluationResults.push(
          (await processRedditJob(sql, String(row.id), provider, clock)).status,
        );
      }
      // Fixture safety filters still apply while grace preserves eligible processing.
      expect(evaluationResults).toContain('completed');
      expect(
        evaluationResults.every((status) => ['completed', 'filtered', 'skipped'].includes(status)),
      ).toBe(true);
      await sql`update public.reddit_sync_checkpoints set next_sync_at=now()-interval '1 minute',last_rules_sync_at=now()-interval '2 days' where subreddit_id=${subreddit}`;
      await scheduleRedditJobs(sql);
      const scheduled =
        await sql`select id,kind from public.reddit_jobs where subreddit_id=${subreddit} and status='queued' and kind in ('sync','rules')`;
      expect(scheduled.some((row) => row.kind === 'sync')).toBe(true);
      expect(scheduled.some((row) => row.kind === 'rules')).toBe(true);
      for (const row of scheduled) {
        expect((await processRedditJob(sql, String(row.id), provider, clock)).status).toBe(
          'completed',
        );
      }
      await evaluations();
    } finally {
      await sql`update public.subscriptions set status=${String(subscription?.status)},grace_ends_at=${subscription?.grace_ends_at ?? null} where organization_id=${organization}`;
    }
  });
  it('stops new provider work and evaluation after billing grace expires', async () => {
    const [subscription] =
      await sql`select status,grace_ends_at from public.subscriptions where organization_id=${organization}`;
    let providerCalls = 0;
    const guardedProvider: RedditProvider = {
      ...provider,
      listPosts: async (input) => {
        providerCalls++;
        return provider.listPosts(input);
      },
      getSubredditRules: async (name) => {
        providerCalls++;
        return provider.getSubredditRules(name);
      },
    };
    try {
      await sql`update public.subscriptions set status='past_due',grace_ends_at=now()-interval '1 second' where organization_id=${organization}`;
      expect(
        (await processRedditJob(sql, await enqueue('sync'), guardedProvider, clock)).status,
      ).toBe('skipped');
      expect(
        (await processRedditJob(sql, await enqueue('rules'), guardedProvider, clock)).status,
      ).toBe('skipped');
      const [opportunity] =
        await sql`select reddit_post_id from public.opportunities where brand_id=${brand} and not is_blocked limit 1`;
      const postId = z.uuid().parse(opportunity?.reddit_post_id);
      expect(
        (await processRedditJob(sql, await enqueue('evaluate', postId), guardedProvider, clock))
          .status,
      ).toBe('skipped');
      expect(providerCalls).toBe(0);
      await sql`update public.reddit_sync_checkpoints set next_sync_at=now()-interval '1 minute',last_rules_sync_at=now()-interval '2 days' where subreddit_id=${subreddit}`;
      await scheduleRedditJobs(sql);
      expect(
        await sql`select id from public.reddit_jobs where subreddit_id=${subreddit} and status='queued' and kind in ('sync','rules')`,
      ).toHaveLength(0);
    } finally {
      await sql`update public.subscriptions set status=${String(subscription?.status)},grace_ends_at=${subscription?.grace_ends_at ?? null} where organization_id=${organization}`;
    }
  });
  it.each(['mock', 'oauth'] as const)(
    'reconciles only synthetic fixture freshness when the provider is %s',
    async (mode) => {
      const communityId = randomUUID();
      const fixtureName = `p3time${randomUUID().replaceAll('-', '').slice(0, 10)}`;
      const existingPostId = randomUUID();
      const providerPostId = `clock_${randomUUID().replaceAll('-', '')}`;
      const original = await base.getPostById('fixture_001');
      expect(original).not.toBeNull();
      const freshPost = {
        ...original!,
        id: providerPostId,
        subreddit: fixtureName,
        permalink: `https://www.reddit.com/r/${fixtureName}/comments/${providerPostId}`,
      };
      const oldDate = new Date(clock.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const fixtureProvider: RedditProvider = {
        ...provider,
        mode,
        getSubreddit: async () => ({ ...(await base.getSubreddit('SaaS')), name: fixtureName }),
        listPosts: async () => ({ posts: [freshPost], after: null }),
      };
      await sql`insert into public.subreddits(id,provider,name,display_name) values(${communityId},${mode},${fixtureName},${fixtureName})`;
      await sql`insert into public.brand_subreddits(organization_id,brand_id,subreddit_id) values(${organization},${brand},${communityId})`;
      await sql`insert into public.reddit_posts(id,provider,provider_post_id,subreddit_id,title,body,created_at_provider)
      values(${existingPostId},${mode},${providerPostId},${communityId},${freshPost.title},${freshPost.body},${oldDate})`;
      try {
        const [job] = await sql`select private.queue_reddit_job('sync',${communityId}) as id`;
        expect((await processRedditJob(sql, String(job?.id), fixtureProvider, clock)).status).toBe(
          'completed',
        );
        const [stored] =
          await sql`select created_at_provider from public.reddit_posts where id=${existingPostId}`;
        expect(z.coerce.date().parse(stored?.created_at_provider).toISOString()).toBe(
          mode === 'mock' ? freshPost.createdAt : oldDate,
        );
        // A delayed older fixture listing must not move the current synthetic timeline backward.
        const olderProvider: RedditProvider = {
          ...fixtureProvider,
          listPosts: async () => ({ posts: [{ ...freshPost, createdAt: oldDate }], after: null }),
        };
        const [olderJob] = await sql`select private.queue_reddit_job('sync',${communityId}) as id`;
        expect(
          (await processRedditJob(sql, String(olderJob?.id), olderProvider, clock)).status,
        ).toBe('completed');
        const [afterReplay] =
          await sql`select created_at_provider from public.reddit_posts where id=${existingPostId}`;
        expect(z.coerce.date().parse(afterReplay?.created_at_provider).toISOString()).toBe(
          mode === 'mock' ? freshPost.createdAt : oldDate,
        );
      } finally {
        await sql`delete from public.subreddits where id=${communityId}`;
      }
    },
  );

  it('claims once under duplicate delivery and recovers an expired lease', async () => {
    const id = await enqueue('sync');
    const claims = await Promise.all([claimRedditJob(sql, id), claimRedditJob(sql, id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await processRedditJob(sql, id, provider, clock)).toEqual({ status: 'skipped' });
    await sql`update public.reddit_jobs set lease_expires_at=now()-interval '1 second' where id=${id}`;
    expect((await processRedditJob(sql, id, provider, clock)).status).toBe('completed');
  });
  it('records bounded failures and releases abandoned exhausted jobs', async () => {
    const id = await enqueue('sync');
    const broken: RedditProvider = {
      mode: 'mock',
      searchSubreddits: () => Promise.resolve([]),
      getSubreddit: () => Promise.reject(new Error('Untrusted provider message')),
      getSubredditRules: () => Promise.resolve([]),
      listPosts: () => Promise.resolve({ posts: [], after: null }),
      getPostById: () => Promise.resolve(null),
    };
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect((await processRedditJob(sql, id, broken, clock)).status).toBe('retry_or_failed');
      await sql`update public.reddit_jobs set available_at=now()-interval '1 second' where id=${id}`;
    }
    expect(
      (await sql`select status,attempts,error_code from public.reddit_jobs where id=${id}`)[0],
    ).toMatchObject({ status: 'failed', attempts: 3, error_code: 'PROVIDER_OR_EVALUATION_FAILED' });
    const exhausted = await enqueue('sync');
    await claimRedditJob(sql, exhausted);
    await sql`update public.reddit_jobs set attempts=3,lease_expires_at=now()-interval '1 second' where id=${exhausted}`;
    expect(await claimRedditJob(sql, exhausted)).toBeNull();
    expect(
      (await sql`select status,error_code from public.reddit_jobs where id=${exhausted}`)[0],
    ).toMatchObject({ status: 'failed', error_code: 'LEASE_EXPIRED' });
  });
  it('purges deleted provider content and prevents stale listings from resurrecting it', async () => {
    const [row] =
      await sql`select reddit_post_id from public.opportunities where brand_id=${brand} and not is_blocked order by final_score desc limit 1`;
    const postId = z.uuid().parse(row?.reddit_post_id);
    const deleted = new MockRedditProvider({ now: () => clock });
    deleted.getPostById = async () => null;
    expect(
      (await processRedditJob(sql, await enqueue('refresh', postId), deleted, clock)).status,
    ).toBe('completed');
    expect(
      (
        await sql`select title,body,author_name,permalink,raw_metadata,is_deleted from public.reddit_posts where id=${postId}`
      )[0],
    ).toMatchObject({
      title: null,
      body: null,
      author_name: null,
      permalink: null,
      raw_metadata: {},
      is_deleted: true,
    });
    expect(
      (
        await sql`select summary,user_need,knowledge_citations,model_metadata,status from public.opportunities where brand_id=${brand} and reddit_post_id=${postId}`
      )[0],
    ).toMatchObject({
      summary: '',
      user_need: '',
      knowledge_citations: [],
      model_metadata: {},
      status: 'archived',
    });
    await processRedditJob(sql, await enqueue('sync'), provider, clock);
    expect(
      (await sql`select title,is_deleted from public.reddit_posts where id=${postId}`)[0],
    ).toMatchObject({ title: null, is_deleted: true });
  });
  it('schedules idempotent work and purges content after the refresh safety deadline', async () => {
    // A unique synthetic provider record avoids modifying any other test or demo post.
    const postId = randomUUID();
    await sql`insert into public.reddit_posts(id,provider,provider_post_id,subreddit_id,title,body,created_at_provider,last_synced_at) values(${postId},'mock',${`test_${postId.replaceAll('-', '')}`},${subreddit},'Expired synthetic post','Fixture content must be removed.',now()-interval '3 days',now()-interval '49 hours')`;
    try {
      await scheduleRedditJobs(sql);
      await scheduleRedditJobs(sql);
      expect(
        (await sql`select is_deleted,title from public.reddit_posts where id=${postId}`)[0],
      ).toMatchObject({ is_deleted: true, title: null });
      expect(
        await sql`select dedupe_key from public.reddit_jobs where status in ('queued','processing') group by dedupe_key having count(*)>1`,
      ).toHaveLength(0);
    } finally {
      await sql`delete from public.reddit_posts where id=${postId}`;
    }
  });
  it('rejects queue payloads containing content or credentials', () => {
    expect(
      redditPayload.safeParse({ jobId: randomUUID(), body: 'must not enter Redis' }).success,
    ).toBe(false);
  });

  it('makes no provider calls for paused monitoring or expired subscriptions', async () => {
    let requests = 0;
    const guarded: RedditProvider = {
      ...provider,
      getSubreddit: async (name) => {
        requests++;
        return provider.getSubreddit(name);
      },
    };
    const [subscription] =
      await sql`select current_period_start::text,current_period_end::text from public.subscriptions where organization_id=${organization}`;
    try {
      await sql`update public.brand_subreddits set status='paused' where brand_id=${brand}`;
      expect((await processRedditJob(sql, await enqueue('sync'), guarded, clock)).status).toBe(
        'skipped',
      );
      await sql`update public.brand_subreddits set status='active' where brand_id=${brand}`;
      await sql`update public.subscriptions set current_period_start=now()-interval '8 days',current_period_end=now()-interval '1 day' where organization_id=${organization}`;
      expect((await processRedditJob(sql, await enqueue('sync'), guarded, clock)).status).toBe(
        'skipped',
      );
      expect(requests).toBe(0);
    } finally {
      await sql`update public.brand_subreddits set status='active' where brand_id=${brand}`;
      await sql`update public.subscriptions set current_period_start=${subscription?.current_period_start},current_period_end=${subscription?.current_period_end} where organization_id=${organization}`;
    }
  });

  it('rechecks monitoring between provider requests and before publishing fetched content', async () => {
    let listRequests = 0;
    const pausedDuringMetadata: RedditProvider = {
      ...provider,
      getSubreddit: async (name) => {
        const details = await provider.getSubreddit(name);
        await sql`update public.brand_subreddits set status='paused' where brand_id=${brand}`;
        return details;
      },
      listPosts: async (input) => {
        listRequests++;
        return provider.listPosts(input);
      },
    };
    try {
      expect(
        (await processRedditJob(sql, await enqueue('sync'), pausedDuringMetadata, clock)).status,
      ).toBe('skipped');
      expect(listRequests).toBe(0);
      await sql`update public.brand_subreddits set status='active' where brand_id=${brand}`;
      const before =
        await sql`select id,last_synced_at from public.reddit_posts where subreddit_id=${subreddit} order by id`;
      const pausedDuringListing: RedditProvider = {
        ...provider,
        listPosts: async (input) => {
          const page = await provider.listPosts(input);
          await sql`update public.brand_subreddits set status='paused' where brand_id=${brand}`;
          return page;
        },
      };
      expect(
        (await processRedditJob(sql, await enqueue('sync'), pausedDuringListing, clock)).status,
      ).toBe('skipped');
      expect(
        await sql`select id,last_synced_at from public.reddit_posts where subreddit_id=${subreddit} order by id`,
      ).toEqual(before);
    } finally {
      await sql`update public.brand_subreddits set status='active' where brand_id=${brand}`;
    }
  });

  it('honors provider retry timestamps in durable job and checkpoint state', async () => {
    const id = await enqueue('sync');
    const retryAt = new Date(Date.now() + 3_600_000).toISOString();
    const limited: RedditProvider = {
      ...provider,
      getSubreddit: async () => {
        throw new RedditProviderError('RATE_LIMITED', retryAt);
      },
    };
    try {
      expect(await processRedditJob(sql, id, limited, clock)).toEqual({
        status: 'retry_or_failed',
        code: 'RATE_LIMITED',
      });
      const [job] =
        await sql`select status,error_code,available_at>=${retryAt}::timestamptz as deferred from public.reddit_jobs where id=${id}`;
      expect(job).toMatchObject({ status: 'queued', error_code: 'RATE_LIMITED', deferred: true });
      const [checkpoint] =
        await sql`select next_sync_at>=${retryAt}::timestamptz as deferred,provider_retry_at>=${retryAt}::timestamptz as persisted,error_code from public.reddit_sync_checkpoints where subreddit_id=${subreddit} and sort='new'`;
      expect(checkpoint).toMatchObject({
        deferred: true,
        persisted: true,
        error_code: 'RATE_LIMITED',
      });
      expect(await processRedditJob(sql, id, provider, clock)).toEqual({ status: 'skipped' });
      await sql`update public.reddit_jobs set status='completed' where id=${id}`;
      let requests = 0;
      const freshProvider: RedditProvider = {
        ...provider,
        getSubreddit: async (name) => {
          requests++;
          return provider.getSubreddit(name);
        },
      };
      const freshJob = await enqueue('sync');
      expect(await processRedditJob(sql, freshJob, freshProvider, clock)).toEqual({
        status: 'retry_or_failed',
        code: 'RATE_LIMITED',
      });
      expect(requests).toBe(0);
      await sql`update public.reddit_jobs set status='completed' where id=${freshJob}`;
    } finally {
      await sql`update public.reddit_sync_checkpoints set provider_retry_at=null,error_code=null where subreddit_id=${subreddit}`;
    }
  });

  it('persists authorization circuit breaks and stops further provider calls', async () => {
    const id = await enqueue('sync');
    const paused: RedditProvider = {
      ...provider,
      getSubreddit: async () => {
        throw new RedditProviderError('PROVIDER_PAUSED');
      },
    };
    try {
      expect(await processRedditJob(sql, id, paused, clock)).toEqual({
        status: 'retry_or_failed',
        code: 'PROVIDER_PAUSED',
      });
      expect(
        (
          await sql`select provider_paused from public.reddit_sync_checkpoints where subreddit_id=${subreddit} and sort='new'`
        )[0]?.provider_paused,
      ).toBe(true);
      let requests = 0;
      const guarded: RedditProvider = {
        ...provider,
        getSubreddit: async (name) => {
          requests++;
          return provider.getSubreddit(name);
        },
      };
      const next = await enqueue('sync');
      expect(await processRedditJob(sql, next, guarded, clock)).toEqual({
        status: 'retry_or_failed',
        code: 'PROVIDER_PAUSED',
      });
      expect(requests).toBe(0);
    } finally {
      await sql`update public.reddit_sync_checkpoints set provider_paused=false,consecutive_errors=0,error_code=null where subreddit_id=${subreddit}`;
    }
  });

  it('rejects mismatched provider post identity on refresh without importing the foreign response', async () => {
    const [stored] =
      await sql`select id,provider_post_id,title from public.reddit_posts where subreddit_id=${subreddit} and not is_deleted and permalink is not null limit 1`;
    const malicious: RedditProvider = {
      ...provider,
      getPostById: async (id) => {
        const post = await provider.getPostById(id);
        return post
          ? { ...post, id: `${communityName}_forged_response`, subreddit: 'unapproved' }
          : null;
      },
    };
    expect(
      await processRedditJob(sql, await enqueue('refresh', String(stored?.id)), malicious, clock),
    ).toEqual({ status: 'retry_or_failed', code: 'PROVIDER_SCOPE_MISMATCH' });
    expect(
      await sql`select id from public.reddit_posts where provider_post_id=${`${communityName}_forged_response`}`,
    ).toHaveLength(0);
    expect(
      (await sql`select title from public.reddit_posts where id=${stored?.id}`)[0]?.title,
    ).toBe(stored?.title);
  });

  it('rejects an expired listing lease without advancing its cursor or publishing content', async () => {
    const id = await enqueue('sync');
    const before =
      await sql`select id,last_synced_at from public.reddit_posts where subreddit_id=${subreddit} order by id`;
    const [checkpoint] =
      await sql`select cursor from public.reddit_sync_checkpoints where subreddit_id=${subreddit} and sort='new'`;
    const expired: RedditProvider = {
      ...provider,
      listPosts: async (input) => {
        const page = await provider.listPosts(input);
        await sql`update public.reddit_jobs set lease_token=${randomUUID()} where id=${id}`;
        return { ...page, after: 'next-page-checkpoint' };
      },
    };
    expect((await processRedditJob(sql, id, expired, clock)).status).toBe('stale');
    expect(
      await sql`select id,last_synced_at from public.reddit_posts where subreddit_id=${subreddit} order by id`,
    ).toEqual(before);
    expect(
      (
        await sql`select cursor from public.reddit_sync_checkpoints where subreddit_id=${subreddit} and sort='new'`
      )[0]?.cursor,
    ).toBe(checkpoint?.cursor);
    await sql`update public.reddit_jobs set status='completed',lease_token=null,lease_expires_at=null where id=${id}`;
  });

  it('requeues evaluations when brand inputs change during AI evaluation', async () => {
    const [opportunity] =
      await sql`select reddit_post_id,input_checksum from public.opportunities where brand_id=${brand} and not is_blocked and status<>'archived' order by final_score desc limit 1`;
    const [original] = await sql`select profile from public.brands where id=${brand}`;
    const baseAI = createAIProvider();
    const changing: AIProvider = {
      mode: 'mock',
      embed: (input) => baseAI.embed(input),
      generateStructured: async (input) => {
        await sql`update public.brands set profile=jsonb_set(profile,'{description}','"Updated verified description for the batch image optimization API."') where id=${brand}`;
        return baseAI.generateStructured(input);
      },
    };
    const id = await enqueue('evaluate', String(opportunity?.reddit_post_id));
    try {
      expect((await processRedditJob(sql, id, provider, clock, undefined, changing)).status).toBe(
        'stale-input',
      );
      expect(
        (await sql`select status,error_code from public.reddit_jobs where id=${id}`)[0],
      ).toMatchObject({ status: 'completed', error_code: 'INPUT_CHANGED' });
      expect(
        (
          await sql`select input_checksum from public.opportunities where brand_id=${brand} and reddit_post_id=${opportunity?.reddit_post_id}`
        )[0]?.input_checksum,
      ).toBe(opportunity?.input_checksum);
      const [replacement] =
        await sql`select id from public.reddit_jobs where brand_id=${brand} and reddit_post_id=${opportunity?.reddit_post_id} and kind='evaluate' and status='queued'`;
      expect(replacement?.id).not.toBe(id);
      ownedJobs.add(z.uuid().parse(replacement?.id));
      expect((await processRedditJob(sql, String(replacement?.id), provider, clock)).status).toBe(
        'completed',
      );
    } finally {
      await sql`update public.brands set profile=${sql.json(original?.profile)} where id=${brand}`;
    }
  });

  it('applies recent same-brand human dismissal feedback without reading other tenants', async () => {
    const [target] =
      await sql`select id,reddit_post_id from public.opportunities where brand_id=${brand} and not is_blocked and status not in ('archived','dismissed') order by final_score desc limit 1`;
    expect(
      (
        await processRedditJob(
          sql,
          await enqueue('evaluate', String(target?.reddit_post_id)),
          provider,
          clock,
        )
      ).status,
    ).toBe('completed');
    const [baseline] =
      await sql`select intent_category,final_score,penalty_score from public.opportunities where id=${target?.id}`;
    const prior =
      await sql`select o.id,o.status,o.dismissed_reason,o.intent_category from public.opportunities o join public.reddit_posts p on p.id=o.reddit_post_id where o.brand_id=${brand} and o.id<>${target?.id} and not o.is_blocked and not p.is_deleted order by o.id limit 3`;
    expect(prior).toHaveLength(3);
    try {
      for (const row of prior) {
        await sql`update public.opportunities set intent_category=${baseline?.intent_category} where id=${row.id}`;
        await asOwner(
          (tx) => tx`select public.set_opportunity_status(${row.id},'dismissed','not_relevant')`,
        );
      }
      expect(
        (
          await processRedditJob(
            sql,
            await enqueue('evaluate', String(target?.reddit_post_id)),
            provider,
            clock,
          )
        ).status,
      ).toBe('completed');
      const [adjusted] =
        await sql`select final_score,penalty_score,risk_reasons from public.opportunities where id=${target?.id}`;
      expect(Number(adjusted?.penalty_score)).toBe(Number(baseline?.penalty_score) + 9);
      expect(Number(adjusted?.final_score)).toBeLessThan(Number(baseline?.final_score));
      expect(adjusted?.risk_reasons).toEqual(
        expect.arrayContaining([expect.stringContaining('3 prior human dismissals')]),
      );
    } finally {
      for (const row of prior)
        await sql`update public.opportunities set status=${row.status},dismissed_reason=${row.dismissed_reason},intent_category=${row.intent_category} where id=${row.id}`;
    }
  });

  it('archives opportunities beyond eligibility age while preserving content inside retention', async () => {
    const [opportunity] =
      await sql`select o.id,p.id as post_id,p.title from public.opportunities o join public.reddit_posts p on p.id=o.reddit_post_id where o.brand_id=${brand} and not o.is_blocked and o.status not in ('archived','dismissed') and not p.is_deleted limit 1`;
    expect(opportunity).toBeDefined();
    await sql`update public.reddit_posts set created_at_provider=now()-interval '8 days',last_synced_at=now() where id=${opportunity?.post_id}`;
    await scheduleRedditJobs(sql, { maxAgeDays: 7, retentionDays: 30 });
    expect(
      (await sql`select status from public.opportunities where id=${opportunity?.id}`)[0]?.status,
    ).toBe('archived');
    expect(
      (
        await sql`select title,is_deleted from public.reddit_posts where id=${opportunity?.post_id}`
      )[0],
    ).toEqual({ title: opportunity?.title, is_deleted: false });
    await asOwner(
      (tx) =>
        tx`select public.set_opportunity_status(${opportunity?.id},'dismissed','not_relevant')`,
    );
    expect(
      (
        await processRedditJob(
          sql,
          await enqueue('evaluate', String(opportunity?.post_id)),
          provider,
          clock,
          { maxAgeDays: 7, retentionDays: 30 },
        )
      ).status,
    ).toBe('filtered');
    expect(
      (await sql`select status from public.opportunities where id=${opportunity?.id}`)[0]?.status,
    ).toBe('dismissed');
  });
});
