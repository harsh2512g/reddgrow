import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { demoBrand } from '@threadsignal/knowledge';
import { localDatabaseUrl, verifyDocker } from '../../scripts/service-utils.mjs';

const actors = Object.fromEntries(
  ['owner', 'admin', 'member', 'viewer', 'other'].map((role) => [role, randomUUID()]),
) as Record<'owner' | 'admin' | 'member' | 'viewer' | 'other', string>;
const codes = [
  'RELEVANCE',
  'UNSUPPORTED_CLAIMS',
  'FAKE_CUSTOMER_EXPERIENCE',
  'AFFILIATION_DISCLOSURE',
  'EXCESSIVE_PROMOTION',
  'MISLEADING_COMPARISON',
  'DISALLOWED_LINK',
  'SUBREDDIT_RULE_CONFLICT',
  'HARASSMENT_MANIPULATION',
  'PERSONAL_DATA',
  'LIMITATION_OMITTED',
  'NO_VENDORS_REQUEST',
];
const content =
  'Start with representative source images and compare output quality. ClarityScale AI supports batch image processing. I work with the team behind ClarityScale AI.';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const profile = { ...demoBrand, competitors: [] };
const evaluation = {
  summary: 'An API developer needs batch image optimization.',
  user_need: 'Find a documented batch image API.',
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
  matched_capabilities: ['Batch image processing'],
  missing_capabilities: [],
  matched_competitor_ids: [],
  knowledge_citations: [],
  reasoning_summary: 'Matches documented image processing.',
  model_metadata: { provider: 'mock' },
  input_checksum: hash('phase4 evaluation'),
};

