import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Queue, Worker } from 'bullmq';
import type { Sql, TransactionSql } from 'postgres';
import { createAIProvider, type AIProvider } from '@threadsignal/ai';
import {
  createRedditProvider,
  RedditProviderError,
  subredditSchema,
  postSchema,
  ruleSchema,
  type RedditProvider,
  type RedditPost,
  type SubredditRule,
} from '@threadsignal/reddit';
import { evaluateOpportunity } from '@threadsignal/opportunities/scoring';
import {
  dismissalReasonSchema,
  intentCategorySchema,
  keywordInputSchema,
} from '@threadsignal/opportunities';
import { createLogger, createObservability } from '@threadsignal/shared';
import { redditPolicySchema, type WorkerConfig } from '../config';

export const REDDIT_QUEUES = {
  ingestion: 'reddit-ingestion',
  evaluation: 'opportunity-evaluation',
} as const;
export const redditPayload = z.object({ jobId: z.uuid() }).strict();
const jobSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['sync', 'rules', 'refresh', 'evaluate', 'rescore']),
  organization_id: z.uuid().nullable(),
  brand_id: z.uuid().nullable(),
  subreddit_id: z.uuid().nullable(),
  reddit_post_id: z.uuid().nullable(),
  opportunity_id: z.uuid().nullable(),
  sort: z.enum(['new', 'hot', 'rising']),
  attempts: z.number().int(),
  lease_token: z.uuid(),
  dedupe_key: z.string(),
});
export type RedditJob = z.infer<typeof jobSchema>;
const timestamp = z
  .union([z.date(), z.string()])
  .transform((value) => new Date(value).toISOString());
