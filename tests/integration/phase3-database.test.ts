import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { demoBrand } from '@threadsignal/knowledge';
import { localDatabaseUrl, verifyDocker } from '../../scripts/service-utils.mjs';

const users = {
  owner: randomUUID(),
  admin: randomUUID(),
  member: randomUUID(),
  viewer: randomUUID(),
  other: randomUUID(),
};
const evaluation = {
  summary: 'A developer is comparing batch image APIs.',
  user_need: 'Reliable asynchronous image optimization.',
  intent_category: 'recommendation',
  semantic_relevance: 95,
  buying_intent: 95,
  freshness: 100,
  engagement_velocity: 85,
  rule_fit: 100,
  competitor_context: 80,
  penalty_score: 0,
  final_score: 94,
  risk_level: 'low',
  suggested_action: 'reply',
  is_blocked: false,
  risk_reasons: [],
  matched_capabilities: ['Asynchronous image batches'],
  missing_capabilities: [],
  matched_competitor_ids: [],
  knowledge_citations: [],
  reasoning_summary: 'The request matches the verified batch image workflow.',
  model_metadata: { provider: 'mock', version: 'integration-v1' },
  input_checksum: createHash('sha256').update('phase3-integration-evaluation').digest('hex'),
};

describe('Phase 3 tenant monitoring and opportunity database contracts', () => {
  let sql: postgres.Sql;
  let organization: string;
  let otherOrganization: string;
  let brand: string;
  let otherBrand: string;
  let communities: string[] = [];
  async function asUser<T>(user: string, operation: (tx: postgres.TransactionSql) => Promise<T>) {
    return sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${user},true),
        set_config('request.jwt.claims',${JSON.stringify({ sub: user, role: 'authenticated' })},true)`;
      await tx`set local role authenticated`;
      return operation(tx);
    });
  }
  async function createBrand(user: string, org: string) {
    const [result] = await asUser(
      user,
      (tx) => tx`select public.save_brand(${org},null,${tx.json(demoBrand)}) as id`,
    );
    return String(result?.id);
  }
  async function community(
    options: { brand?: string; user?: string; settings?: Record<string, postgres.JSONValue> } = {},
  ) {
    const name = `p3_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
    const result = await asUser(options.user ?? users.owner, async (tx) => {
      const [row] =
        await tx`select public.add_brand_subreddit(${options.brand ?? brand},${name},${tx.json(options.settings ?? {})}) as id`;
      await tx`set local role postgres`;
      const [record] =
        await tx`select subreddit_id from public.brand_subreddits where id=${row?.id}`;
      // These isolated SQL fixtures are not intended for the normal processor.
      await tx`update public.reddit_jobs set available_at=now()+interval '1 day' where subreddit_id=${record?.subreddit_id}`;
      return { id: String(row?.id), subreddit: String(record?.subreddit_id), name };
    });
    communities.push(result.subreddit);
    return result;
  }
  async function post(subreddit: string) {
    const providerId = `p3_${randomUUID().replaceAll('-', '')}`;
    const [row] = await sql`insert into public.reddit_posts(provider,provider_post_id,subreddit_id,
      permalink,title,body,author_name,created_at_provider,score,num_comments)
      values('mock',${providerId},${subreddit},${`https://www.reddit.com/r/saas/comments/${providerId}/fixture/`},
        'Looking for an image processing API','We need a reliable batch image processing API for our store.',
        'synthetic_developer',now(),25,8) returning id`;
    return String(row?.id);
  }
  async function publish(
    postId: string,
    value: Record<string, postgres.JSONValue> = evaluation,
    brandId = brand,
  ) {
    const [row] =
      await sql`select private.publish_opportunity(${brandId},${postId},${sql.json(value)}) as id`;
    return row?.id === null ? null : String(row?.id);
  }
  async function usage() {
    const [row] = await asUser(
      users.owner,
      (tx) => tx`select public.get_opportunity_usage(${organization}) as value`,
    );
    return row?.value as { quantity: number; limit: number; plan_key: string };
  }
  async function cleanupCommunities() {
    if (communities.length)
      await sql`delete from public.subreddits where id in ${sql(communities)}`;
    communities = [];
  }
  beforeAll(async () => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 6, connect_timeout: 5, onnotice: () => {} });
    for (const user of Object.values(users))
      await sql`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(${user},${`${user}@phase3.example`},now(),'{}')`;
    for (const [user, suffix] of [
      [users.owner, 'a'],
      [users.other, 'b'],
    ] as const) {
      const [org] = await asUser(
        user,
        (tx) => tx`select public.create_organization('Opportunity fixtures',
        ${`phase3-${suffix}-${user.slice(0, 16)}`},${`${user}@phase3.example`}) as id`,
      );
      if (suffix === 'a') organization = String(org?.id);
      else otherOrganization = String(org?.id);
    }
    for (const role of ['admin', 'member', 'viewer'] as const)
      await sql`insert into public.organization_members(organization_id,user_id,role)
        values(${organization},${users[role]},${role})`;
  });
  beforeEach(async () => {
    await sql`delete from public.brands where organization_id in (${organization},${otherOrganization})`;
    await cleanupCommunities();
    await sql`delete from public.usage_counters where organization_id in (${organization},${otherOrganization})`;
    await sql`update public.subscriptions set plan_key='trial',status='trialing',current_period_start=now(),
      current_period_end=now()+interval '7 days' where organization_id in (${organization},${otherOrganization})`;
    brand = await createBrand(users.owner, organization);
    otherBrand = await createBrand(users.other, otherOrganization);
  });
  afterAll(async () => {
    if (!sql) return;
    if (organization && otherOrganization)
      await sql`delete from public.organizations where id in (${organization},${otherOrganization})`;
    await cleanupCommunities();
    await sql`delete from auth.users where id in ${sql(Object.values(users))}`;
    await sql.end({ timeout: 3 });
  });

  it('allows manager monitoring, deduplicates additions/jobs, and rejects forged settings and roles', async () => {
    const current = await community({ user: users.admin });
    const [repeat] = await asUser(
      users.owner,
      (tx) =>
        tx`select public.add_brand_subreddit(${brand},${current.name.toUpperCase()},'{}') as id`,
    );
    expect(repeat?.id).toBe(current.id);
    expect(
      await sql`select id from public.reddit_jobs where subreddit_id=${current.subreddit}`,
    ).toHaveLength(2);
    for (const user of [users.member, users.viewer, users.other])
      await expect(
        asUser(user, (tx) => tx`select public.update_brand_subreddit(${current.id},'{}')`),
      ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(
        users.owner,
        (tx) =>
          tx`select public.update_brand_subreddit(${current.id},' {"organization_id":"forged"}'::jsonb)`,
      ),
    ).rejects.toThrow('INVALID_MONITOR_SETTINGS');
    await expect(
      asUser(
        users.owner,
        (tx) => tx`select public.add_brand_subreddit(${brand},'https://reddit.com/r/saas','{}')`,
      ),
    ).rejects.toThrow('INVALID_SUBREDDIT');
    const [audit] =
      await sql`select count(*)::integer as count from public.audit_logs where target_id=${current.id} and action='subreddit.added'`;
    expect(audit?.count).toBe(1);
  });

  it('enforces active community quotas atomically, including concurrent additions and resumes', async () => {
    await community();
    await community();
    const results = await Promise.allSettled([community(), community()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const paused = await community({ settings: { status: 'paused' } });
    await expect(
      asUser(
        users.owner,
        (tx) => tx`select public.update_brand_subreddit(${paused.id},'{"status":"active"}')`,
      ),
    ).rejects.toThrow('SUBREDDIT_LIMIT');
    const [active] =
      await sql`select id from public.brand_subreddits where brand_id=${brand} and status='active' limit 1`;
    await asUser(
      users.owner,
      (tx) => tx`select public.update_brand_subreddit(${active?.id},'{"status":"paused"}')`,
    );
    await asUser(
      users.owner,
      (tx) => tx`select public.update_brand_subreddit(${paused.id},'{"status":"active"}')`,
    );
    const [count] =
      await sql`select count(*)::integer as value from public.brand_subreddits where organization_id=${organization} and status='active'`;
    expect(count?.value).toBe(3);
  });

  it('accepts the specification ArtificialIntelligence fixture without allowing arbitrary long names', async () => {
    const rollback = new Error('ROLL_BACK_COMMUNITY_NAME_FIXTURE');
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claim.sub',${users.owner},true)`;
        await tx`set local role authenticated`;
        const [record] =
          await tx`select public.add_brand_subreddit(${brand},'ArtificialIntelligence','{}') as id`;
        expect(typeof record?.id).toBe('string');
        await expect(
          tx.savepoint(
            (nested) => nested`select public.add_brand_subreddit(${brand},${'x'.repeat(22)},'{}')`,
          ),
        ).rejects.toThrow('INVALID_SUBREDDIT');
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });

  it('keeps shared post reads scoped to monitored communities or existing tenant opportunities', async () => {
    const own = await community();
    const other = await community({ brand: otherBrand, user: users.other });
    const ownPost = await post(own.subreddit);
    const otherPost = await post(other.subreddit);
    const opportunity = await publish(ownPost);
    const rows = await asUser(
      users.viewer,
      (tx) => tx`select id from public.reddit_posts where id in (${ownPost},${otherPost})`,
    );
    expect(rows.map((row) => row.id)).toEqual([ownPost]);
    expect(
      await asUser(
        users.other,
        (tx) => tx`select id from public.opportunities where id=${opportunity}`,
      ),
    ).toHaveLength(0);
    await asUser(users.owner, (tx) => tx`select public.remove_brand_subreddit(${own.id})`);
    expect(
      await asUser(
        users.viewer,
        (tx) => tx`select id from public.reddit_posts where id=${ownPost}`,
      ),
    ).toHaveLength(1);
    await expect(
      asUser(
        users.member,
        (tx) => tx`update public.reddit_posts set title='forged' where id=${ownPost}`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(
        users.owner,
        (tx) => tx`update public.subreddits set is_nsfw=false where id=${other.subreddit}`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('preserves competitor/keyword IDs and settings across brand edits and synchronizes keyword CRUD', async () => {
    const [term] =
      await sql`select id from public.brand_keywords where brand_id=${brand} and value='image optimization'`;
    const competitors =
      await sql`select id from public.brand_competitors where brand_id=${brand} order by id`;
    await asUser(
      users.admin,
      (tx) =>
        tx`select public.save_brand_keyword(${brand},${term?.id},${tx.json({ value: 'image optimization', kind: 'technical', is_exclusion: false, status: 'paused', source: 'suggested' })})`,
    );
    await asUser(
      users.owner,
      (tx) =>
        tx`select public.save_brand(${organization},${brand},${tx.json({ ...demoBrand, name: 'Updated brand name' })})`,
    );
    expect(
      await sql`select id from public.brand_competitors where brand_id=${brand} order by id`,
    ).toEqual(competitors);
    expect(
      (await sql`select id,kind,status,source from public.brand_keywords where id=${term?.id}`)[0],
    ).toEqual({ id: term?.id, kind: 'technical', status: 'paused', source: 'suggested' });
    const [created] = await asUser(
      users.owner,
      (tx) =>
        tx`select public.save_brand_keyword(${brand},null,${tx.json({ value: 'privacy limits', kind: 'problem', is_exclusion: false, status: 'active', source: 'manual' })}) as id`,
    );
    expect(
      (await sql`select profile->'keywords' as keywords from public.brands where id=${brand}`)[0]
        ?.keywords,
    ).toContain('privacy limits');
    await asUser(users.owner, (tx) => tx`select public.delete_brand_keyword(${created?.id})`);
    expect(
      (await sql`select profile->'keywords' as keywords from public.brands where id=${brand}`)[0]
        ?.keywords,
    ).not.toContain('privacy limits');
    await expect(
      asUser(users.viewer, (tx) => tx`select public.delete_brand_keyword(${term?.id})`),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('validates keyword kinds, exclusions, duplicates, and canonical profile capacity', async () => {
    const keyword = {
      value: 'new keyword',
      kind: 'exclusion',
      is_exclusion: false,
      status: 'active',
      source: 'manual',
    };
    await expect(
      asUser(
        users.owner,
        (tx) => tx`select public.save_brand_keyword(${brand},null,${tx.json(keyword)})`,
      ),
    ).rejects.toThrow('INVALID_KEYWORD');
    await expect(
      asUser(
        users.owner,
        (tx) =>
          tx`select public.save_brand_keyword(${brand},null,${tx.json({ ...keyword, value: 'IMAGE OPTIMIZATION', kind: 'category' })})`,
      ),
    ).rejects.toThrow('KEYWORD_EXISTS');
    const profile = { ...demoBrand, keywords: Array.from({ length: 30 }, (_, i) => `term ${i}`) };
    await asUser(
      users.owner,
      (tx) => tx`select public.save_brand(${organization},${brand},${tx.json(profile)})`,
    );
    await expect(
      asUser(
        users.owner,
        (tx) =>
          tx`select public.save_brand_keyword(${brand},null,${tx.json({ ...keyword, kind: 'category' })})`,
      ),
    ).rejects.toThrow('KEYWORD_LIMIT');
  });

  it('allocates usage exactly once for simultaneous deliveries and preserves saved state on rescore', async () => {
    const current = await community();
    const postId = await post(current.subreddit);
    const ids = await Promise.all([publish(postId), publish(postId), publish(postId)]);
    expect(new Set(ids).size).toBe(1);
    expect((await usage()).quantity).toBe(1);
    await asUser(users.member, (tx) => tx`select public.set_opportunity_status(${ids[0]},'saved')`);
    expect(await publish(postId, { ...evaluation, final_score: 83 })).toBe(ids[0]);
    expect((await sql`select status from public.opportunities where id=${ids[0]}`)[0]?.status).toBe(
      'saved',
    );
    expect((await usage()).quantity).toBe(1);
  });

  it('enforces trial opportunity capacity under concurrent publication and preserves existing records', async () => {
    const current = await community();
    await sql`insert into public.usage_counters(organization_id,metric,period_start,period_end,quantity)
      select organization_id,'opportunities',current_period_start,current_period_end,19
      from public.subscriptions where organization_id=${organization}`;
    const posts = await Promise.all([post(current.subreddit), post(current.subreddit)]);
    const results = await Promise.allSettled(posts.map((id) => publish(id)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await usage()).toMatchObject({ quantity: 20, limit: 20, plan_key: 'trial' });
    const [opportunity] =
      await sql`select id,reddit_post_id from public.opportunities where brand_id=${brand}`;
    await asUser(
      users.member,
      (tx) => tx`select public.set_opportunity_status(${opportunity?.id},'dismissed','low_intent')`,
    );
    await publish(String(opportunity?.reddit_post_id));
    expect((await usage()).quantity).toBe(20);
  });

  it('enforces paid monthly limits and starts a new counter only for a new subscription period', async () => {
    const current = await community();
    for (const [plan, limit] of [
      ['solo', 100],
      ['growth', 500],
    ] as const) {
      await sql`update public.subscriptions set plan_key=${plan},status='active',
        current_period_start=date_trunc('second',now())+${plan === 'solo' ? 0 : 1}*interval '1 second',
        current_period_end=now()+interval '30 days' where organization_id=${organization}`;
      await sql`insert into public.usage_counters(organization_id,metric,period_start,period_end,quantity)
        select organization_id,'opportunities',current_period_start,current_period_end,${limit - 1}
        from public.subscriptions where organization_id=${organization}`;
      const accepted = await post(current.subreddit);
      expect(await publish(accepted)).not.toBeNull();
      await expect(publish(await post(current.subreddit))).rejects.toThrow('OPPORTUNITY_LIMIT');
      expect(await usage()).toMatchObject({ quantity: limit, limit, plan_key: plan });
      expect(await publish(accepted)).not.toBeNull();
      expect((await usage()).quantity).toBe(limit);
    }
    await sql`update public.subscriptions set current_period_start=current_period_end,
      current_period_end=current_period_end+interval '1 month' where organization_id=${organization}`;
    expect(await publish(await post(current.subreddit))).not.toBeNull();
    expect((await usage()).quantity).toBe(1);
    expect(
      await sql`select quantity from public.usage_counters where organization_id=${organization}`,
    ).toHaveLength(3);
  });

  it('filters below-minimum scores and paused/archived brands without consuming usage', async () => {
    const current = await community({ settings: { minimum_score: 80 } });
    const postId = await post(current.subreddit);
    expect(await publish(postId, { ...evaluation, final_score: 60 })).toBeNull();
    expect((await usage()).quantity).toBe(0);
    await asUser(
      users.owner,
      (tx) => tx`select public.update_brand_subreddit(${current.id},'{"status":"paused"}')`,
    );
    expect(await publish(postId)).toBeNull();
    await asUser(
      users.owner,
      (tx) => tx`select public.update_brand_subreddit(${current.id},'{"status":"active"}')`,
    );
    await asUser(users.owner, (tx) => tx`select public.archive_brand(${brand},true)`);
    expect(await publish(postId)).toBeNull();
    expect((await usage()).quantity).toBe(0);
  });

  it('retains hard-block explanations regardless of minimum score and forbids actionable status', async () => {
    const current = await community({ settings: { minimum_score: 100 } });
    const postId = await post(current.subreddit);
    const id = await publish(postId, {
      ...evaluation,
      final_score: 0,
      is_blocked: true,
      risk_level: 'blocked',
      suggested_action: 'blocked',
      risk_reasons: ['The community prohibits promotional replies.'],
    });
    expect(id).not.toBeNull();
    expect(
      (await sql`select status,is_blocked from public.opportunities where id=${id}`)[0],
    ).toEqual({ status: 'blocked', is_blocked: true });
    await expect(
      asUser(users.member, (tx) => tx`select public.set_opportunity_status(${id},'saved')`),
    ).rejects.toThrow('OPPORTUNITY_BLOCKED');
    await asUser(
      users.member,
      (tx) => tx`select public.set_opportunity_status(${id},'dismissed','community_risk')`,
    );
    expect(
      await publish(postId, {
        ...evaluation,
        final_score: 0,
        is_blocked: true,
        risk_level: 'blocked',
        suggested_action: 'blocked',
      }),
    ).toBe(id);
    expect(
      (
        await sql`select status,is_blocked,dismissed_reason from public.opportunities where id=${id}`
      )[0],
    ).toEqual({ status: 'dismissed', is_blocked: true, dismissed_reason: 'community_risk' });
  });

  it('authorizes member actions and atomic bulk dismissal while rejecting cross-tenant selections', async () => {
    const own = await community();
    const other = await community({ brand: otherBrand, user: users.other });
    const first = (await publish(await post(own.subreddit)))!;
    const second = (await publish(await post(own.subreddit)))!;
    const foreign = (await publish(await post(other.subreddit), evaluation, otherBrand))!;
    await expect(
      asUser(users.viewer, (tx) => tx`select public.set_opportunity_status(${first},'monitoring')`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(users.other, (tx) => tx`select public.rescore_opportunity(${first})`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(
        users.member,
        (tx) =>
          tx`select public.bulk_dismiss_opportunities(${[first, foreign]}::uuid[],'not_relevant')`,
      ),
    ).rejects.toThrow('INVALID_OPPORTUNITY_SELECTION');
    expect((await sql`select status from public.opportunities where id=${first}`)[0]?.status).toBe(
      'new',
    );
    const [bulk] = await asUser(
      users.member,
      (tx) =>
        tx`select public.bulk_dismiss_opportunities(${[first, second, first]}::uuid[],'already_answered') as count`,
    );
    expect(bulk?.count).toBe(2);
    expect(
      await sql`select id from public.opportunities where id in (${first},${second}) and status='dismissed'`,
    ).toHaveLength(2);
  });

  it('deduplicates authorized rescore and refresh requests without charging extra usage', async () => {
    const current = await community();
    const id = (await publish(await post(current.subreddit)))!;
    const results = await Promise.all(
      [1, 2].map(() =>
        asUser(users.member, (tx) => tx`select public.rescore_opportunity(${id}) as id`),
      ),
    );
    expect(results[0]?.[0]?.id).toBe(results[1]?.[0]?.id);
    const rules = await Promise.all(
      [1, 2].map(() =>
        asUser(
          users.admin,
          (tx) => tx`select public.refresh_brand_subreddit(${current.id},'rules') as id`,
        ),
      ),
    );
    expect(rules[0]?.[0]?.id).toBe(rules[1]?.[0]?.id);
    expect((await usage()).quantity).toBe(1);
    await expect(
      asUser(
        users.viewer,
        (tx) => tx`select public.refresh_brand_subreddit(${current.id},'rules')`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects cross-brand references, invalid scores, and mismatched tenant foreign keys', async () => {
    const current = await community();
    const postId = await post(current.subreddit);
    const [competitor] =
      await sql`select id from public.brand_competitors where brand_id=${otherBrand} limit 1`;
    await expect(
      publish(postId, { ...evaluation, matched_competitor_ids: [competitor?.id] }),
    ).rejects.toThrow('INVALID_COMPETITOR_REFERENCE');
    await expect(publish(postId, { ...evaluation, final_score: 101 })).rejects.toThrow(
      'INVALID_EVALUATION',
    );
    await expect(
      publish(postId, {
        ...evaluation,
        knowledge_citations: [
          {
            chunk_id: randomUUID(),
            source_id: randomUUID(),
            title: 'Forged',
            source_url: null,
            excerpt: 'Not verified',
          },
        ],
      }),
    ).rejects.toThrow('INVALID_KNOWLEDGE_REFERENCE');
    await expect(sql`insert into public.brand_subreddits(organization_id,brand_id,subreddit_id)
      values(${organization},${otherBrand},${current.subreddit})`).rejects.toMatchObject({
      code: '23503',
    });
    await expect(
      asUser(
        users.owner,
        (tx) => tx`select private.publish_opportunity(${brand},${postId},${tx.json(evaluation)})`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('reconstructs citations from current tenant knowledge and refuses excluded source references', async () => {
    const current = await community();
    const postId = await post(current.subreddit);
    const sourceId = randomUUID();
    const documentId = randomUUID();
    const chunkId = randomUUID();
    const text = 'The verified product documentation supports asynchronous image batches.';
    const checksum = createHash('sha256').update(text).digest('hex');
    await sql`insert into public.knowledge_sources(id,organization_id,brand_id,name,type,status,manual_text)
      values(${sourceId},${organization},${brand},'Verified limits','manual','ready',${text})`;
    await sql`insert into public.knowledge_documents(id,organization_id,brand_id,source_id,document_key,title,canonical_url,content,checksum)
      values(${documentId},${organization},${brand},${sourceId},'manual','Verified documentation',
        'https://clarityscale.example/docs',${text},${checksum})`;
    await sql`insert into public.knowledge_chunks(id,organization_id,brand_id,source_id,document_id,chunk_index,content,token_count,embedding,checksum)
      values(${chunkId},${organization},${brand},${sourceId},${documentId},0,${text},12,
        ${JSON.stringify([1, ...Array.from({ length: 511 }, () => 0)])}::extensions.vector,${checksum})`;
    const citation = {
      chunk_id: chunkId,
      source_id: sourceId,
      title: 'Forged title',
      source_url: 'https://unapproved.example',
      excerpt: 'Forged claim',
    };
    const id = await publish(postId, { ...evaluation, knowledge_citations: [citation] });
    const [record] = await sql`select knowledge_citations from public.opportunities where id=${id}`;
    expect(record?.knowledge_citations).toEqual([
      {
        chunk_id: chunkId,
        source_id: sourceId,
        title: 'Verified documentation',
        source_url: 'https://clarityscale.example/docs',
        excerpt: text,
      },
    ]);
    await asUser(
      users.owner,
      (tx) => tx`select public.set_knowledge_document_included(${documentId},false)`,
    );
    await expect(
      publish(postId, { ...evaluation, knowledge_citations: [citation] }),
    ).rejects.toThrow('INVALID_KNOWLEDGE_REFERENCE');
  });

  it('purges original and derived content, retains operational counts, and prevents resurrection', async () => {
    const current = await community();
    const postId = await post(current.subreddit);
    const id = await publish(postId);
    await sql`select private.purge_reddit_post(${postId})`;
    expect(
      (
        await sql`select title,body,author_name,permalink,flair,raw_metadata,is_deleted from public.reddit_posts where id=${postId}`
      )[0],
    ).toEqual({
      title: null,
      body: null,
      author_name: null,
      permalink: null,
      flair: null,
      raw_metadata: {},
      is_deleted: true,
    });
    expect(
      (
        await sql`select summary,user_need,reasoning_summary,knowledge_citations,model_metadata,status,is_blocked,input_checksum from public.opportunities where id=${id}`
      )[0],
    ).toEqual({
      summary: '',
      user_need: '',
      reasoning_summary: '',
      knowledge_citations: [],
      model_metadata: {},
      status: 'archived',
      is_blocked: true,
      input_checksum: '0'.repeat(64),
    });
    expect(await publish(postId)).toBeNull();
    expect((await usage()).quantity).toBe(1);
    await expect(
      asUser(users.member, (tx) => tx`select public.rescore_opportunity(${id})`),
    ).rejects.toThrow('POST_DELETED');
  });

  it('blocks expired plans and exposes read-only usage without leaking other organizations', async () => {
    const current = await community();
    const postId = await post(current.subreddit);
    await sql`update public.subscriptions set current_period_start=now()-interval '8 days',current_period_end=now()-interval '1 day' where organization_id=${organization}`;
    await expect(publish(postId)).rejects.toThrow('TRIAL_EXPIRED');
    await expect(community()).rejects.toThrow('TRIAL_EXPIRED');
    expect((await usage()).quantity).toBe(0);
    await expect(
      asUser(users.other, (tx) => tx`select public.get_opportunity_usage(${organization})`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(
        users.owner,
        (tx) =>
          tx`update public.usage_counters set quantity=0 where organization_id=${organization}`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