describe('Phase 4 draft workflow database boundaries', () => {
  let sql: postgres.Sql;
  let organization: string;
  let otherOrganization: string;
  let brand: string;
  let opportunity: string;
  let subreddit: string;
  let post: string;
  let source: string;
  let document: string;
  let chunk: string;
  const communities: string[] = [];

  async function asUser<T>(actor: string, operation: (tx: postgres.TransactionSql) => Promise<T>) {
    return sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${actor},true),set_config('request.jwt.claims',${JSON.stringify({ sub: actor, role: 'authenticated' })},true)`;
      await tx`set local role authenticated`;
      return operation(tx);
    });
  }
  async function request(
    key = randomUUID(),
    actor = actors.member,
    options: Record<string, postgres.JSONValue> = {},
  ) {
    const [row] = await asUser(
      actor,
      (tx) => tx`select public.request_draft(${opportunity},${key},${tx.json(options)}) as id`,
    );
    return String(row?.id);
  }
  async function row(id: string) {
    const [draft] = await sql`select * from public.drafts where id=${id}`;
    return draft;
  }
  async function lease(id: string, kind: 'generate' | 'verify' | 'compliance') {
    const token = randomUUID();
    const [job] =
      await sql`update public.draft_jobs set status='processing',attempts=attempts+1,lease_token=${token},lease_expires_at=now()+interval '90 seconds'
      where id=(select id from public.draft_jobs where draft_id=${id} and kind=${kind} and status='queued' order by created_at,id limit 1) returning id,version`;
    expect(job).toBeDefined();
    const [context] = await sql`select private.draft_context_checksum(${id}) as checksum`;
    return {
      id: String(job?.id),
      version: Number(job?.version),
      token,
      checksum: String(context?.checksum),
    };
  }
  function generation(value = content, ids = [chunk]) {
    return {
      draft: value,
      strategy: 'Answer the technical need with documented facts.',
      affiliation_disclosure_included: true,
      brand_mentioned: true,
      suggested_link: null,
      claims: [
        {
          text: 'ClarityScale AI supports batch image processing.',
          source_chunk_ids: ids,
          confidence: 'high',
        },
      ],
      limitations_mentioned: [],
      uncertainties: [],
      provider_metadata: {
        provider: 'mock',
        model: 'integration-fixture',
        input_tokens: 100,
        output_tokens: 50,
        estimated_cost_usd: 0,
      },
    };
  }
  function verification(status = 'verified', ids = [chunk]) {
    return {
      overall_status: 'pass',
      claims: [
        {
          claim_text: 'ClarityScale AI supports batch image processing.',
          status,
          confidence: 'high',
          source_chunk_ids: ids,
          explanation: 'Supported by the supplied documentation.',
          provenance: [{ excerpt: 'FORGED EXCERPT' }],
        },
      ],
    };
  }
  function compliance(warning = false, failedCode?: string) {
    return {
      status: warning ? 'warning' : 'pass',
      safe_to_approve: true,
      checks: codes.map((code) => ({
        code,
        status:
          code === failedCode
            ? 'fail'
            : warning && code === 'EXCESSIVE_PROMOTION'
              ? 'warning'
              : 'pass',
        message: 'Independent fixture check.',
        suggested_fix: null,
      })),
    };
  }
  async function generated(id: string) {
    const j = await lease(id, 'generate');
    const [result] =
      await sql`select private.publish_draft_generation(${j.id},${j.token},${j.checksum},${sql.json(generation())}) as value`;
    expect(result?.value).toBe(true);
    return j;
  }
  async function verified(id: string, status = 'verified', warning = false, failedCode?: string) {
    const j = await lease(id, 'verify');
    const [result] =
      await sql`select private.publish_draft_verification(${j.id},${j.token},${j.checksum},${sql.json(verification(status))}) as value`;
    expect(result?.value).toBe(true);
    const c = await lease(id, 'compliance');
    const [checked] =
      await sql`select private.publish_draft_compliance(${c.id},${c.token},${c.checksum},${sql.json(compliance(warning, failedCode))}) as value`;
    expect(checked?.value).toBe(true);
  }
  async function ready(status = 'verified', warning = false, failedCode?: string) {
    const id = await request();
    await generated(id);
    await verified(id, status, warning, failedCode);
    return id;
  }
  async function approve(
    id: string,
    version = 1,
    warnings = false,
    responsible = true,
    actor = actors.member,
  ) {
    return asUser(
      actor,
      (tx) => tx`select public.approve_draft(${id},${version},${warnings},${responsible})`,
    );
  }
  async function usage() {
    const [r] = await asUser(
      actors.owner,
      (tx) => tx`select public.get_draft_usage(${organization}) as value`,
    );
    return r?.value as { quantity: number; limit: number; plan_key: string };
  }
  beforeAll(async () => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 6, connect_timeout: 5, onnotice: () => {} });
    for (const actor of Object.values(actors))
      await sql`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(${actor},${`${actor}@phase4.example`},now(),'{}')`;
    for (const actor of [actors.owner, actors.other]) {
      const [r] = await asUser(
        actor,
        (tx) =>
          tx`select public.create_organization('Draft fixtures',${`phase4-${actor}`},${`${actor}@phase4.example`}) as id`,
      );
      if (actor === actors.owner) organization = String(r?.id);
      else otherOrganization = String(r?.id);
    }
    for (const role of ['admin', 'member', 'viewer'] as const)
      await sql`insert into public.organization_members(organization_id,user_id,role) values(${organization},${actors[role]},${role})`;
  });
  beforeEach(async () => {
    await sql`delete from public.brands where organization_id in (${organization},${otherOrganization})`;
    if (communities.length)
      await sql`delete from public.subreddits where id in ${sql(communities)}`;
    communities.length = 0;
    await sql`delete from public.usage_counters where organization_id=${organization}`;
    await sql`delete from public.responsible_use_acceptances where organization_id=${organization}`;
    await sql`update public.subscriptions set plan_key='trial',status='trialing',current_period_start=now(),current_period_end=now()+interval '7 days' where organization_id=${organization}`;
    const [b] = await asUser(
      actors.owner,
      (tx) => tx`select public.save_brand(${organization},null,${tx.json(profile)}) as id`,
    );
    brand = String(b?.id);
    const name = `p4_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
    const [s] =
      await sql`insert into public.subreddits(name,display_name) values(${name},${name}) returning id`;
    subreddit = String(s?.id);
    communities.push(subreddit);
    await sql`insert into public.brand_subreddits(organization_id,brand_id,subreddit_id) values(${organization},${brand},${subreddit})`;
    const providerId = `p4_${randomUUID().replaceAll('-', '')}`;
    const [p] =
      await sql`insert into public.reddit_posts(provider,provider_post_id,subreddit_id,permalink,title,body,created_at_provider)
      values('mock',${providerId},${subreddit},${`https://www.reddit.com/r/saas/comments/${providerId}/fixture/`},'Which API supports batch images?','Looking for documented asynchronous processing of product photography.',now()) returning id`;
    post = String(p?.id);
    const [o] =
      await sql`select private.publish_opportunity(${brand},${post},${sql.json(evaluation)}) as id`;
    opportunity = String(o?.id);
    const [ks] =
      await sql`insert into public.knowledge_sources(organization_id,brand_id,name,type,status,last_ingested_at) values(${organization},${brand},'API reference','manual','ready',now()) returning id`;
    source = String(ks?.id);
    const knowledge =
      'ClarityScale AI supports batch image processing. Highly compressed sources may still show artifacts.';
    const [kd] =
      await sql`insert into public.knowledge_documents(organization_id,brand_id,source_id,document_key,title,canonical_url,content,checksum)
      values(${organization},${brand},${source},'api','Batch image API','https://clarityscale.example/docs',${knowledge},${hash(knowledge)}) returning id`;
    document = String(kd?.id);
    const vector = `[${[1, ...Array<number>(511).fill(0)].join(',')}]`;
    const [kc] =
      await sql`insert into public.knowledge_chunks(organization_id,brand_id,source_id,document_id,chunk_index,content,token_count,embedding,checksum)
      values(${organization},${brand},${source},${document},0,${knowledge},24,${vector}::extensions.vector,${hash(knowledge)}) returning id`;
    chunk = String(kc?.id);
  });
  afterAll(async () => {
    if (!sql) return;
    if (organization && otherOrganization)
      await sql`delete from public.organizations where id in (${organization},${otherOrganization})`;
    if (communities.length)
      await sql`delete from public.subreddits where id in ${sql(communities)}`;
    await sql`delete from auth.users where id in ${sql(Object.values(actors))}`;
    await sql.end({ timeout: 3 });
  });

  it('deduplicates concurrent generation by request key and rejects key reuse with different input', async () => {
    const key = randomUUID();
    const ids = await Promise.all([request(key), request(key)]);
    expect(ids[0]).toBe(ids[1]);
    expect((await usage()).quantity).toBe(1);
    await expect(request(key, actors.member, { length: 'concise' })).rejects.toThrow(
      'IDEMPOTENCY_CONFLICT',
    );
    await expect(
      asUser(actors.member, (tx) => tx`select public.request_draft(${opportunity},null,'{}')`),
    ).rejects.toThrow('IDEMPOTENCY_KEY_REQUIRED');
    await expect(
      request(randomUUID(), actors.member, { organization_id: actors.other }),
    ).rejects.toThrow('INVALID_DRAFT_OPTIONS');
  });
  it('enforces tenant RLS, viewer read-only access, and private publication privileges', async () => {
    const id = await ready();
    for (const actor of [actors.viewer, actors.other])
      await expect(request(randomUUID(), actor)).rejects.toMatchObject({ code: '42501' });
    expect(
      await asUser(actors.viewer, (tx) => tx`select id from public.drafts where id=${id}`),
    ).toHaveLength(1);
    expect(
      await asUser(actors.other, (tx) => tx`select id from public.drafts where id=${id}`),
    ).toHaveLength(0);
    await expect(
      asUser(
        actors.viewer,
        (tx) => tx`select public.save_draft_edit(${id},1,'An unauthorized edit')`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(actors.member, (tx) => tx`update public.drafts set status='approved' where id=${id}`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(actors.member, (tx) => tx`select private.draft_context_checksum(${id})`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(
        actors.member,
        (tx) => tx`select lease_token from public.draft_jobs where draft_id=${id}`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(actors.other, (tx) => tx`select public.get_draft_review(${id})`),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('reserves the last draft unit atomically and reports central trial, Solo and Growth limits', async () => {
    await sql`insert into public.usage_counters(organization_id,metric,period_start,period_end,quantity)
      select organization_id,'ai_drafts',current_period_start,current_period_end,9 from public.subscriptions where organization_id=${organization}`;
    const result = await Promise.allSettled([request(), request()]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await usage()).toMatchObject({ quantity: 10, limit: 10, plan_key: 'trial' });
    await expect(request()).rejects.toThrow('DRAFT_LIMIT');
    for (const [plan, limit] of [
      ['solo', 60],
      ['growth', 300],
    ] as const) {
      await sql`update public.subscriptions set plan_key=${plan},status='active',current_period_start=now()+interval '1 second',current_period_end=now()+interval '30 days' where organization_id=${organization}`;
      expect(await usage()).toMatchObject({ quantity: 0, limit, plan_key: plan });
    }
  });
  it('blocks expired plans and unavailable, paused or deleted opportunities before spending', async () => {
    await sql`update public.subscriptions set current_period_end=now()-interval '1 second',current_period_start=now()-interval '7 days' where organization_id=${organization}`;
    await expect(request()).rejects.toThrow('TRIAL_EXPIRED');
    await sql`update public.subscriptions set current_period_end=now()+interval '7 days' where organization_id=${organization}`;
    await sql`update public.brand_subreddits set status='paused' where brand_id=${brand}`;
    await expect(request()).rejects.toThrow('SUBREDDIT_PAUSED');
    await sql`update public.brand_subreddits set status='active' where brand_id=${brand}`;
    await sql`update public.reddit_posts set is_locked=true where id=${post}`;
    await expect(request()).rejects.toThrow('OPPORTUNITY_BLOCKED');
    expect((await usage()).quantity).toBe(0);
  });
  it('records every generation stage and rebuilds tenant-scoped source provenance', async () => {
    const id = await ready();
    expect(await row(id)).toMatchObject({
      status: 'ready',
      current_version: 1,
      verified_version: 1,
      verification_status: 'pass',
      compliance_status: 'pass',
    });
    const [claim] =
      await sql`select provenance,evidence_kind from public.draft_claims where draft_id=${id}`;
    expect(claim?.provenance).toEqual([
      expect.objectContaining({
        chunk_id: chunk,
        source_id: source,
        document_id: document,
        title: 'Batch image API',
        excerpt: expect.stringContaining('ClarityScale AI supports'),
      }),
    ]);
    expect(claim?.evidence_kind).toBe('current_documentation');
    expect(JSON.stringify(claim?.provenance)).not.toContain('FORGED');
    expect(await sql`select id from public.ai_task_usage where draft_id=${id}`).toHaveLength(3);
    expect(
      await sql`select id from public.draft_jobs where draft_id=${id} and status='completed'`,
    ).toHaveLength(3);
  });
  it('requires responsible-use acceptance and approves only the exact verified version', async () => {
    const id = await ready();
    await expect(approve(id, 1, false, false)).rejects.toThrow('RESPONSIBLE_USE_REQUIRED');
    await expect(approve(id, 2)).rejects.toThrow('DRAFT_VERSION_CONFLICT');
    await approve(id);
    expect(await row(id)).toMatchObject({ status: 'approved', approved_by: actors.member });
    await asUser(actors.member, (tx) => tx`select public.record_draft_copy(${id},1)`);
    expect(
      await sql`select id from public.audit_logs where target_id=${id} and action in ('draft.generated','draft.verified','draft.approved','draft.copied')`,
    ).toHaveLength(4);
  });
  it.each(['unsupported', 'contradicted'])(
    'blocks %s claims even when provider claims verification and compliance passed',
    async (status) => {
      const id = await ready(status);
      expect(await row(id)).toMatchObject({
        status: 'blocked',
        verification_status: 'fail',
        compliance_status: 'blocked',
      });
      await expect(approve(id, 1, true)).rejects.toThrow('DRAFT_APPROVAL_BLOCKED');
    },
  );
  it('requires explicit acknowledgement for warnings and blocks failed mandatory checks', async () => {
    const warning = await ready('partial', true);
    await expect(approve(warning)).rejects.toThrow('WARNINGS_ACKNOWLEDGEMENT_REQUIRED');
    await approve(warning, 1, true);
    const blocked = await ready('verified', false, 'AFFILIATION_DISCLOSURE');
    await expect(approve(blocked, 1, true)).rejects.toThrow('DRAFT_APPROVAL_BLOCKED');
    expect(await row(blocked)).toMatchObject({ status: 'blocked' });
  });
  it('invalidates approval on autosave, preserves versions, and rejects stale competing edits', async () => {
    const id = await ready();
    await approve(id);
    const [edit] = await asUser(
      actors.member,
      (tx) =>
        tx`select public.save_draft_edit(${id},1,${`${content} Compare actual latency too.`}) as version`,
    );
    expect(edit?.version).toBe(2);
    expect(await row(id)).toMatchObject({
      status: 'editing',
      current_version: 2,
      verified_version: null,
      approved_at: null,
    });
    await expect(
      asUser(
        actors.admin,
        (tx) => tx`select public.save_draft_edit(${id},1,'Concurrent overwrite')`,
      ),
    ).rejects.toThrow('DRAFT_VERSION_CONFLICT');
    await expect(approve(id, 2)).rejects.toThrow('VERIFICATION_REQUIRED');
    const [restored] = await asUser(
      actors.member,
      (tx) => tx`select public.restore_draft_version(${id},2,1) as version`,
    );
    expect(restored?.version).toBe(3);
    expect(await sql`select id from public.draft_versions where draft_id=${id}`).toHaveLength(3);
    expect((await usage()).quantity).toBe(1);
    await verified(id);
    await approve(id, 3);
  });
  it('charges one unit per idempotent regeneration, and edits or verification do not spend draft units', async () => {
    const id = await ready();
    const key = randomUUID();
    const operation = () =>
      asUser(
        actors.member,
        (tx) =>
          tx`select public.regenerate_draft(${id},1,${key},' {"action":"shorter"}'::jsonb) as id`,
      );
    expect((await operation())[0]?.id).toBe((await operation())[0]?.id);
    expect((await usage()).quantity).toBe(2);
    await generated(id);
    await verified(id);
    expect((await row(id))?.current_version).toBe(2);
    await asUser(actors.member, (tx) => tx`select public.verify_draft(${id},2)`);
    await verified(id);
    expect((await usage()).quantity).toBe(2);
  });
  it('fences expired leases and context changes before writing generated content', async () => {
    const id = await request();
    const j = await lease(id, 'generate');
    await sql`update public.draft_jobs set lease_expires_at=now()-interval '1 second' where id=${j.id}`;
    const [expired] =
      await sql`select private.publish_draft_generation(${j.id},${j.token},${j.checksum},${sql.json(generation())}) as value`;
    expect(expired?.value).toBe(false);
    await sql`update public.draft_jobs set lease_expires_at=now()+interval '90 seconds' where id=${j.id}`;
    await sql`update public.knowledge_documents set is_included=false where id=${document}`;
    const [stale] =
      await sql`select private.publish_draft_generation(${j.id},${j.token},${j.checksum},${sql.json(generation())}) as value`;
    expect(stale?.value).toBe(false);
    expect((await row(id))?.current_version).toBe(0);
  });
  it('rejects foreign citation IDs and incomplete or duplicate compliance check sets', async () => {
    const id = await request();
    const j = await lease(id, 'generate');
    await expect(
      sql`select private.publish_draft_generation(${j.id},${j.token},${j.checksum},${sql.json(generation(content, [randomUUID()]))})`,
    ).rejects.toThrow('INVALID_KNOWLEDGE_REFERENCE');
    await sql`select private.publish_draft_generation(${j.id},${j.token},${j.checksum},${sql.json(generation())})`;
    const v = await lease(id, 'verify');
    await expect(
      sql`select private.publish_draft_verification(${v.id},${v.token},${v.checksum},${sql.json(verification('verified', [randomUUID()]))})`,
    ).rejects.toThrow('INVALID_KNOWLEDGE_REFERENCE');
    await sql`select private.publish_draft_verification(${v.id},${v.token},${v.checksum},${sql.json(verification())})`;
    const c = await lease(id, 'compliance');
    const invalid = compliance();
    invalid.checks.pop();
    await expect(
      sql`select private.publish_draft_compliance(${c.id},${c.token},${c.checksum},${sql.json(invalid)})`,
    ).rejects.toThrow('INVALID_DRAFT_COMPLIANCE');
    const duplicate = compliance();
    duplicate.checks = duplicate.checks.map((check) => ({ ...check, code: 'RELEVANCE' }));
    await expect(
      sql`select private.publish_draft_compliance(${c.id},${c.token},${c.checksum},${sql.json(duplicate)})`,
    ).rejects.toThrow('INVALID_DRAFT_COMPLIANCE');
  });
  it.each(['source', 'persona', 'rules', 'post', 'age'])(
    'refuses stale approval and copy after %s context changes',
    async (change) => {
      const id = await ready();
      await approve(id);
      if (change === 'source')
        await sql`update public.knowledge_documents set is_included=false where id=${document}`;
      if (change === 'persona')
        await sql`update public.brand_personas set default_disclosure='I am the founder of ClarityScale AI.' where brand_id=${brand}`;
      if (change === 'rules')
        await sql`insert into public.subreddit_rules(subreddit_id,provider_rule_id,title,description) values(${subreddit},'new-rule','No links','Do not share product links.')`;
      if (change === 'post')
        await sql`update public.reddit_posts set body='Changed question with new requirements.' where id=${post}`;
      if (change === 'age')
        await sql`update public.knowledge_sources set last_ingested_at=now()-interval '91 days' where id=${source}`;
      const [review] = await asUser(
        actors.member,
        (tx) => tx`select public.get_draft_review(${id}) as value`,
      );
      expect(review?.value).toMatchObject({ context_current: false });
      await expect(approve(id)).rejects.toThrow('DRAFT_CONTEXT_CHANGED');
      await expect(
        asUser(actors.member, (tx) => tx`select public.record_draft_copy(${id},1)`),
      ).rejects.toThrow('DRAFT_CONTEXT_CHANGED');
    },
  );
  it('stores per-member feedback and rejection while fencing pending work', async () => {
    const id = await ready();
    await asUser(
      actors.member,
      (tx) => tx`select public.submit_draft_feedback(${id},'useful','Helpful sources')`,
    );
    await asUser(
      actors.member,
      (tx) =>
        tx`select public.submit_draft_feedback(${id},'wrong_tone','Needs less technical language')`,
    );
    expect(await sql`select id from public.draft_feedback where draft_id=${id}`).toHaveLength(1);
    await asUser(
      actors.member,
      (tx) => tx`select public.reject_draft(${id},1,'Not useful for this question')`,
    );
    expect(await row(id)).toMatchObject({
      status: 'rejected',
      rejection_reason: 'Not useful for this question',
    });
    await expect(approve(id)).rejects.toThrow('DRAFT_REJECTED');
  });
  it('purges derived drafts, versions, evidence, checks, feedback and job instructions irreversibly', async () => {
    const id = await ready();
    await approve(id);
    await asUser(
      actors.member,
      (tx) =>
        tx`select public.submit_draft_feedback(${id},'useful','A quote from the Reddit question')`,
    );
    await sql`select private.purge_reddit_post(${post})`;
    expect(await row(id)).toMatchObject({
      status: 'blocked',
      current_content: '',
      strategy: '',
      generation_metadata: {},
      approved_at: null,
      error_code: 'POST_DELETED',
    });
    expect(
      await sql`select id from public.draft_versions where draft_id=${id} and (content<>'' or instruction<>'')`,
    ).toHaveLength(0);
    for (const table of ['draft_claims', 'draft_compliance_checks', 'draft_feedback'])
      expect(await sql`select id from ${sql(`public.${table}`)} where draft_id=${id}`).toHaveLength(
        0,
      );
    expect(
      await sql`select id from public.draft_jobs where draft_id=${id} and options<>'{}'::jsonb`,
    ).toHaveLength(0);
    await expect(
      asUser(
        actors.member,
        (tx) => tx`select public.save_draft_edit(${id},1,'Bring back deleted content')`,
      ),
    ).rejects.toThrow('POST_DELETED');
  });
  it.each(['dismissed', 'archived', 'refresh_stale', 'age_stale'])(
    'rejects %s opportunities for generation and approval',
    async (state) => {
      const id = await ready();
      if (state === 'dismissed' || state === 'archived')
        await sql`update public.opportunities set status=${state} where id=${opportunity}`;
      if (state === 'refresh_stale')
        await sql`update public.reddit_posts set last_synced_at=now()-interval '49 hours' where id=${post}`;
      if (state === 'age_stale')
        await sql`update public.reddit_posts set created_at_provider=now()-interval '31 days' where id=${post}`;
      const code = state.endsWith('stale') ? 'POST_STALE' : 'OPPORTUNITY_UNAVAILABLE';
      await expect(request()).rejects.toThrow(code);
      await expect(approve(id)).rejects.toThrow(code);
      const [review] = await asUser(
        actors.member,
        (tx) => tx`select public.get_draft_review(${id}) as value`,
      );
      expect(review?.value).toMatchObject({ context_current: false });
      expect((await usage()).quantity).toBe(1);
    },
  );

  it('serializes deletion behind in-flight publication and purges its newly written content', async () => {
    const id = await request();
    const job = await lease(id, 'generate');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired: () => void = () => undefined;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const publisher = sql.begin(async (tx) => {
      await tx`select id from public.organizations where id=${organization} for update`;
      await tx`select id from public.drafts where id=${id} for update`;
      acquired();
      await gate;
      const [result] =
        await tx`select private.publish_draft_generation(${job.id},${job.token},${job.checksum},${tx.json(generation())}) as value`;
      expect(result?.value).toBe(true);
    });
    await locked;
    let started: (pid: number) => void = () => undefined;
    const startedPurge = new Promise<number>((resolve) => {
      started = resolve;
    });
    const purge = sql.begin(async (tx) => {
      const [connection] = await tx`select pg_backend_pid() as pid`;
      started(Number(connection?.pid));
      await tx`select private.purge_reddit_post(${post})`;
    });
    const pid = await startedPurge;
    try {
      await expect
        .poll(
          async () => {
            const [waiting] = await sql`select cardinality(pg_blocking_pids(${pid}))>0 as value`;
            return waiting?.value;
          },
          { timeout: 3000, interval: 20 },
        )
        .toBe(true);
    } finally {
      release();
    }
    await Promise.all([publisher, purge]);
    expect((await row(id))?.current_content).toBe('');
    expect(
      await sql`select id from public.draft_versions where draft_id=${id} and content<>''`,
    ).toHaveLength(0);
    expect(
      await sql`select id from public.draft_jobs where draft_id=${id} and status in ('queued','processing')`,
    ).toHaveLength(0);
  });

  it('refuses feedback that raced with a committed content purge', async () => {
    const id = await ready();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired: () => void = () => undefined;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const purge = sql.begin(async (tx) => {
      await tx`select private.purge_reddit_post(${post})`;
      acquired();
      await gate;
    });
    await locked;
    let started: (pid: number) => void = () => undefined;
    const startedFeedback = new Promise<number>((resolve) => {
      started = resolve;
    });
    const feedback = asUser(actors.member, async (tx) => {
      const [connection] = await tx`select pg_backend_pid() as pid`;
      started(Number(connection?.pid));
      return tx`select public.submit_draft_feedback(${id},'useful','A copied Reddit sentence')`;
    }).then(
      () => 'unexpected-success',
      (error: unknown) => (error instanceof Error ? error.message : 'unknown-error'),
    );
    const pid = await startedFeedback;
    try {
      await expect
        .poll(
          async () => {
            const [waiting] = await sql`select cardinality(pg_blocking_pids(${pid}))>0 as value`;
            return waiting?.value;
          },
          { timeout: 3000, interval: 20 },
        )
        .toBe(true);
    } finally {
      release();
    }
    await purge;
    expect(await feedback).toBe('POST_DELETED');
    expect(await sql`select id from public.draft_feedback where draft_id=${id}`).toHaveLength(0);
  });

  it('preserves persona identity through brand updates and restricts persona changes to managers', async () => {
    const [before] = await sql`select id from public.brand_personas where brand_id=${brand}`;
    const input = {
      name: 'Product engineer',
      real_role: 'employee',
      tone: 'Technical',
      custom_tone: '',
      reply_length: 'standard',
      technical_depth: 'technical',
      default_disclosure: demoBrand.disclosure_text,
      allowed_first_person_statements: ['I work with this product team.'],
      prohibited_statements: ['I am an independent customer.'],
    };
    await asUser(
      actors.admin,
      (tx) => tx`select public.update_brand_persona(${brand},${tx.json(input)})`,
    );
    await expect(
      asUser(
        actors.member,
        (tx) => tx`select public.update_brand_persona(${brand},${tx.json(input)})`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await asUser(
      actors.owner,
      (tx) => tx`select public.save_brand(${organization},${brand},${tx.json(profile)})`,
    );
    const [after] =
      await sql`select id,technical_depth,allowed_first_person_statements from public.brand_personas where brand_id=${brand}`;
    expect(after?.id).toBe(before?.id);
    expect(after?.technical_depth).toBe('technical');
    expect(after?.allowed_first_person_statements).toEqual(input.allowed_first_person_statements);
  });
});