const storedPost = z.object({
  id: z.uuid(),
  provider_post_id: z.string(),
  subreddit_id: z.uuid(),
  name: z.string(),
  permalink: z.string().nullable(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  author_name: z.string().nullable(),
  created_at_provider: timestamp,
  score: z.number(),
  num_comments: z.number(),
  upvote_ratio: z.coerce.number().nullable(),
  flair: z.string().nullable(),
  is_nsfw: z.boolean(),
  is_locked: z.boolean(),
  is_archived: z.boolean(),
  is_deleted: z.boolean(),
  is_edited: z.boolean(),
  raw_metadata: z.record(z.string(), z.unknown()),
});

export async function claimRedditJob(sql: Sql, id: string): Promise<RedditJob | null> {
  z.uuid().parse(id);
  return sql.begin(async (tx) => {
    await tx`update public.reddit_jobs set status='failed',error_code='LEASE_EXPIRED',lease_token=null,lease_expires_at=null where id=${id} and status='processing' and attempts>=3 and lease_expires_at<=now()`;
    const rows =
      await tx`update public.reddit_jobs set status='processing',attempts=attempts+1,lease_token=${randomUUID()},lease_expires_at=now()+interval '90 seconds',error_code=null
      where id=${id} and attempts<3 and ((status='queued' and available_at<=now()) or (status='processing' and lease_expires_at<=now())) returning *`;
    return rows[0] ? jobSchema.parse(rows[0]) : null;
  });
}
async function lockLease(tx: TransactionSql, job: RedditJob) {
  return (
    (
      await tx`select id from public.reddit_jobs where id=${job.id} and status='processing' and lease_token=${job.lease_token} and lease_expires_at>now() for update`
    ).length === 1
  );
}
async function complete(tx: TransactionSql, job: RedditJob, code: string | null = null) {
  await tx`update public.reddit_jobs set status='completed',lease_token=null,lease_expires_at=null,error_code=${code} where id=${job.id}`;
}
async function communityEligible(sql: Sql | TransactionSql, job: RedditJob) {
  const [row] = await sql`select exists(select 1 from public.brand_subreddits bs
    join public.brands b on b.id=bs.brand_id join public.organizations o on o.id=bs.organization_id
    join public.subscriptions s on s.organization_id=o.id
    where bs.subreddit_id=${job.subreddit_id} and bs.status='active' and b.status='active'
      and o.status='active' and o.deleted_at is null and s.status in ('trialing','active')
      and s.current_period_end>now()
      and (${job.kind}='rules' or case ${job.sort} when 'new' then bs.monitor_new when 'hot' then bs.monitor_hot else bs.monitor_rising end)) as eligible`;
  return row?.eligible === true;
}
async function providerPaused(sql: Sql | TransactionSql, mode: RedditProvider['mode']) {
  const [row] = await sql`select exists(select 1 from public.reddit_sync_checkpoints c
    join public.subreddits s on s.id=c.subreddit_id where c.provider_paused and s.provider=${mode}) as paused`;
  return row?.paused === true;
}
async function providerRetryAt(sql: Sql | TransactionSql, mode: RedditProvider['mode']) {
  const [row] = await sql`select max(c.provider_retry_at) as retry_at
    from public.reddit_sync_checkpoints c join public.subreddits s on s.id=c.subreddit_id
    where s.provider=${mode} and c.provider_retry_at>now()`;
  return row?.retry_at ? timestamp.parse(row.retry_at) : null;
}
async function skipIneligible(sql: Sql, job: RedditJob) {
  return sql.begin(async (tx) => {
    if (await lockLease(tx, job)) await complete(tx, job, 'NO_LONGER_ELIGIBLE');
    return 'skipped';
  });
}
async function enqueueEvaluations(tx: TransactionSql, postId: string, subredditId: string) {
  await tx`select private.queue_reddit_job('evaluate',null,'new',bs.brand_id,${postId}::uuid)
    from public.brand_subreddits bs join public.brands b on b.id=bs.brand_id
    join public.organizations o on o.id=b.organization_id join public.subscriptions s on s.organization_id=o.id
    where bs.subreddit_id=${subredditId} and bs.status='active' and b.status='active'
      and o.status='active' and o.deleted_at is null and s.status in ('trialing','active') and s.current_period_end>now()`;
}
/** Shared provider mutations serialize with tenant draft review and deletion publication. */
async function lockCommunityOrganizations(tx: TransactionSql, subredditId: string) {
  await tx`select organization.id from public.organizations organization where organization.id in (
    select monitoring.organization_id from public.brand_subreddits monitoring where monitoring.subreddit_id=${subredditId}
    union select opportunity.organization_id from public.opportunities opportunity where opportunity.subreddit_id=${subredditId}
  ) order by organization.id for update`;
}
async function storeRules(tx: TransactionSql, subredditId: string, rules: SubredditRule[]) {
  await tx`delete from public.subreddit_rules where subreddit_id=${subredditId}`;
  for (const rule of rules)
    await tx`insert into public.subreddit_rules(subreddit_id,provider_rule_id,title,description,kind,applies_to,raw_data) values(${subredditId},${rule.id},${rule.title},${rule.description},${rule.kind},${rule.appliesTo},${tx.json({ title: rule.title, description: rule.description })})`;
  await tx`insert into public.reddit_sync_checkpoints(subreddit_id,sort,last_rules_sync_at) values(${subredditId},'new',now()) on conflict(subreddit_id,sort) do update set last_rules_sync_at=now()`;
  await tx`update public.reddit_sync_checkpoints set last_rules_sync_at=now() where subreddit_id=${subredditId}`;
}

/** A permanent tombstone cannot be resurrected by an older listing or a delayed job. */
async function upsertPost(
  tx: TransactionSql,
  subredditId: string,
  provider: RedditProvider['mode'],
  post: RedditPost,
) {
  // Synthetic fixtures restart their relative timeline with each mock provider instance.
  // Reconcile only that demo clock; real publication times and deletion tombstones stay fixed.
  const rows =
    await tx`insert into public.reddit_posts(provider,provider_post_id,subreddit_id,permalink,title,body,author_name,created_at_provider,score,num_comments,upvote_ratio,flair,is_nsfw,is_locked,is_archived,is_edited)
    values(${provider},${post.id},${subredditId},${post.isDeleted ? null : post.permalink},${post.isDeleted ? null : post.title},${post.isDeleted ? null : post.body},${post.isDeleted ? null : post.authorName},${post.createdAt},${post.score},${post.commentCount},${post.upvoteRatio},${post.isDeleted ? null : post.flair},${post.isNsfw},${post.isLocked},${post.isArchived},${post.isEdited})
    on conflict(provider,provider_post_id) do update set permalink=excluded.permalink,title=excluded.title,body=excluded.body,author_name=excluded.author_name,score=excluded.score,num_comments=excluded.num_comments,upvote_ratio=excluded.upvote_ratio,flair=excluded.flair,is_nsfw=excluded.is_nsfw,is_locked=excluded.is_locked,is_archived=excluded.is_archived,is_edited=excluded.is_edited,created_at_provider=case when excluded.provider='mock' then greatest(reddit_posts.created_at_provider,excluded.created_at_provider) else reddit_posts.created_at_provider end,last_synced_at=now()
    where not reddit_posts.is_deleted and reddit_posts.subreddit_id=excluded.subreddit_id returning id`;
  const id = z.uuid().optional().parse(rows[0]?.id);
  if (!id) return;
  if (post.isDeleted) await tx`select private.purge_reddit_post(${id}::uuid)`;
  else await enqueueEvaluations(tx, id, subredditId);
}

async function syncCommunity(sql: Sql, job: RedditJob, provider: RedditProvider) {
  if (!(await communityEligible(sql, job))) return skipIneligible(sql, job);
  const [row] =
    await sql`select s.name,c.cursor from public.subreddits s left join public.reddit_sync_checkpoints c on c.subreddit_id=s.id and c.sort=${job.sort} where s.id=${job.subreddit_id}`;
  if (!row) throw new Error('COMMUNITY_UNAVAILABLE');
  const name = z.string().parse(row.name);
  const details = subredditSchema.parse(await provider.getSubreddit(name));
  if (details.name.toLowerCase() !== name) throw new Error('PROVIDER_SCOPE_MISMATCH');
  if (!(await communityEligible(sql, job))) return skipIneligible(sql, job);
  // Fetch current rules before publishing any evaluation work from this listing.
  const rules = z
    .array(ruleSchema)
    .max(100)
    .parse(await provider.getSubredditRules(name));
  if (!(await communityEligible(sql, job))) return skipIneligible(sql, job);
  const page = z
    .object({ posts: z.array(postSchema).max(100), after: z.string().max(200).nullable() })
    .parse(
      await provider.listPosts({
        subreddit: name,
        sort: job.sort,
        limit: 100,
        ...(row.cursor ? { after: z.string().parse(row.cursor) } : {}),
      }),
    );
  if (page.posts.some((post) => post.subreddit.toLowerCase() !== name))
    throw new Error('PROVIDER_SCOPE_MISMATCH');
  if (page.after && page.after === row.cursor) throw new Error('PROVIDER_CURSOR_STALLED');
  return sql.begin(async (tx) => {
    await lockCommunityOrganizations(tx, job.subreddit_id!);
    if (!(await lockLease(tx, job))) return 'stale';
    if (!(await communityEligible(tx, job))) {
      await complete(tx, job, 'NO_LONGER_ELIGIBLE');
      return 'skipped';
    }
    await storeRules(tx, job.subreddit_id!, rules);
    await tx`update public.subreddits set provider=${provider.mode},display_name=${details.displayTitle},description=${details.description},subscriber_count=${details.subscriberCount},is_nsfw=${details.isNsfw},last_synced_at=now() where id=${job.subreddit_id}`;
    if (!details.isNsfw)
      for (const post of page.posts) await upsertPost(tx, job.subreddit_id!, provider.mode, post);
    await tx`insert into public.reddit_sync_checkpoints(subreddit_id,sort,cursor,last_success_at,next_sync_at)
      values(${job.subreddit_id},${job.sort},${page.after},now(),now()+interval '10 minutes')
      on conflict(subreddit_id,sort) do update set cursor=excluded.cursor,last_success_at=now(),next_sync_at=excluded.next_sync_at,consecutive_errors=0,error_code=null,provider_paused=false`;
    await complete(tx, job);
    if (page.after && !details.isNsfw)
      await tx`select private.queue_reddit_job('sync',${job.subreddit_id}::uuid,${job.sort})`;
    return 'completed';
  });
}
async function syncRules(sql: Sql, job: RedditJob, provider: RedditProvider) {
  if (!(await communityEligible(sql, job))) return skipIneligible(sql, job);
  const [row] = await sql`select name from public.subreddits where id=${job.subreddit_id}`;
  if (!row) throw new Error('COMMUNITY_UNAVAILABLE');
  const rules = z
    .array(ruleSchema)
    .max(100)
    .parse(await provider.getSubredditRules(z.string().parse(row.name)));
  return sql.begin(async (tx) => {
    await lockCommunityOrganizations(tx, job.subreddit_id!);
    if (!(await lockLease(tx, job))) return 'stale';
    if (!(await communityEligible(tx, job))) {
      await complete(tx, job, 'NO_LONGER_ELIGIBLE');
      return 'skipped';
    }
    await storeRules(tx, job.subreddit_id!, rules);
    await complete(tx, job);
    const posts =
      await tx`select id from public.reddit_posts where subreddit_id=${job.subreddit_id} and not is_deleted order by created_at_provider desc limit 500`;
    for (const post of posts)
      await enqueueEvaluations(tx, z.uuid().parse(post.id), job.subreddit_id!);
    return 'completed';
  });
}
async function refreshPost(sql: Sql, job: RedditJob, provider: RedditProvider) {
  const [row] =
    await sql`select p.provider,p.provider_post_id,p.subreddit_id,p.is_deleted,s.name from public.reddit_posts p
      join public.subreddits s on s.id=p.subreddit_id where p.id=${job.reddit_post_id}`;
  if (!row) return skipIneligible(sql, job);
  if (row.provider !== provider.mode) throw new Error('PROVIDER_SCOPE_MISMATCH');
  const response = row.is_deleted
    ? null
    : await provider.getPostById(z.string().parse(row.provider_post_id));
  const post = response === null ? null : postSchema.parse(response);
  if (post && (post.id !== row.provider_post_id || post.subreddit.toLowerCase() !== row.name))
    throw new Error('PROVIDER_SCOPE_MISMATCH');
  return sql.begin(async (tx) => {
    await lockCommunityOrganizations(tx, z.uuid().parse(row.subreddit_id));
    if (!(await lockLease(tx, job))) return 'stale';
    if (!post || post.isDeleted)
      await tx`select private.purge_reddit_post(${job.reddit_post_id}::uuid)`;
    else await upsertPost(tx, z.uuid().parse(row.subreddit_id), provider.mode, post);
    await tx`update public.reddit_sync_checkpoints set last_post_refresh_at=now() where subreddit_id=${row.subreddit_id}`;
    await complete(tx, job);
    return 'completed';
  });
}
async function readEvaluationContext(sql: Sql | TransactionSql, job: RedditJob) {
  const [raw] =
    await sql`select p.*,s.name from public.reddit_posts p join public.subreddits s on s.id=p.subreddit_id where p.id=${job.reddit_post_id}`;
  const [brand] =
    await sql`select b.id,b.organization_id,b.profile,bs.allowed_reply_style,bs.internal_interpretation
      from public.brands b join public.brand_subreddits bs on bs.brand_id=b.id
      join public.organizations o on o.id=b.organization_id join public.subscriptions subscription on subscription.organization_id=o.id
      where b.id=${job.brand_id} and b.organization_id=${job.organization_id} and bs.subreddit_id=${raw?.subreddit_id ?? null}
        and b.status='active' and bs.status='active' and o.status='active' and o.deleted_at is null
        and subscription.status in ('trialing','active') and subscription.current_period_end>now()`;
  if (!raw || !brand || raw.is_deleted) return null;
  const post = storedPost.parse(raw);
  const [keywords, competitors, rules, knowledge, duplicates, dismissalFeedback] =
    await Promise.all([
      sql`select value,kind,is_exclusion,status,source from public.brand_keywords where brand_id=${job.brand_id} and organization_id=${job.organization_id} order by id`,
      sql`select id,name,domain,aliases from public.brand_competitors where brand_id=${job.brand_id} and organization_id=${job.organization_id} order by id`,
      sql`select provider_rule_id as id,title,description,kind,applies_to as "appliesTo" from public.subreddit_rules where subreddit_id=${post.subreddit_id} order by provider_rule_id`,
      sql`select c.id,c.source_id,d.title,c.content,d.canonical_url as source_url from public.knowledge_chunks c join public.knowledge_documents d on d.id=c.document_id join public.knowledge_sources s on s.id=c.source_id where c.brand_id=${job.brand_id} and c.organization_id=${job.organization_id} and s.deleted_at is null and s.status in ('ready','partial') and d.is_included order by c.created_at,c.id limit 8`,
      sql`select p.id from public.reddit_posts p join public.reddit_posts current on current.id=${job.reddit_post_id} where p.subreddit_id=current.subreddit_id and p.provider=current.provider and not p.is_deleted and p.title=current.title and p.body=current.body and (p.created_at<current.created_at or (p.created_at=current.created_at and p.provider_post_id<current.provider_post_id)) limit 1`,
      sql`select s.name as subreddit,o.intent_category,o.dismissed_reason as reason,least(count(*),1000000)::integer as count
      from public.opportunities o join public.reddit_posts p on p.id=o.reddit_post_id
      join public.subreddits s on s.id=o.subreddit_id
      where o.brand_id=${job.brand_id} and o.organization_id=${job.organization_id}
        and o.reddit_post_id<>${job.reddit_post_id} and o.subreddit_id=${post.subreddit_id}
        and o.status='dismissed' and not p.is_deleted
        and o.dismissed_reason in ('not_relevant','low_intent','product_cannot_help','community_risk')
        and exists(select 1 from public.audit_logs a where a.organization_id=o.organization_id
          and a.target_type='opportunity' and a.target_id=o.id and a.action='opportunity.status_changed'
          and a.actor_type='user' and a.metadata->>'status'='dismissed'
          and a.created_at>=now()-interval '90 days')
      group by s.name,o.intent_category,o.dismissed_reason order by s.name,o.intent_category,o.dismissed_reason limit 50`,
    ]);
  return {
    raw,
    brand,
    post,
    keywords,
    competitors,
    rules,
    knowledge,
    duplicates,
    dismissalFeedback,
  };
}
const contextDigest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function evaluatePost(
  sql: Sql,
  job: RedditJob,
  now: Date,
  maxAgeDays: number,
  ai: AIProvider,
) {
  const context = await sql.begin('isolation level repeatable read read only', (tx) =>
    readEvaluationContext(tx, job),
  );
  if (!context) return skipIneligible(sql, job);
  const { brand, post, keywords, competitors, rules, knowledge, duplicates, dismissalFeedback } =
    context;
  const checksum = contextDigest(context);
  const evaluation = await evaluateOpportunity(
    {
      brand: {
        id: z.uuid().parse(brand.id),
        organization_id: z.uuid().parse(brand.organization_id),
        profile: brand.profile,
      },
      post: {
        id: post.provider_post_id,
        subreddit: post.name,
        permalink: post.permalink!,
        title: post.title ?? '',
        body: post.body ?? '',
        authorName: post.author_name,
        createdAt: post.created_at_provider,
        score: post.score,
        commentCount: post.num_comments,
        upvoteRatio: post.upvote_ratio,
        flair: post.flair,
        isNsfw: post.is_nsfw,
        isLocked: post.is_locked,
        isArchived: post.is_archived,
        isDeleted: post.is_deleted,
        isEdited: post.is_edited,
      },
      rules: z
        .array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            kind: z.string(),
            appliesTo: z.string(),
          }),
        )
        .parse(rules),
      keywords: z.array(keywordInputSchema).parse(keywords),
      competitors: z
        .array(
          z.object({
            id: z.uuid(),
            name: z.string(),
            domain: z.string(),
            aliases: z.array(z.string()),
          }),
        )
        .parse(competitors),
      knowledge: z
        .array(
          z.object({
            id: z.uuid(),
            source_id: z.uuid(),
            title: z.string(),
            content: z.string(),
            source_url: z.string().nullable(),
          }),
        )
        .parse(knowledge),
      now,
      maxAgeDays,
      duplicate: duplicates.length > 0,
      dismissalFeedback: z
        .array(
          z.object({
            subreddit: z.string(),
            intent_category: intentCategorySchema,
            reason: dismissalReasonSchema,
            count: z.number().int().min(0).max(1000000),
          }),
        )
        .max(50)
        .parse(dismissalFeedback),
      allowedReplyStyle: z
        .enum(['helpful', 'technical', 'no_links', 'answer_only'])
        .parse(brand.allowed_reply_style),
    },
    ai,
  );
  return sql.begin(async (tx) => {
    // Match manager lock order before the lease row; a rescore request also
    // locks organization then durable job and must never deadlock publication.
    await tx`select id from public.organizations where id=${job.organization_id} for update`;
    await tx`select id from public.brands where id=${job.brand_id} for update`;
    await tx`select id from public.reddit_posts where id=${job.reddit_post_id} for share`;
    if (!(await lockLease(tx, job))) return 'stale';
    const current = await readEvaluationContext(tx, job);
    if (!current) {
      await complete(tx, job, 'NO_LONGER_ELIGIBLE');
      return 'skipped';
    }
    if (contextDigest(current) !== checksum) {
      await complete(tx, job, 'INPUT_CHANGED');
      await tx`select private.queue_reddit_job('evaluate',null,'new',${job.brand_id}::uuid,${job.reddit_post_id}::uuid)`;
      return 'stale-input';
    }
    if (evaluation.kind === 'scored')
      await tx`select private.publish_opportunity(${job.brand_id}::uuid,${job.reddit_post_id}::uuid,${tx.json(evaluation.evaluation)}::jsonb)`;
    else
      await tx`update public.opportunities set status='archived',suggested_action='ignore' where brand_id=${job.brand_id} and reddit_post_id=${job.reddit_post_id} and not is_blocked and status<>'dismissed'`;
    await complete(tx, job, evaluation.kind === 'filtered' ? 'FILTERED' : null);
    return evaluation.kind === 'filtered' ? 'filtered' : 'completed';
  });
}

