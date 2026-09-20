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
  input_checksum: hash('phase5 evaluation'),
};

describe('Phase 5 extension database boundaries', () => {
  let sql: postgres.Sql;
  let organization: string;
  let otherOrganization: string;
  let brand: string;
  let opportunity: string;
  let subreddit: string;
  let post: string;
  let providerPostId: string;
  let communityName: string;
  const origin = `chrome-extension://${'a'.repeat(32)}`;
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
  beforeAll(async () => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 6, connect_timeout: 5, onnotice: () => {} });
    for (const actor of Object.values(actors))
      await sql`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(${actor},${`${actor}@phase5.example`},now(),'{}')`;
    for (const actor of [actors.owner, actors.other]) {
      const [r] = await asUser(
        actor,
        (tx) =>
          tx`select public.create_organization('Draft fixtures',${`phase5-${actor}`},${`${actor}@phase5.example`}) as id`,
      );
      if (actor === actors.owner) organization = String(r?.id);
      else otherOrganization = String(r?.id);
    }
    for (const role of ['admin', 'member', 'viewer'] as const)
      await sql`insert into public.organization_members(organization_id,user_id,role) values(${organization},${actors[role]},${role})`;
  });
  beforeEach(async () => {
    await sql`delete from public.extension_connection_codes where organization_id in (${organization},${otherOrganization})`;
    await sql`delete from public.extension_sessions where organization_id in (${organization},${otherOrganization})`;
    await sql`update public.organizations set status='active',deleted_at=null where id=${organization}`;
    for (const role of ['admin', 'member', 'viewer'] as const)
      await sql`insert into public.organization_members(organization_id,user_id,role) values(${organization},${actors[role]},${role}) on conflict(organization_id,user_id) do update set role=excluded.role`;
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
    const name = `p5_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
    const [s] =
      await sql`insert into public.subreddits(name,display_name) values(${name},${name}) returning id`;
    subreddit = String(s?.id);
    communityName = name;
    communities.push(subreddit);
    await sql`insert into public.brand_subreddits(organization_id,brand_id,subreddit_id) values(${organization},${brand},${subreddit})`;
    const providerId = randomUUID().replaceAll('-', '').slice(0, 12);
    providerPostId = providerId;
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

  async function asExtension<T>(operation: (tx: postgres.TransactionSql) => Promise<T>) {
    return sql.begin(async (tx) => {
      await tx`set local role threadsignal_extension_api`;
      return operation(tx);
    });
  }
  async function code(actor = actors.member, org = organization, value = hash(randomUUID())) {
    const [r] = await asUser(
      actor,
      (tx) =>
        tx`select public.create_extension_connection_code(${org},${value},'Personal test Chrome') as value`,
    );
    return { hash: value, ...(r?.value as { id: string; expires_at: string }) };
  }
  async function exchange(
    codeHash: string,
    tokenHash = hash(randomUUID()),
    extensionOrigin = origin,
  ) {
    const [r] = await asExtension(
      (tx) =>
        tx`select private.exchange_extension_code(${codeHash},${tokenHash},${extensionOrigin}) as value`,
    );
    return {
      hash: tokenHash,
      ...(r?.value as {
        session_id: string;
        organization_id: string;
        name: string;
        expires_at: string;
      }),
    };
  }
  async function session(actor = actors.member, org = organization) {
    return exchange((await code(actor, org)).hash);
  }
  async function approved() {
    const id = await ready();
    await approve(id);
    return id;
  }
  async function current(tokenHash: string, draft: string | null = null, extensionOrigin = origin) {
    const [r] = await asExtension(
      (tx) =>
        tx`select private.extension_current(${tokenHash},${extensionOrigin},${providerPostId},${communityName},${draft}) as value`,
    );
    return r?.value as {
      organization_id: string;
      opportunity: null | { id: string };
      draft: null | { id: string; version: number; content: string };
      draft_unavailable_reason: string | null;
      claims: unknown[];
      rules: unknown[];
    };
  }
  async function prepare(tokenHash: string, draft: string, version = 1) {
    return asExtension(
      (tx) =>
        tx`select private.extension_prepare_handoff(${tokenHash},${origin},${draft},${version},${providerPostId},${communityName}) as value`,
    );
  }
  function commentUrl(postId = providerPostId, community = communityName) {
    return `https://www.reddit.com/r/${community}/comments/${postId}/fixture/comment1/`;
  }
  async function markPublished(
    tokenHash: string,
    draft: string,
    url: string | null = commentUrl(),
    version = 1,
  ) {
    return asExtension(
      (tx) =>
        tx`select private.extension_mark_published(${tokenHash},${origin},${draft},${version},${providerPostId},${communityName},${url})`,
    );
  }

  it('exchanges a hashed short-lived connection code exactly once under concurrency', async () => {
    const c = await code();
    const results = await Promise.allSettled([exchange(c.hash), exchange(c.hash)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const [stored] =
      await sql`select code_hash,consumed_at,expires_at-created_at as lifetime from public.extension_connection_codes where id=${c.id}`;
    expect(stored?.code_hash).toBe(c.hash);
    expect(stored?.consumed_at).not.toBeNull();
    const [count] =
      await sql`select count(*)::integer as value from public.extension_sessions where organization_id=${organization}`;
    expect(count?.value).toBe(1);
  });
  it('replaces an outstanding code and denies expired, malformed or invalid-origin exchange', async () => {
    const old = await code();
    const fresh = await code();
    await expect(exchange(old.hash)).rejects.toThrow('EXTENSION_CODE_INVALID');
    await expect(
      exchange(fresh.hash, hash(randomUUID()), 'https://www.reddit.com'),
    ).rejects.toThrow('INVALID_EXTENSION_CONNECTION');
    await expect(exchange('not-a-hash')).rejects.toThrow('INVALID_EXTENSION_CONNECTION');
    await sql`update public.extension_connection_codes set created_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute' where id=${fresh.id}`;
    await expect(exchange(fresh.hash)).rejects.toThrow('EXTENSION_CODE_INVALID');
  });
  it('binds issued codes to the current user and rejects viewer and foreign-organization creation', async () => {
    for (const actor of [actors.viewer, actors.other])
      await expect(code(actor)).rejects.toMatchObject({ code: '42501' });
    for (const actor of [actors.owner, actors.admin, actors.member]) {
      const s = await session(actor);
      const [stored] =
        await sql`select user_id,organization_id from public.extension_sessions where id=${s.session_id}`;
      expect(stored).toMatchObject({ user_id: actor, organization_id: organization });
    }
  });
  it('stores no raw credentials and denies the extension role direct data or generic RPC authority', async () => {
    const s = await session();
    const [role] =
      await sql`select rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb from pg_roles where rolname='threadsignal_extension_api'`;
    expect(role).toEqual({
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
    for (const table of [
      'extension_sessions',
      'extension_connection_codes',
      'profiles',
      'drafts',
      'knowledge_chunks',
    ]) {
      await expect(
        asExtension((tx) => tx`select * from public.${tx(table)}`),
      ).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      asUser(
        actors.owner,
        (tx) =>
          tx`select private.exchange_extension_code(${hash('forbidden')},${hash('forbidden-token')},${origin})`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asExtension((tx) => tx`select public.get_organization_settings(${organization})`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asExtension((tx) => tx`select private.require_extension_session(${s.hash},${origin})`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(actors.owner, (tx) => tx`select token_hash from public.extension_sessions`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(actors.owner, (tx) => tx`select code_hash from public.extension_connection_codes`),
    ).rejects.toMatchObject({ code: '42501' });
    const [columns] =
      await sql`select bool_and(column_name not in ('token','code','password')) as safe from information_schema.columns where table_schema='public' and table_name in ('extension_sessions','extension_connection_codes')`;
    expect(columns?.safe).toBe(true);
  });
  it('lists safe own sessions for members and lets managers revoke every session and pending code', async () => {
    const own = await session();
    const admin = await session(actors.admin);
    const pending = await code();
    const [memberList] = await asUser(
      actors.member,
      (tx) => tx`select public.list_extension_sessions(${organization}) as value`,
    );
    const [ownerList] = await asUser(
      actors.owner,
      (tx) => tx`select public.list_extension_sessions(${organization}) as value`,
    );
    expect(memberList?.value).toHaveLength(1);
    expect(ownerList?.value).toHaveLength(2);
    expect(JSON.stringify(ownerList?.value)).not.toContain('token_hash');
    expect(
      await asUser(
        actors.other,
        (tx) => tx`select id from public.extension_sessions where organization_id=${organization}`,
      ),
    ).toHaveLength(0);
    await expect(
      asUser(
        actors.member,
        (tx) => tx`select public.revoke_extension_sessions(${organization},${admin.session_id})`,
      ),
    ).rejects.toThrow('EXTENSION_SESSION_NOT_FOUND');
    const [revoked] = await asUser(
      actors.owner,
      (tx) => tx`select public.revoke_extension_sessions(${organization},null) as count`,
    );
    expect(revoked?.count).toBe(2);
    await expect(current(own.hash)).rejects.toThrow('EXTENSION_SESSION_INVALID');
    await expect(current(admin.hash)).rejects.toThrow('EXTENSION_SESSION_INVALID');
    await expect(exchange(pending.hash)).rejects.toThrow('EXTENSION_CODE_INVALID');
  });
  it('bounds inactive history to the latest fifty without hiding active sessions or weakening tenant roles', async () => {
    const memberActive = await session();
    const adminActive = await session(actors.admin);
    const otherActive = await session(actors.other, otherOrganization);
    await sql`update public.extension_sessions set created_at=now()-interval '1 day',expires_at=now()+interval '29 days' where id in ${sql([memberActive.session_id, adminActive.session_id, otherActive.session_id])}`;
    const anchor = Date.now();
    const history = [
      { organizationId: organization, userId: actors.member },
      { organizationId: otherOrganization, userId: actors.other },
    ].flatMap(({ organizationId, userId }) =>
      Array.from({ length: 60 }, (_, index) => ({
        id: randomUUID(),
        organization_id: organizationId,
        user_id: userId,
        token_hash: hash(randomUUID()),
        extension_origin: origin,
        name: `History ${index}`,
        created_at: new Date(anchor - (index + 2) * 1000),
        expires_at: new Date(index % 2 === 0 ? anchor - 1000 : anchor + 3600000),
        revoked_at: index % 2 === 0 ? null : new Date(anchor - 1000),
      })),
    );
    await sql`insert into public.extension_sessions ${sql(history, 'id', 'organization_id', 'user_id', 'token_hash', 'extension_origin', 'name', 'created_at', 'expires_at', 'revoked_at')}`;
    async function listed(actor: string, org = organization) {
      const [result] = await asUser(
        actor,
        (tx) => tx`select public.list_extension_sessions(${org}) as value`,
      );
      return result?.value as { id: string; user_id: string; organization_id: string }[];
    }
    const member = await listed(actors.member);
    expect(member).toHaveLength(51);
    expect(member.slice(0, 50).map((row) => row.id)).toEqual(
      history.slice(0, 50).map((row) => row.id),
    );
    expect(member[50]?.id).toBe(memberActive.session_id);
    expect(
      member.every((row) => row.user_id === actors.member && row.organization_id === organization),
    ).toBe(true);
    for (const actor of [actors.owner, actors.admin]) {
      const manager = await listed(actor);
      expect(manager).toHaveLength(52);
      expect(manager.slice(0, 50).map((row) => row.id)).toEqual(
        history.slice(0, 50).map((row) => row.id),
      );
      expect(manager.slice(50).map((row) => row.id)).toEqual(
        expect.arrayContaining([memberActive.session_id, adminActive.session_id]),
      );
      expect(manager.every((row) => row.organization_id === organization)).toBe(true);
      expect(JSON.stringify(manager)).not.toContain('token_hash');
    }
    const foreign = await listed(actors.other, otherOrganization);
    expect(foreign).toHaveLength(51);
    expect(foreign.slice(0, 50).map((row) => row.id)).toEqual(
      history.slice(60, 110).map((row) => row.id),
    );
    expect(foreign[50]?.id).toBe(otherActive.session_id);
    await expect(listed(actors.other)).rejects.toMatchObject({ code: '42501' });
    await expect(listed(actors.viewer)).rejects.toMatchObject({ code: '42501' });
    // Limiting the response never removes retained records or active connections.
    const [stored] =
      await sql`select count(*)::integer as count from public.extension_sessions where organization_id=${organization}`;
    expect(stored?.count).toBe(62);
  });
  it('member revoke-all affects only their own sessions and codes', async () => {
    const own = await session();
    const admin = await session(actors.admin);
    await asUser(
      actors.member,
      (tx) => tx`select public.revoke_extension_sessions(${organization},null)`,
    );
    await expect(current(own.hash)).rejects.toThrow('EXTENSION_SESSION_INVALID');
    expect((await current(admin.hash)).organization_id).toBe(organization);
  });
  it('caps active sessions at five and bounds connection creation and token use rates', async () => {
    const issued = [];
    for (let i = 0; i < 5; i++) issued.push(await session());
    await expect(code()).rejects.toThrow('EXTENSION_SESSION_LIMIT');
    await sql`update public.extension_sessions set rate_window_count=120 where id=${issued[0]?.session_id ?? ''}`;
    await expect(current(issued[0]?.hash ?? '')).rejects.toThrow('EXTENSION_RATE_LIMIT');
    await sql`update public.extension_sessions set rate_window_started_at=now()-interval '2 minutes' where id=${issued[0]?.session_id ?? ''}`;
    expect((await current(issued[0]?.hash ?? '')).organization_id).toBe(organization);
    for (let i = 0; i < 10; i++) await code(actors.admin);
    await expect(code(actors.admin)).rejects.toThrow('EXTENSION_RATE_LIMIT');
  });
  it('checks session origin, expiration and current membership on every action', async () => {
    const s = await session();
    await expect(current(s.hash, null, `chrome-extension://${'b'.repeat(32)}`)).rejects.toThrow(
      'EXTENSION_SESSION_INVALID',
    );
    await asUser(
      actors.owner,
      (tx) => tx`select public.change_member_role(${organization},${actors.member},'viewer')`,
    );
    await expect(current(s.hash)).rejects.toMatchObject({ code: '42501' });
    await sql`update public.organization_members set role='member' where organization_id=${organization} and user_id=${actors.member}`;
    await sql`delete from public.organization_members where organization_id=${organization} and user_id=${actors.member}`;
    await expect(current(s.hash)).rejects.toMatchObject({ code: '42501' });
    await sql`insert into public.organization_members(organization_id,user_id,role) values(${organization},${actors.member},'member')`;
    await sql`update public.extension_sessions set created_at=now()-interval '31 days',expires_at=now()-interval '1 day' where id=${s.session_id}`;
    await expect(current(s.hash)).rejects.toThrow('EXTENSION_SESSION_INVALID');
  });
  it('refuses organization suspension and expired plans without preventing disconnect', async () => {
    const s = await session();
    await sql`update public.organizations set status='suspended' where id=${organization}`;
    await expect(current(s.hash)).rejects.toMatchObject({ code: '42501' });
    await sql`update public.organizations set status='active' where id=${organization}`;
    await sql`update public.subscriptions set current_period_start=now()-interval '7 days',current_period_end=now()-interval '1 second' where organization_id=${organization}`;
    await expect(current(s.hash)).rejects.toThrow('TRIAL_EXPIRED');
    await asExtension((tx) => tx`select private.disconnect_extension(${s.hash},${origin})`);
    await asExtension((tx) => tx`select private.disconnect_extension(${s.hash},${origin})`);
    const [stored] =
      await sql`select revoked_at from public.extension_sessions where id=${s.session_id}`;
    expect(stored?.revoked_at).not.toBeNull();
  });
  it('rechecks membership when exchanging a code rather than inheriting issuance authority', async () => {
    const c = await code();
    await asUser(
      actors.owner,
      (tx) => tx`select public.remove_member(${organization},${actors.member})`,
    );
    await expect(exchange(c.hash)).rejects.toMatchObject({ code: '42501' });
  });
  it('returns only the matching scoped opportunity, approved draft, evidence and rules', async () => {
    const id = await approved();
    const s = await session();
    const foreign = await session(actors.other, otherOrganization);
    await sql`insert into public.subreddit_rules(subreddit_id,provider_rule_id,title,description,kind,applies_to) values(${subreddit},'disclosure','Be transparent','Disclose affiliations.','all','all')`;
    // Rules change the context, so the prior approval must fail closed until verified again.
    const stale = await current(s.hash, id);
    expect(stale.draft).toBeNull();
    expect(stale.draft_unavailable_reason).toBe('DRAFT_CONTEXT_CHANGED');
    await sql`delete from public.subreddit_rules where subreddit_id=${subreddit}`;
    const response = await current(s.hash, id);
    expect(response.opportunity?.id).toBe(opportunity);
    expect(response.draft).toMatchObject({ id, version: 1, content });
    expect(response.claims).toHaveLength(1);
    expect((await current(foreign.hash, id)).opportunity).toBeNull();
    expect((await current(foreign.hash)).draft).toBeNull();
    await expect(prepare(foreign.hash, id)).rejects.toThrow('DRAFT_NOT_FOUND');
  });
  it('never returns unapproved content and refreshes handoff authority with an exact version', async () => {
    const id = await ready();
    const s = await session();
    expect((await current(s.hash)).draft).toBeNull();
    await expect(prepare(s.hash, id)).rejects.toThrow('DRAFT_NOT_APPROVED');
    await approve(id);
    const [prepared] = await prepare(s.hash, id);
    expect(prepared?.value).toEqual({ content, version: 1 });
    await expect(prepare(s.hash, id, 2)).rejects.toThrow('DRAFT_VERSION_CONFLICT');
    await expect(
      asExtension(
        (tx) =>
          tx`select private.extension_prepare_handoff(${s.hash},${origin},${id},1,'differentpost',${communityName})`,
      ),
    ).rejects.toThrow('DRAFT_NOT_FOUND');
  });
  it('saves extension edits as normal versions and invalidates approval pending new checks', async () => {
    const id = await approved();
    const s = await session();
    const [saved] = await asExtension(
      (tx) =>
        tx`select private.extension_save_draft(${s.hash},${origin},${id},1,${content + ' Quantum teleportation is included.'}) as version`,
    );
    expect(saved?.version).toBe(2);
    const draft = await row(id);
    expect(draft).toMatchObject({
      status: 'editing',
      current_version: 2,
      approved_at: null,
      verified_version: null,
    });
    const [version] =
      await sql`select created_by,source from public.draft_versions where draft_id=${id} and version=2`;
    expect(version).toEqual({ created_by: actors.member, source: 'user' });
    expect((await current(s.hash, id)).draft).toBeNull();
    await expect(prepare(s.hash, id, 2)).rejects.toThrow('DRAFT_NOT_APPROVED');
    await expect(
      asExtension(
        (tx) => tx`select private.extension_save_draft(${s.hash},${origin},${id},1,'Stale edit')`,
      ),
    ).rejects.toThrow('DRAFT_VERSION_CONFLICT');
  });
  it('blocks handoff when evidence is disabled, the post is stale or the opportunity is dismissed', async () => {
    const id = await approved();
    const s = await session();
    await sql`update public.knowledge_documents set is_included=false where id=${document}`;
    await expect(prepare(s.hash, id)).rejects.toThrow('DRAFT_CONTEXT_CHANGED');
    await sql`update public.knowledge_documents set is_included=true where id=${document}`;
    await sql`update public.reddit_posts set last_synced_at=now()-interval '49 hours' where id=${post}`;
    await expect(prepare(s.hash, id)).rejects.toThrow('POST_STALE');
    await sql`update public.reddit_posts set last_synced_at=now() where id=${post}`;
    await asUser(
      actors.member,
      (tx) => tx`select public.set_opportunity_status(${opportunity},'dismissed','not_relevant')`,
    );
    await expect(prepare(s.hash, id)).rejects.toThrow('OPPORTUNITY_UNAVAILABLE');
  });
  it('records insertion separately from approval and idempotently after explicit action', async () => {
    const id = await approved();
    const s = await session();
    for (let i = 0; i < 2; i++)
      await asExtension(
        (tx) =>
          tx`select private.extension_mark_inserted(${s.hash},${origin},${id},1,${providerPostId},${communityName})`,
      );
    const draft = await row(id);
    expect(draft).toMatchObject({ status: 'approved', inserted_version: 1, published_at: null });
    expect(draft?.inserted_at).not.toBeNull();
    const [audit] =
      await sql`select count(*)::integer as count from public.audit_logs where target_id=${id} and action='draft.inserted'`;
    expect(audit?.count).toBe(1);
  });
  it('accepts only a canonical matching comment URL and records manual publication once', async () => {
    const id = await approved();
    const s = await session();
    for (const url of [
      null,
      'javascript:alert(1)',
      commentUrl('wrongpost'),
      commentUrl(providerPostId, 'wrongcommunity'),
      commentUrl() + '?token=unexpected',
      commentUrl().replace('www.reddit.com', 'www.reddit.com.evil.example'),
    ])
      await expect(markPublished(s.hash, id, url)).rejects.toThrow('INVALID_COMMENT_URL');
    await markPublished(s.hash, id);
    await markPublished(s.hash, id);
    const draft = await row(id);
    expect(draft).toMatchObject({
      status: 'approved',
      published_version: 1,
      published_comment_url: commentUrl(),
    });
    const [audit] =
      await sql`select count(*)::integer as count from public.audit_logs where target_id=${id} and action='draft.published_manually'`;
    expect(audit?.count).toBe(1);
    await expect(
      markPublished(s.hash, id, commentUrl().replace('comment1', 'comment2')),
    ).rejects.toThrow('PUBLICATION_ALREADY_RECORDED');
  });
  it('supports the same manual publication boundary from the authenticated web application', async () => {
    const id = await approved();
    for (const actor of [actors.viewer, actors.other])
      await expect(
        asUser(
          actor,
          (tx) => tx`select public.mark_draft_published(${organization},${id},1,${commentUrl()})`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(
        actors.other,
        (tx) =>
          tx`select public.mark_draft_published(${otherOrganization},${id},1,${commentUrl()})`,
      ),
    ).rejects.toThrow('DRAFT_NOT_FOUND');
    await asUser(
      actors.member,
      (tx) => tx`select public.mark_draft_published(${organization},${id},1,${commentUrl()})`,
    );
    expect((await row(id))?.published_comment_url).toBe(commentUrl());
  });
  it('purges identifying comment URLs and forbids later handoff or publication of deleted posts', async () => {
    const id = await approved();
    const s = await session();
    await markPublished(s.hash, id);
    await sql`select private.purge_reddit_post(${post})`;
    expect((await row(id))?.published_comment_url).toBeNull();
    expect((await current(s.hash, id)).opportunity).toBeNull();
    await expect(prepare(s.hash, id)).rejects.toThrow('POST_DELETED');
    await expect(markPublished(s.hash, id)).rejects.toThrow('POST_DELETED');
  });
  it('serializes revocation before a waiting handoff and serializes purge before publication', async () => {
    const id = await approved();
    const s = await session();
    let unlock!: () => void;
    let acquired!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const revocation = sql.begin(async (tx) => {
      await tx`select id from public.organizations where id=${organization} for update`;
      acquired();
      await release;
      await tx`update public.extension_sessions set revoked_at=now() where id=${s.session_id}`;
    });
    await locked;
    const waiting = prepare(s.hash, id);
    unlock();
    await revocation;
    await expect(waiting).rejects.toThrow('EXTENSION_SESSION_INVALID');
    const next = await session();
    let finishPurge!: () => void;
    let purgeAcquired!: () => void;
    const purgeLocked = new Promise<void>((resolve) => {
      purgeAcquired = resolve;
    });
    const purgeRelease = new Promise<void>((resolve) => {
      finishPurge = resolve;
    });
    const purging = sql.begin(async (tx) => {
      await tx`select private.purge_reddit_post(${post})`;
      purgeAcquired();
      await purgeRelease;
    });
    await purgeLocked;
    const publication = markPublished(next.hash, id);
    finishPurge();
    await purging;
    await expect(publication).rejects.toThrow('POST_DELETED');
    expect((await row(id))?.published_comment_url).toBeNull();
  });
  it('removes expired tokens and old codes in bounded idempotent maintenance batches', async () => {
    const active = await session();
    const expired = await session();
    const oldCode = await code();
    await sql`update public.extension_sessions set created_at=now()-interval '31 days',expires_at=now()-interval '1 day' where id=${expired.session_id}`;
    await sql`update public.extension_connection_codes set created_at=now()-interval '2 days',expires_at=now()-interval '2 days'+interval '5 minutes' where id=${oldCode.id}`;
    const [cleaned] = await asExtension(
      (tx) => tx`select private.cleanup_expired_extension_sessions() as value`,
    );
    expect(cleaned?.value.sessions_deleted).toBeGreaterThanOrEqual(1);
    expect(cleaned?.value.codes_deleted).toBeGreaterThanOrEqual(1);
    await asExtension((tx) => tx`select private.cleanup_expired_extension_sessions()`);
    expect((await current(active.hash)).organization_id).toBe(organization);
    expect(
      await sql`select id from public.extension_sessions where id=${expired.session_id}`,
    ).toHaveLength(0);
  });
});
