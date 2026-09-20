import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { startAnalyticsWorker } from '../../apps/worker/src/jobs/analytics';
import { parseWorkerConfig } from '../../apps/worker/src/config';
import { localEnvironment } from '../../scripts/isolation.mjs';
import { attributionStatements } from '../../apps/web/src/lib/phase6/statements';
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
  input_checksum: hash('phase5 evaluation'),
};

describe('Phase 6 attribution database boundaries', () => {
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
  const clickEventTimes = new Map<string, string>();

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
  beforeAll(async () => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 6, connect_timeout: 5, onnotice: () => {} });
    for (const actor of Object.values(actors))
      await sql`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(${actor},${`${actor}@phase6.example`},now(),'{}')`;
    for (const actor of [actors.owner, actors.other]) {
      const [r] = await asUser(
        actor,
        (tx) =>
          tx`select public.create_organization('Draft fixtures',${`phase6-${actor}`},${`${actor}@phase6.example`}) as id`,
      );
      if (actor === actors.owner) organization = String(r?.id);
      else otherOrganization = String(r?.id);
    }
    for (const role of ['admin', 'member', 'viewer'] as const)
      await sql`insert into public.organization_members(organization_id,user_id,role) values(${organization},${actors[role]},${role})`;
  });
  beforeEach(async () => {
    clickEventTimes.clear();
    await sql`delete from public.tracking_settings where organization_id in (${organization},${otherOrganization})`;
    await sql`delete from public.analytics_cache where organization_id in (${organization},${otherOrganization})`;
    await sql`update public.organizations set status='active',deleted_at=null where id=${organization}`;
    for (const role of ['admin', 'member', 'viewer'] as const)
      await sql`insert into public.organization_members(organization_id,user_id,role) values(${organization},${actors[role]},${role}) on conflict(organization_id,user_id) do update set role=excluded.role`;
    await sql`delete from public.brands where organization_id in (${organization},${otherOrganization})`;
    if (communities.length)
      await sql`delete from public.subreddits where id in ${sql(communities)}`;
    communities.length = 0;
    await sql`delete from public.usage_counters where organization_id=${organization}`;
    await sql`delete from public.responsible_use_acceptances where organization_id=${organization}`;
    await sql`update public.subscriptions set plan_key='growth',status='active',current_period_start=now(),current_period_end=now()+interval '7 days' where organization_id=${organization}`;
    const [b] = await asUser(
      actors.owner,
      (tx) => tx`select public.save_brand(${organization},null,${tx.json(profile)}) as id`,
    );
    brand = String(b?.id);
    const name = `p6_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
    const [s] =
      await sql`insert into public.subreddits(name,display_name) values(${name},${name}) returning id`;
    subreddit = String(s?.id);
    communities.push(subreddit);
    await sql`insert into public.brand_subreddits(organization_id,brand_id,subreddit_id) values(${organization},${brand},${subreddit})`;
    const providerId = randomUUID().replaceAll('-', '').slice(0, 12);
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

  async function asTracking<T>(operation: (tx: postgres.TransactionSql) => Promise<T>) {
    return sql.begin(async (tx) => {
      await tx`set local role threadsignal_tracking_api`;
      return operation(tx);
    });
  }
  async function approved() {
    const id = await ready();
    await approve(id);
    return id;
  }
  async function link(
    draft?: string,
    actor = actors.member,
    destination = 'https://clarityscale.example/docs?utm_source=customer',
  ) {
    const id = draft ?? (await approved());
    const code = randomUUID().replaceAll('-', '').slice(0, 16);
    const [r] = await asUser(
      actor,
      (tx) =>
        tx`select public.create_tracking_link(${organization},${id},1,${code},${destination},'{}',false) as value`,
    );
    return r?.value as {
      id: string;
      code: string;
      draft_id: string;
      utm_config: Record<string, string>;
      destination_url: string;
    };
  }
  async function click(code: string, visitor: string | null = null) {
    const id = randomUUID();
    const receipt = hash(randomUUID());
    const [r] = await asTracking(
      (tx) =>
        tx`select private.tracking_redirect(${code},${id},${receipt},${visitor},true) as value`,
    );
    const [record] = await sql`select occurred_at from public.tracking_clicks where id=${id}`;
    // Use the same clock as the persisted click. The host and Colima clocks can
    // differ by milliseconds; the additional millisecond preserves PostgreSQL's
    // submillisecond ordering when its timestamp becomes a JavaScript Date.
    clickEventTimes.set(id, new Date(new Date(record?.occurred_at).getTime() + 1).toISOString());
    return {
      id,
      receipt,
      ...(r?.value as { brand_id: string; destination_url: string; attribution_days: number }),
    };
  }
  async function key(actor = actors.owner, replaces: string | null = null) {
    const keyHash = hash(randomUUID());
    const [r] = await asUser(
      actor,
      (tx) =>
        tx`select public.create_conversion_api_key(${organization},${brand},'Integration key','tsk_abcdefgh',${keyHash},${replaces}) as value`,
    );
    return { hash: keyHash, ...(r?.value as { id: string; key_prefix: string }) };
  }
  function event(clickId: string, type = 'signup', extra: Record<string, postgres.JSONValue> = {}) {
    return {
      clickId,
      event: type,
      externalId: randomUUID(),
      value: type === 'purchase' ? 99 : 0,
      currency: 'USD',
      occurredAt: clickEventTimes.get(clickId) ?? new Date().toISOString(),
      metadata: {},
      ...extra,
    };
  }
  async function convert(
    keyHash: string | null,
    data: Record<string, postgres.JSONValue>,
    receipt: string | null = null,
    origin: string | null = null,
    fixture = false,
  ) {
    const [r] = await asTracking(
      (tx) =>
        tx`select private.ingest_conversion(${keyHash},${receipt},${origin},${tx.json(data)},${fixture}) as value`,
    );
    return r?.value as { id: string; duplicate: boolean };
  }
  async function analytics(
    filters: Record<string, string> = {},
    actor = actors.viewer,
    org = organization,
  ) {
    const [r] = await asUser(
      actor,
      (tx) => tx`select public.get_attribution_analytics(${org},${tx.json(filters)}) as value`,
    );
    return r?.value as {
      metrics: {
        opportunities: number;
        high_intent: number;
        drafts: number;
        approved_drafts: number;
        published: number;
        clicks: number;
        unique_clicks: number;
        signups: number;
        purchases: number;
        approval_rate: number;
        click_to_signup_rate: number;
        signup_to_purchase_rate: number;
        revenue: { currency: string; value: number }[];
      };
      timeseries: { date: string; clicks: number }[];
      breakdowns: Record<
        string,
        { id: string; clicks: number; revenue: { currency: string; value: number }[] }[]
      >;
      attribution_days: number;
    };
  }

  it('creates an approved tenant-bound link with canonical UTMs and safe metadata', async () => {
    const l = await link();
    expect(l.utm_config).toEqual({
      utm_source: 'reddit',
      utm_medium: 'community',
      utm_campaign: 'threadsignal',
      utm_content: opportunity,
    });
    const [record] = await sql`select * from public.tracking_links where id=${l.id}`;
    expect(record?.organization_id).toBe(organization);
    expect(record?.draft_version).toBe(1);
    expect(record?.draft_style).toBe(profile.tone);
  });
  it('rejects viewers, another tenant, unapproved drafts and stale versions', async () => {
    const d = await ready();
    await expect(link(d)).rejects.toThrow('DRAFT_NOT_APPROVED');
    await approve(d);
    await expect(link(d, actors.viewer)).rejects.toThrow('FORBIDDEN');
    await expect(link(d, actors.other)).rejects.toThrow('FORBIDDEN');
    await expect(
      asUser(
        actors.member,
        (tx) =>
          tx`select public.create_tracking_link(${organization},${d},2,'abcdefghijklmnop','https://clarityscale.example/docs','{}',false)`,
      ),
    ).rejects.toThrow('DRAFT_VERSION_CONFLICT');
  });
  it('rejects lookalike hosts, private URLs, credentials, odd ports and arbitrary UTMs', async () => {
    const d = await approved();
    for (const url of [
      'https://clarityscale.example.evil.example/docs',
      'https://evil.example/',
      'http://127.0.0.1:3000/tracking-fixture',
      'https://user@clarityscale.example/',
      'https://clarityscale.example:444/',
    ])
      await expect(link(d, actors.member, url)).rejects.toThrow('TRACKING_DESTINATION_DENIED');
    await expect(
      asUser(
        actors.member,
        (tx) =>
          tx`select public.create_tracking_link(${organization},${d},1,'abcdefghijklmnop','https://clarityscale.example/docs','{"email":"private"}',false)`,
      ),
    ).rejects.toThrow('INVALID_TRACKING_LINK');
  });
  it('revalidates approved domains and archive state before each redirect', async () => {
    const l = await link();
    await sql`update public.brands set website_url='https://changed.example',profile=jsonb_set(profile,'{allowed_links}','[]') where id=${brand}`;
    await expect(click(l.code)).rejects.toThrow('TRACKING_DESTINATION_DENIED');
    await sql`update public.brands set website_url='https://clarityscale.example',status='archived' where id=${brand}`;
    await expect(click(l.code)).rejects.toThrow('TRACKING_DESTINATION_DENIED');
    expect(
      (
        await sql`select count(*)::integer as n from public.tracking_clicks where tracking_link_id=${l.id}`
      )[0]?.n,
    ).toBe(0);
  });
  it('records only privacy-minimal clicks and validates previews without counting', async () => {
    const l = await link();
    const [preview] = await asTracking(
      (tx) => tx`select private.tracking_redirect(${l.code},null,null,null,false) as value`,
    );
    expect(preview?.value.click_id).toBeNull();
    await click(l.code);
    expect((await analytics()).metrics.clicks).toBe(1);
    const columns =
      await sql`select column_name from information_schema.columns where table_schema='public' and table_name='tracking_clicks'`;
    expect(columns.map((c) => c.column_name)).not.toEqual(
      expect.arrayContaining(['ip_address', 'user_agent', 'referrer']),
    );
    await expect(
      asUser(actors.owner, (tx) => tx`select receipt_hash from public.tracking_clicks`),
    ).rejects.toThrow('permission denied');
    await expect(
      asUser(actors.owner, (tx) => tx`select anonymous_visitor_id from public.tracking_clicks`),
    ).rejects.toThrow('permission denied');
  });
  it('revoke stops redirects and conversions without deleting existing metrics', async () => {
    const l = await link();
    const c = await click(l.code);
    const k = await key();
    await asUser(
      actors.member,
      (tx) => tx`select public.revoke_tracking_link(${organization},${l.id})`,
    );
    await expect(click(l.code)).rejects.toThrow('TRACKING_LINK_UNAVAILABLE');
    await expect(convert(k.hash, event(c.id))).rejects.toThrow('TRACKING_LINK_UNAVAILABLE');
    expect((await analytics()).metrics.clicks).toBe(1);
  });
  it('enforces click, browser conversion and server API plan features independently', async () => {
    await sql`update public.subscriptions set plan_key='trial',status='trialing' where organization_id=${organization}`;
    const l = await link();
    const c = await click(l.code);
    await expect(key()).rejects.toThrow('TRACKING_PLAN_REQUIRED');
    await expect(
      convert(
        null,
        event(c.id, 'signup', { consent: true }),
        c.receipt,
        'https://clarityscale.example',
      ),
    ).rejects.toThrow('TRACKING_PLAN_REQUIRED');
    await sql`update public.subscriptions set plan_key='solo',status='active' where organization_id=${organization}`;
    await expect(key()).rejects.toThrow('TRACKING_PLAN_REQUIRED');
    await expect(
      convert(
        null,
        event(c.id, 'signup', { consent: true }),
        c.receipt,
        'https://clarityscale.example',
      ),
    ).resolves.toMatchObject({ duplicate: false });
    await sql`update public.subscriptions set current_period_start=now()-interval '1 day',current_period_end=now()-interval '1 second' where organization_id=${organization}`;
    await expect(click(l.code)).rejects.toThrow('PLAN_INACTIVE');
  });
  it('only managers create/rotate/revoke keys, hash values stay unreadable', async () => {
    await expect(key(actors.member)).rejects.toThrow('FORBIDDEN');
    await expect(key(actors.viewer)).rejects.toThrow('FORBIDDEN');
    const old = await key(actors.admin);
    const replacement = await key(actors.owner, old.id);
    expect(replacement.id).not.toBe(old.id);
    expect(
      (await sql`select revoked_at from public.conversion_api_keys where id=${old.id}`)[0]
        ?.revoked_at,
    ).not.toBeNull();
    await expect(
      asUser(actors.owner, (tx) => tx`select key_hash from public.conversion_api_keys`),
    ).rejects.toThrow('permission denied');
    const [listed] = await asUser(
      actors.owner,
      (tx) => tx`select public.list_conversion_api_keys(${organization},${brand}) as value`,
    );
    expect(JSON.stringify(listed?.value)).not.toContain(old.hash);
    await asUser(
      actors.admin,
      (tx) => tx`select public.revoke_conversion_api_key(${organization},${replacement.id})`,
    );
    const c = await click((await link()).code);
    await expect(convert(old.hash, event(c.id))).rejects.toThrow('CONVERSION_KEY_INVALID');
    await expect(convert(replacement.hash, event(c.id))).rejects.toThrow('CONVERSION_KEY_INVALID');
  });
  it('requires browser consent, correct proof, exact origin and matching brand', async () => {
    const c = await click((await link()).code);
    await expect(
      convert(null, event(c.id), c.receipt, 'https://clarityscale.example'),
    ).rejects.toThrow('CONVERSION_CONSENT_REQUIRED');
    await expect(
      convert(
        null,
        event(c.id, 'signup', { consent: true }),
        hash('forged'),
        'https://clarityscale.example',
      ),
    ).rejects.toThrow('CONVERSION_RECEIPT_INVALID');
    for (const origin of [
      'https://evil.example',
      'null',
      'https://clarityscale.example.evil.example',
      'https://clarityscale.example/path',
    ])
      await expect(
        convert(null, event(c.id, 'signup', { consent: true }), c.receipt, origin),
      ).rejects.toThrow('CONVERSION_ORIGIN_DENIED');
    await expect(
      convert(
        null,
        event(c.id, 'signup', { consent: true, brandId: randomUUID() }),
        c.receipt,
        'https://clarityscale.example',
      ),
    ).rejects.toThrow('CONVERSION_CLICK_INVALID');
    await expect(
      convert(
        null,
        event(c.id, 'signup', { consent: true, brandId: brand }),
        c.receipt,
        'https://clarityscale.example',
      ),
    ).resolves.toMatchObject({ duplicate: false });
  });
  it('fixture origin needs a private runtime flag and reserved synthetic destination', async () => {
    const l = await link();
    const c = await click(l.code);
    await expect(
      convert(null, event(c.id, 'signup', { consent: true }), c.receipt, 'http://127.0.0.1:3000'),
    ).rejects.toThrow('CONVERSION_ORIGIN_DENIED');
    await expect(
      convert(
        null,
        event(c.id, 'signup', { consent: true }),
        c.receipt,
        'http://127.0.0.1:3000',
        true,
      ),
    ).resolves.toMatchObject({ duplicate: false });
    await sql`update public.brands set website_url='https://another.example',profile=jsonb_set(profile,'{allowed_links}','[]') where id=${brand}`;
    await sql`update public.tracking_links set destination_url='https://another.example/docs' where id=${l.id}`;
    await expect(
      convert(
        null,
        event(c.id, 'lead', { consent: true }),
        c.receipt,
        'http://127.0.0.1:3000',
        true,
      ),
    ).rejects.toThrow('CONVERSION_ORIGIN_DENIED');
  });
  it('validates supported currencies, precision, nonnegative amounts and bounded metadata', async () => {
    const c = await click((await link()).code);
    const k = await key();
    for (const fields of [
      { currency: 'XYZ' },
      { currency: 'usd' },
      { value: -1 },
      { value: 1000000001 },
      { currency: 'USD', value: 0.001 },
      { currency: 'JPY', value: 1.1 },
      { currency: 'KWD', value: 1.0001 },
    ])
      await expect(convert(k.hash, event(c.id, 'purchase', fields))).rejects.toThrow(
        /INVALID_CONVERSION/,
      );
    for (const metadata of [
      { email: 'private@example.com' },
      { plan: 'private@example.com' },
      { customName: 'https://example.com/private' },
    ])
      await expect(convert(k.hash, event(c.id, 'purchase', { metadata }))).rejects.toThrow(
        'INVALID_CONVERSION_METADATA',
      );
    await expect(convert(k.hash, event(c.id, 'custom'))).rejects.toThrow(
      'INVALID_CONVERSION_METADATA',
    );
    await expect(
      convert(
        k.hash,
        event(c.id, 'custom', { metadata: { customName: 'Activated integration', plan: 'pro' } }),
      ),
    ).resolves.toMatchObject({ duplicate: false });
    await expect(
      convert(k.hash, event(c.id, 'purchase', { currency: 'KWD', value: 1.001 })),
    ).resolves.toMatchObject({ duplicate: false });
  });
  it('deduplicates concurrent events and rejects conflicting payload reuse', async () => {
    const c = await click((await link()).code);
    const k = await key();
    const input = event(c.id, 'purchase');
    const receipts = await Promise.all([convert(k.hash, input), convert(k.hash, input)]);
    expect(receipts.map((r) => r.duplicate).sort()).toEqual([false, true]);
    expect(receipts[0]?.id).toBe(receipts[1]?.id);
    await expect(convert(k.hash, { ...input, value: 100 })).rejects.toThrow(
      'CONVERSION_IDEMPOTENCY_CONFLICT',
    );
    expect((await analytics()).metrics.revenue).toEqual([{ currency: 'USD', value: 99 }]);
  });
  it('requires deduplication and honors idempotency across event types', async () => {
    const c = await click((await link()).code);
    const k = await key();
    const idempotencyKey = randomUUID();
    const input = event(c.id, 'signup', { externalId: null, idempotencyKey });
    await expect(convert(k.hash, event(c.id, 'signup', { externalId: null }))).rejects.toThrow(
      'CONVERSION_DEDUPE_REQUIRED',
    );
    expect((await convert(k.hash, input)).duplicate).toBe(false);
    expect((await convert(k.hash, input)).duplicate).toBe(true);
    await expect(convert(k.hash, { ...input, event: 'lead' })).rejects.toThrow(
      'CONVERSION_IDEMPOTENCY_CONFLICT',
    );
  });
  it('binds production JSON string arguments as objects through the restricted database bridge', async () => {
    const c = await click((await link()).code);
    const k = await key();
    const input = event(c.id, 'purchase');
    const deliver = () =>
      asTracking((tx) =>
        tx.unsafe(attributionStatements.conversion, [
          k.hash,
          null,
          null,
          JSON.stringify(input),
          false,
        ]),
      );
    const [first] = await deliver();
    expect(first?.value).toMatchObject({ duplicate: false });
    const [retry] = await deliver();
    expect(retry?.value).toEqual({ id: first?.value.id, duplicate: true });
    const [browser] = await asTracking((tx) =>
      tx.unsafe(attributionStatements.conversion, [
        null,
        c.receipt,
        'https://clarityscale.example',
        JSON.stringify(event(c.id, 'signup', { brandId: brand, consent: true })),
        false,
      ]),
    );
    expect(browser?.value).toMatchObject({ duplicate: false });
    expect((await analytics()).metrics).toMatchObject({
      signups: 1,
      purchases: 1,
      revenue: [{ currency: 'USD', value: 99 }],
    });
  });
  it('enforces ordered timestamps and the configurable attribution window', async () => {
    const c = await click((await link()).code);
    const k = await key();
    await expect(
      convert(
        k.hash,
        event(c.id, 'signup', { occurredAt: new Date(Date.now() + 6 * 60_000).toISOString() }),
      ),
    ).rejects.toThrow('INVALID_CONVERSION_TIME');
    await expect(
      convert(k.hash, event(c.id, 'signup', { occurredAt: '2000-01-01T00:00:00Z' })),
    ).rejects.toThrow('CONVERSION_OUTSIDE_WINDOW');
    await asUser(
      actors.admin,
      (tx) =>
        tx`select public.update_tracking_settings(${organization},1,'Allow this explicitly consented attribution.')`,
    );
    await sql`update public.tracking_clicks set occurred_at=now()-interval '2 days' where id=${c.id}`;
    await expect(convert(k.hash, event(c.id))).rejects.toThrow('CONVERSION_OUTSIDE_WINDOW');
    await asUser(
      actors.owner,
      (tx) =>
        tx`select public.update_tracking_settings(${organization},3,'Allow this explicitly consented attribution.')`,
    );
    await expect(convert(k.hash, event(c.id))).resolves.toMatchObject({ duplicate: false });
    expect((await analytics()).attribution_days).toBe(3);
    await expect(
      asUser(
        actors.member,
        (tx) =>
          tx`select public.update_tracking_settings(${organization},30,'Not permitted for members.')`,
      ),
    ).rejects.toThrow('FORBIDDEN');
    await expect(
      asUser(
        actors.owner,
        (tx) =>
          tx`select public.update_tracking_settings(${organization},91,'Invalid attribution window.')`,
      ),
    ).rejects.toThrow('INVALID_TRACKING_SETTINGS');
  });
  it('does not inflate counts when a click has several conversions and currencies', async () => {
    const l = await link();
    const c = await click(l.code);
    const c2 = await click(l.code);
    const k = await key();
    await convert(k.hash, event(c.id));
    await convert(k.hash, event(c.id, 'signup'));
    await convert(k.hash, event(c.id, 'purchase'));
    await convert(k.hash, event(c.id, 'purchase', { currency: 'EUR', value: 20 }));
    await convert(k.hash, event(c2.id, 'lead'));
    const report = await analytics();
    expect(report.metrics).toMatchObject({
      opportunities: 1,
      high_intent: 1,
      drafts: 1,
      approved_drafts: 1,
      approval_rate: 100,
      clicks: 2,
      unique_clicks: 2,
      signups: 2,
      purchases: 2,
      click_to_signup_rate: 50,
      signup_to_purchase_rate: 100,
    });
    expect(report.metrics.revenue).toEqual([
      { currency: 'EUR', value: 20 },
      { currency: 'USD', value: 99 },
    ]);
    expect(report.breakdowns.subreddits?.[0]?.clicks).toBe(2);
    expect(report.timeseries.reduce((n, d) => n + d.clicks, 0)).toBe(2);
    const filtered = await analytics({ event: 'purchase' });
    expect(filtered.metrics.signups).toBe(0);
    expect(filtered.metrics.clicks).toBe(2);
    expect(filtered.metrics.purchases).toBe(2);
  });
  it('filters each dimension and denies tenant data to nonmembers', async () => {
    const c = await click((await link()).code);
    const k = await key();
    await convert(k.hash, event(c.id, 'purchase'));
    for (const filters of [
      { brand_id: brand },
      { subreddit_id: subreddit },
      { opportunity_id: opportunity },
      { intent: 'recommendation' },
      { style: profile.tone },
    ])
      expect((await analytics(filters)).metrics.clicks).toBe(1);
    expect((await analytics({ brand_id: randomUUID() })).metrics.clicks).toBe(0);
    expect((await analytics({ intent: 'support' })).metrics.clicks).toBe(0);
    await expect(analytics({}, actors.other)).rejects.toThrow('FORBIDDEN');
    expect((await analytics({}, actors.other, otherOrganization)).metrics.clicks).toBe(0);
    const rows = await asUser(
      actors.other,
      (tx) => tx`select id from public.tracking_clicks where organization_id=${organization}`,
    );
    expect(rows).toHaveLength(0);
    await expect(analytics({ from: '2026-01-01', to: '2026-12-31' })).rejects.toThrow(
      'INVALID_ANALYTICS_RANGE',
    );
  });
  it('keeps ingestion role function-only and anonymous callers powerless', async () => {
    await expect(asTracking((tx) => tx`select * from public.tracking_links`)).rejects.toThrow(
      'permission denied',
    );
    await expect(asTracking((tx) => tx`select * from auth.users`)).rejects.toThrow(
      'permission denied',
    );
    await expect(
      asTracking((tx) => tx`select public.get_attribution_analytics(${organization},'{}')`),
    ).rejects.toThrow('permission denied');
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role anon`;
        return tx`select private.tracking_redirect('abcdefghijklmnop',null,null,null,false)`;
      }),
    ).rejects.toThrow('permission denied');
    const [role] =
      await sql`select rolcanlogin,rolinherit,rolbypassrls from pg_roles where rolname='threadsignal_tracking_api'`;
    expect(role).toMatchObject({ rolcanlogin: false, rolinherit: false, rolbypassrls: false });
  });
  it('refreshes bounded idempotent aggregate caches and invalidates them on new activity', async () => {
    const l = await link();
    await click(l.code);
    // The bounded worker may first refresh older workspaces; all results remain real aggregates.
    for (let attempt = 0; attempt < 20; attempt++) {
      await sql`select private.refresh_attribution_analytics(10)`;
      if (
        (
          await sql`select 1 from public.analytics_cache where organization_id=${organization} and not stale`
        ).length
      )
        break;
    }
    const [cached] =
      await sql`select report,stale from public.analytics_cache where organization_id=${organization}`;
    expect(cached?.stale).toBe(false);
    expect(cached?.report.metrics.clicks).toBe(1);
    expect((await analytics()).metrics.clicks).toBe(1);
    await click(l.code);
    expect(
      (await sql`select stale from public.analytics_cache where organization_id=${organization}`)[0]
        ?.stale,
    ).toBe(true);
    expect((await analytics()).metrics.clicks).toBe(2);
    for (let attempt = 0; attempt < 20; attempt++) {
      await sql`select private.refresh_attribution_analytics(10)`;
      if (
        (
          await sql`select 1 from public.analytics_cache where organization_id=${organization} and not stale`
        ).length
      )
        break;
    }
    expect(
      (
        await sql`select report from public.analytics_cache where organization_id=${organization}`
      )[0]?.report.metrics.clicks,
    ).toBe(2);
    await expect(sql`select private.refresh_attribution_analytics(100)`).rejects.toThrow(
      'INVALID_ANALYTICS_BATCH',
    );
  });
  it('preflight authorizes only active conversion-plan brand origins without disclosing a brand', async () => {
    async function allowed(id: string | null, origin: string, fixture = false) {
      const [r] = await asTracking(
        (tx) =>
          tx`select private.tracking_browser_origin_allowed(${id},${origin},${fixture}) as allowed`,
      );
      return r?.allowed;
    }
    expect(await allowed(brand, 'https://clarityscale.example')).toBe(true);
    expect(await allowed(null, 'https://clarityscale.example')).toBe(true);
    expect(await allowed(randomUUID(), 'https://clarityscale.example')).toBe(false);
    expect(await allowed(brand, 'https://clarityscale.example.evil.example')).toBe(false);
    expect(await allowed(brand, 'http://127.0.0.1:3000')).toBe(false);
    expect(await allowed(brand, 'http://127.0.0.1:3000', true)).toBe(true);
    await sql`update public.subscriptions set plan_key='trial',status='trialing' where organization_id=${organization}`;
    expect(await allowed(brand, 'https://clarityscale.example')).toBe(false);
    await expect(
      asUser(
        actors.owner,
        (tx) =>
          tx`select private.tracking_browser_origin_allowed(${brand},'https://clarityscale.example',true)`,
      ),
    ).rejects.toThrow('permission denied');
  });
  it('rejects keys from another brand even when the authenticated account owns both', async () => {
    const c = await click((await link()).code);
    const [b2] = await asUser(
      actors.owner,
      (tx) =>
        tx`select public.save_brand(${organization},null,${tx.json({ ...profile, name: 'Another private brand' })}) as id`,
    );
    const secondHash = hash(randomUUID());
    await asUser(
      actors.owner,
      (tx) =>
        tx`select public.create_conversion_api_key(${organization},${String(b2?.id)},'Other brand','tsk_abcdefgh',${secondHash},null)`,
    );
    await expect(convert(secondHash, event(c.id))).rejects.toThrow('CONVERSION_KEY_INVALID');
    expect((await analytics()).metrics.signups).toBe(0);
  });
  it('counts a supplied consented anonymous visitor once, never raw network identifiers', async () => {
    const l = await link();
    const anonymousHash = hash(randomUUID());
    await click(l.code, anonymousHash);
    await click(l.code, anonymousHash);
    expect((await analytics()).metrics).toMatchObject({ clicks: 2, unique_clicks: 1 });
    await expect(click(l.code, '192.0.2.1')).rejects.toThrow('INVALID_TRACKING_CLICK');
    const c = await click(l.code);
    await expect(
      asTracking(
        (tx) => tx`select private.tracking_redirect(${l.code},${c.id},${c.receipt},null,true)`,
      ),
    ).rejects.toThrow('duplicate key');
  });
  it('bounds active key/link allocation and rolls failed rotations back atomically', async () => {
    const d = await approved();
    for (let index = 0; index < 20; index++) await link(d);
    await expect(link(d)).rejects.toThrow('TRACKING_LINK_LIMIT');
    const first = await key();
    for (let index = 0; index < 4; index++) await key();
    await expect(key()).rejects.toThrow('CONVERSION_KEY_LIMIT');
    const replacement = await key(actors.owner, first.id);
    expect(replacement.id).not.toBe(first.id);
    await expect(key(actors.owner, first.id)).rejects.toThrow('CONVERSION_KEY_NOT_FOUND');
    const [count] =
      await sql`select count(*)::integer as n from public.conversion_api_keys where brand_id=${brand} and revoked_at is null`;
    expect(count?.n).toBe(5);
  });
  it('gates advanced filters and prevents stale cache reads after plan downgrade', async () => {
    await click((await link()).code);
    expect((await analytics()).breakdowns.styles?.length).toBeGreaterThan(0);
    await sql`select private.refresh_attribution_analytics(10)`;
    await sql`update public.subscriptions set plan_key='solo',status='active' where organization_id=${organization}`;
    const report = await analytics();
    expect(report.breakdowns.styles).toEqual([]);
    expect(report.breakdowns.competitors).toEqual([]);
    expect(report.metrics.clicks).toBe(1);
    await expect(analytics({ style: profile.tone })).rejects.toThrow(
      'ADVANCED_ANALYTICS_PLAN_REQUIRED',
    );
    await expect(analytics({ competitor_id: randomUUID() })).rejects.toThrow(
      'ADVANCED_ANALYTICS_PLAN_REQUIRED',
    );
    await expect(
      asUser(
        actors.owner,
        (tx) => tx`select report from public.analytics_cache where organization_id=${organization}`,
      ),
    ).rejects.toThrow('permission denied');
  });
  it('returns an existing receipt after the attribution window expires without recounting', async () => {
    const c = await click((await link()).code);
    const k = await key();
    const input = event(c.id, 'purchase');
    const first = await convert(k.hash, input);
    await sql`update public.tracking_clicks set occurred_at=now()-interval '31 days' where id=${c.id}`;
    expect(await convert(k.hash, input)).toEqual({ id: first.id, duplicate: true });
    await expect(convert(k.hash, event(c.id, 'purchase'))).rejects.toThrow(
      'CONVERSION_OUTSIDE_WINDOW',
    );
    expect((await analytics()).metrics.purchases).toBe(1);
  });
  it('accepts valid late server deliveries while browser receipts expire on receipt time', async () => {
    const c = await click((await link()).code);
    const k = await key();
    await sql`update public.tracking_clicks set occurred_at=now()-interval '31 days' where id=${c.id}`;
    const occurredAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await expect(convert(k.hash, event(c.id, 'purchase', { occurredAt }))).resolves.toMatchObject({
      duplicate: false,
    });
    await expect(
      convert(
        null,
        event(c.id, 'signup', { occurredAt, consent: true }),
        c.receipt,
        'https://clarityscale.example',
      ),
    ).rejects.toThrow('CONVERSION_OUTSIDE_WINDOW');
    expect((await analytics()).metrics.revenue).toEqual([{ currency: 'USD', value: 99 }]);
  });
  it('rejects numeric host alternatives and malformed labels even through direct authenticated RPCs', async () => {
    const d = await approved();
    for (const host of [
      '127.1',
      '127.0x1',
      '0x7f.0x1',
      '2130706433',
      '0x7f000001',
      '0177.0.0.1',
      '-unsafe.example',
      'unsafe-.example',
      `${'a'.repeat(64)}.example`,
      'private.home',
      'private.onion',
    ]) {
      const [parsed] =
        await sql`select private.tracking_url_host(${`https://${host}/docs`}) as host`;
      expect(parsed?.host).toBeNull();
    }
    for (const url of [
      'https://clarityscale.example/docs#fragment',
      'https://user@clarityscale.example/docs',
      'https://clarityscale.example:443/docs',
      'https://clarityscale.example/with space',
      'https://clarityscale.example/\\private',
    ])
      await expect(link(d, actors.member, url)).rejects.toThrow('TRACKING_DESTINATION_DENIED');
    const [safe] =
      await sql`select private.tracking_url_host('https://docs.clarityscale.example/docs?format=small') as host`;
    expect(safe?.host).toBe('docs.clarityscale.example');
  });
  it('refreshes the cache through real BullMQ jobs and remains idempotent on repeated delivery', async () => {
    const l = await link();
    await click(l.code);
    for (let attempt = 0; attempt < 20; attempt++) {
      await sql`select private.refresh_attribution_analytics(10)`;
      if (
        (await sql`select 1 from public.analytics_cache where organization_id=${organization}`)
          .length
      )
        break;
    }
    await click(l.code);
    const redis = new Redis({
      host: '127.0.0.1',
      port: 56379,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    await redis.connect();
    const prefixes: string[] = [];
    try {
      for (let delivery = 0; delivery < 2; delivery++) {
        // Prioritize this synthetic stale record; retain its real previous aggregate.
        await sql`update public.analytics_cache set stale=true,generated_at='2000-01-01T00:00:00Z' where organization_id=${organization}`;
        const prefix = `threadsignal-p6-integration-${randomUUID()}`;
        prefixes.push(prefix);
        const config = {
          ...parseWorkerConfig({
            ...localEnvironment(),
            DATABASE_URL: localDatabaseUrl(),
            LOG_LEVEL: 'silent',
          }),
          queuePrefix: prefix,
        };
        const worker = await startAnalyticsWorker(sql, config);
        try {
          await expect
            .poll(
              async () => {
                const [cached] =
                  await sql`select report,stale,generated_at>'2000-01-01T00:00:00Z' as refreshed from public.analytics_cache where organization_id=${organization}`;
                return !cached?.stale && cached?.refreshed ? cached?.report.metrics.clicks : null;
              },
              { timeout: 10_000 },
            )
            .toBe(2);
          expect(worker.isReady()).toBe(true);
          await expect
            .poll(
              async () => Number(await redis.zcard(`${prefix}:aggregate-analytics:completed`)),
              { timeout: 5_000 },
            )
            .toBe(1);
          const [count] =
            await sql`select count(*)::integer as n from public.tracking_clicks where tracking_link_id=${l.id}`;
          expect(count?.n).toBe(2);
        } finally {
          await worker.stop();
        }
      }
    } finally {
      for (const prefix of prefixes) {
        let cursor = '0';
        const keys: string[] = [];
        do {
          const result = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 100);
          cursor = result[0];
          keys.push(...result[1]);
        } while (cursor !== '0');
        if (keys.length) await redis.unlink(...keys);
      }
      redis.disconnect();
    }
  });
  it('rejects a replay that combines identities belonging to two different accepted events', async () => {
    const c = await click((await link()).code);
    const k = await key();
    const inputA = event(c.id, 'purchase', { externalId: 'order-A', idempotencyKey: randomUUID() });
    const secondIdempotencyKey = randomUUID();
    const inputB = event(c.id, 'purchase', {
      externalId: 'order-B',
      idempotencyKey: secondIdempotencyKey,
    });
    const first = await convert(k.hash, inputA);
    await convert(k.hash, inputB);
    await expect(
      convert(k.hash, { ...inputA, idempotencyKey: secondIdempotencyKey }),
    ).rejects.toThrow('CONVERSION_IDEMPOTENCY_CONFLICT');
    expect(await convert(k.hash, inputA)).toEqual({ id: first.id, duplicate: true });
    expect((await analytics()).metrics).toMatchObject({
      purchases: 2,
      revenue: [{ currency: 'USD', value: 198 }],
    });
  });
});