export async function processRedditJob(
  sql: Sql,
  id: string,
  provider = createRedditProvider(),
  now = new Date(),
  policy = redditPolicySchema.parse({}),
  ai: AIProvider = createAIProvider(),
) {
  const job = await claimRedditJob(sql, id);
  if (!job) return { status: 'skipped' };
  const renewal = setInterval(() => {
    void sql`update public.reddit_jobs set lease_expires_at=now()+interval '90 seconds' where id=${job.id} and lease_token=${job.lease_token} and status='processing' and lease_expires_at>now()`.catch(
      () => undefined,
    );
  }, 20_000);
  renewal.unref();
  try {
    if (
      ['sync', 'rules', 'refresh'].includes(job.kind) &&
      (await providerPaused(sql, provider.mode))
    )
      throw new RedditProviderError('PROVIDER_PAUSED');
    if (['sync', 'rules', 'refresh'].includes(job.kind)) {
      const retryAt = await providerRetryAt(sql, provider.mode);
      if (retryAt) throw new RedditProviderError('RATE_LIMITED', retryAt);
    }
    if (job.kind === 'sync') return { status: await syncCommunity(sql, job, provider) };
    if (job.kind === 'rules') return { status: await syncRules(sql, job, provider) };
    if (job.kind === 'refresh') return { status: await refreshPost(sql, job, provider) };
    return { status: await evaluatePost(sql, job, now, policy.maxAgeDays, ai) };
  } catch (error) {
    const parsed = z.object({ message: z.string() }).safeParse(error);
    const code =
      error instanceof RedditProviderError
        ? error.code
        : parsed.success &&
            [
              'OPPORTUNITY_LIMIT',
              'PLAN_INACTIVE',
              'TRIAL_EXPIRED',
              'PLAN_UNAVAILABLE',
              'COMMUNITY_UNAVAILABLE',
              'PROVIDER_SCOPE_MISMATCH',
              'PROVIDER_CURSOR_STALLED',
            ].includes(parsed.data.message)
          ? parsed.data.message
          : 'PROVIDER_OR_EVALUATION_FAILED';
    const declaredRetry =
      error instanceof RedditProviderError && code === 'RATE_LIMITED'
        ? z.iso.datetime().safeParse(error.retryAt)
        : null;
    const retryAt = new Date(
      Math.max(
        Date.now() + Math.min(60, 2 ** job.attempts) * 1000,
        declaredRetry?.success ? Date.parse(declaredRetry.data) : 0,
      ),
    ).toISOString();
    const terminal =
      job.attempts >= 3 ||
      [
        'OPPORTUNITY_LIMIT',
        'PLAN_INACTIVE',
        'TRIAL_EXPIRED',
        'PLAN_UNAVAILABLE',
        'PROVIDER_PAUSED',
        'APPROVAL_REQUIRED',
        'NOT_FOUND',
        'PROVIDER_SCOPE_MISMATCH',
      ].includes(code);
    await sql.begin(async (tx) => {
      if (!(await lockLease(tx, job))) return;
      await tx`update public.reddit_jobs set status=${terminal ? 'failed' : 'queued'},lease_token=null,lease_expires_at=null,error_code=${code},available_at=${retryAt} where id=${job.id}`;
      let subredditId = job.subreddit_id;
      if (!subredditId && job.kind === 'refresh') {
        const [post] =
          await tx`select subreddit_id from public.reddit_posts where id=${job.reddit_post_id}`;
        subredditId = post ? z.uuid().parse(post.subreddit_id) : null;
      }
      if (subredditId && ['sync', 'rules', 'refresh'].includes(job.kind)) {
        await tx`insert into public.reddit_sync_checkpoints(subreddit_id,sort,last_error_at,consecutive_errors,error_code,next_sync_at,provider_paused,provider_retry_at)
          values(${subredditId},${job.sort},now(),1,${code},${retryAt},${code === 'PROVIDER_PAUSED'},${code === 'RATE_LIMITED' ? retryAt : null})
          on conflict(subreddit_id,sort) do update set last_error_at=now(),
            consecutive_errors=reddit_sync_checkpoints.consecutive_errors+1,error_code=excluded.error_code,
            next_sync_at=greatest(reddit_sync_checkpoints.next_sync_at,excluded.next_sync_at),
            provider_retry_at=greatest(reddit_sync_checkpoints.provider_retry_at,excluded.provider_retry_at),
            provider_paused=reddit_sync_checkpoints.provider_paused or excluded.provider_paused
              or (${code}='AUTHORIZATION_FAILED' and reddit_sync_checkpoints.consecutive_errors>=2)`;
      }
    });
    return { status: 'retry_or_failed', code };
  } finally {
    clearInterval(renewal);
  }
}

export async function scheduleRedditJobs(
  sql: Sql,
  policy = redditPolicySchema.parse({}),
  providerMode: RedditProvider['mode'] = 'mock',
) {
  await sql.begin(async (tx) => {
    if (!(await tx`select pg_try_advisory_xact_lock(1414743635,3) as acquired`)[0]?.acquired)
      return;
    // Acquire affected tenant locks before checkpoint, opportunity or post mutations.
    // Purge follows the same order, including when a deleted post belongs to several tenants.
    await tx`select organization.id from public.organizations organization where organization.id in (
      select opportunity.organization_id from public.opportunities opportunity join public.reddit_posts post on post.id=opportunity.reddit_post_id
      where post.created_at_provider<now()-${policy.maxAgeDays}*interval '1 day'
        or (not post.is_deleted and (post.last_synced_at<now()-interval '48 hours' or post.created_at_provider<now()-${policy.retentionDays}*interval '1 day'))
    ) order by organization.id for update`;
    if (!(await providerPaused(tx, providerMode)) && !(await providerRetryAt(tx, providerMode))) {
      await tx`insert into public.reddit_sync_checkpoints(subreddit_id,sort) select distinct bs.subreddit_id,sort
      from public.brand_subreddits bs join public.brands b on b.id=bs.brand_id
      join public.organizations o on o.id=b.organization_id join public.subscriptions subscription on subscription.organization_id=o.id
      cross join unnest(array['new','hot','rising']) sort
      where bs.status='active' and b.status='active' and o.status='active' and o.deleted_at is null
        and subscription.status in ('trialing','active') and subscription.current_period_end>now()
        and case sort when 'new' then bs.monitor_new when 'hot' then bs.monitor_hot else bs.monitor_rising end on conflict(subreddit_id,sort) do nothing`;
      const due =
        await tx`select c.subreddit_id,c.sort,c.last_rules_sync_at from public.reddit_sync_checkpoints c where not c.provider_paused and c.next_sync_at<=now()
        and exists(select 1 from public.brand_subreddits bs join public.brands b on b.id=bs.brand_id
          join public.organizations o on o.id=b.organization_id join public.subscriptions subscription on subscription.organization_id=o.id
          where bs.subreddit_id=c.subreddit_id and bs.status='active' and b.status='active' and o.status='active' and o.deleted_at is null
            and subscription.status in ('trialing','active') and subscription.current_period_end>now()
            and case c.sort when 'new' then bs.monitor_new when 'hot' then bs.monitor_hot else bs.monitor_rising end)
        order by c.next_sync_at limit 50 for update`;
      for (const row of due) {
        await tx`select private.queue_reddit_job('sync',${row.subreddit_id}::uuid,${row.sort})`;
        await tx`update public.reddit_sync_checkpoints set next_sync_at=now()+interval '10 minutes'+random()*interval '60 seconds' where subreddit_id=${row.subreddit_id} and sort=${row.sort}`;
      }
      await tx`select private.queue_reddit_job('rules',c.subreddit_id) from (select distinct subreddit_id,last_rules_sync_at from public.reddit_sync_checkpoints) c
      where (c.last_rules_sync_at is null or c.last_rules_sync_at<now()-interval '1 day')
        and exists(select 1 from public.brand_subreddits bs join public.brands b on b.id=bs.brand_id
          join public.organizations o on o.id=b.organization_id join public.subscriptions subscription on subscription.organization_id=o.id
          where bs.subreddit_id=c.subreddit_id and bs.status='active' and b.status='active' and o.status='active' and o.deleted_at is null
            and subscription.status in ('trialing','active') and subscription.current_period_end>now()) limit 100`;
      await tx`select private.queue_reddit_job('refresh',null,'new',null,p.id) from public.reddit_posts p where not p.is_deleted and p.last_synced_at<now()-interval '12 hours' order by p.last_synced_at limit 100`;
    }
    // Failure to refresh cannot retain content indefinitely. Purge stale or aged data conservatively.
    await tx`update public.opportunities opportunity set status='archived',
      suggested_action=case when opportunity.is_blocked then 'blocked' else 'ignore' end
      from public.reddit_posts post where post.id=opportunity.reddit_post_id
        and post.created_at_provider<now()-${policy.maxAgeDays}*interval '1 day'
        and opportunity.status not in ('dismissed','archived')`;
    const expired =
      await tx`select id from public.reddit_posts where not is_deleted and (last_synced_at<now()-interval '48 hours' or created_at_provider<now()-${policy.retentionDays}*interval '1 day') order by last_synced_at limit 100`;
    for (const row of expired) await tx`select private.purge_reddit_post(${row.id}::uuid)`;
  });
}

export async function startRedditWorker(sql: Sql, config: WorkerConfig) {
  if (config.mode !== 'local')
    throw new Error('Phase 3 processing requires the verified local database.');
  const logger = createLogger({ service: 'reddit-worker', level: config.logLevel });
  const observability = createObservability({});
  const connection = { ...config.redis, maxRetriesPerRequest: null, connectTimeout: 2000 };
  const provider = createRedditProvider();
  const queues = Object.values(REDDIT_QUEUES).map(
    (name) =>
      new Queue<{ jobId: string }>(name, {
        connection,
        prefix: config.queuePrefix,
        defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
      }),
  );
  const workers = Object.values(REDDIT_QUEUES).map(
    (name) =>
      new Worker<{ jobId: string }>(
        name,
        async (item) => {
          const data = redditPayload.parse(item.data);
          return observability.run('reddit.process', { jobId: data.jobId }, async () => {
            const result = await processRedditJob(
              sql,
              data.jobId,
              provider,
              new Date(),
              config.redditPolicy,
            );
            logger.info(
              { event: 'reddit_job_finished', jobId: data.jobId, ...result },
              'Reddit pipeline job processed.',
            );
            return result;
          });
        },
        { connection, prefix: config.queuePrefix, concurrency: 2 },
      ),
  );
  const queueError = () =>
    logger.warn({ event: 'reddit_queue_unavailable' }, 'Reddit queue connection unavailable.');
  for (const resource of queues) resource.on('error', queueError);
  for (const resource of workers) resource.on('error', queueError);
  for (const worker of workers)
    worker.on('failed', () =>
      logger.warn({ event: 'reddit_delivery_failed' }, 'Durable job recovery will retry delivery.'),
    );
  try {
    await Promise.all([...queues, ...workers].map((resource) => resource.waitUntilReady()));
  } catch {
    await Promise.allSettled([...queues, ...workers].map((resource) => resource.close()));
    throw new Error('Reddit queues unavailable.');
  }
  let dispatching = false,
    stopped = false,
    lastDispatch: number | null = null,
    lastSchedule = 0;
  let dispatchFinished: Promise<void> = Promise.resolve();
  const dispatch = async () => {
    if (dispatching || stopped) return;
    dispatching = true;
    let finish: () => void = () => undefined;
    dispatchFinished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    try {
      if (Date.now() - lastSchedule > 30_000) {
        await scheduleRedditJobs(sql, config.redditPolicy, provider.mode);
        lastSchedule = Date.now();
      }
      const rows =
        await sql`select id,kind,attempts from public.reddit_jobs where (status='queued' and available_at<=now()) or (status='processing' and lease_expires_at<=now()) order by available_at limit 100`;
      const paused =
        (await providerPaused(sql, provider.mode)) ||
        Boolean(await providerRetryAt(sql, provider.mode));
      for (const row of rows) {
        if (stopped) break;
        if (paused && !['evaluate', 'rescore'].includes(row.kind)) continue;
        const id = z.uuid().parse(row.id);
        await queues[row.kind === 'evaluate' || row.kind === 'rescore' ? 1 : 0]!.add(
          'process',
          { jobId: id },
          { jobId: `${id}-${z.number().int().parse(row.attempts)}` },
        );
      }
      lastDispatch = Date.now();
    } catch {
      lastDispatch = null;
      logger.warn({ event: 'reddit_dispatch_failed' }, 'Reddit outbox dispatch unavailable.');
    } finally {
      dispatching = false;
      finish();
    }
  };
  await dispatch();
  const timer = setInterval(() => {
    void dispatch();
  }, 1500);
  return {
    isReady: () =>
      !stopped &&
      lastDispatch !== null &&
      Date.now() - lastDispatch < 30_000 &&
      workers.every((worker) => worker.isRunning()),
    stop: async (force = false) => {
      stopped = true;
      clearInterval(timer);
      await dispatchFinished;
      await Promise.all(workers.map((worker) => worker.close(force)));
      await Promise.all(queues.map((queue) => queue.close()));
    },
  };
}
