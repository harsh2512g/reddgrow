import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { demoBrand } from '@threadsignal/knowledge';
import { localDatabaseUrl, verifyDocker } from '../../scripts/service-utils.mjs';

const actors = Object.fromEntries(
  ['owner', 'admin', 'member', 'viewer', 'other'].map((role) => [role, randomUUID()]),
) as Record<'owner' | 'admin' | 'member' | 'viewer' | 'other', string>;
const categories = Object.fromEntries(
  [
    'welcome',
    'invitation',
    'ingestion_complete',
    'ingestion_failed',
    'daily_digest',
    'high_score_alert',
    'trial_ending',
    'usage_limit',
    'payment_failed',
    'subscription_changed',
  ].map((key) => [key, true]),
);
const preferences = {
  categories,
  digest_time: '00:00',
  minimum_score: 90,
  quiet_start: null,
  quiet_end: null,
};

describe('Phase 7 billing and notification database boundaries', () => {
  let sql: postgres.Sql;
  let organization: string;
  let otherOrganization: string;
  const communities: string[] = [];
  async function asUser<T>(
    actor: string,
    operation: (tx: postgres.TransactionSql) => Promise<T>,
    bridge = false,
  ) {
    return sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${actor},true),set_config('request.jwt.claims',${JSON.stringify({ sub: actor, role: 'authenticated' })},true)`;
      if (bridge) await tx`set local role threadsignal_billing_api`;
      else await tx`set local role authenticated`;
      return operation(tx);
    });
  }
  async function checkout(plan = 'solo', key = randomUUID(), actor = actors.owner) {
    const [row] = await asUser(
      actor,
      (tx) => tx`select public.begin_billing_checkout(${organization},${plan},${key}) as value`,
    );
    return row?.value as { id: string; plan_key: string; status: string };
  }
  async function complete(id: string, actor = actors.owner) {
    const [row] = await asUser(
      actor,
      (tx) => tx`select public.complete_mock_checkout(${organization},${id}) as value`,
      true,
    );
    return row?.value as {
      plan_key: string;
      period_start: string;
      period_end: string;
      status: string;
      active: boolean;
      grace_ends_at: string | null;
      cancel_at_period_end: boolean;
    };
  }
  async function manage(action: string) {
    const [row] = await asUser(
      actors.owner,
      (tx) => tx`select public.manage_mock_subscription(${organization},${action}) as value`,
      true,
    );
    return row?.value as {
      status: string;
      active: boolean;
      grace_ends_at: string | null;
      cancel_at_period_end: boolean;
    };
  }
  async function setPreferences(value: postgres.JSONValue = preferences, actor = actors.owner) {
    const [row] = await asUser(
      actor,
      (tx) =>
        tx`select public.set_notification_preferences(${organization},${tx.json(value)}) as value`,
    );
    return row?.value as typeof preferences & { timezone: string };
  }
  async function enqueue(
    type = 'welcome',
    key: string = randomUUID(),
    payload: postgres.JSONValue = {},
  ) {
    const [row] =
      await sql`select private.enqueue_notification(${organization},${actors.owner},${type},${key},${sql.json(payload)}) as id`;
    return row?.id as string | null;
  }
  async function claim(id: string, lease = randomUUID()) {
    const [row] = await sql`select private.claim_notification(${id},${lease}) as value`;
    return {
      lease,
      value: row?.value as null | {
        id: string;
        recipient: string;
        attempt: number;
        type: string;
        payload: Record<string, unknown>;
      },
    };
  }
  function event(overrides: Record<string, unknown> = {}) {
    return {
      provider: 'stripe',
      eventId: `evt_${randomUUID().replaceAll('-', '')}`,
      eventCreatedAt: new Date().toISOString(),
      checkoutSessionId: null as string | null,
      subscription: {
        id: `sub_${organization.replaceAll('-', '')}`,
        customerId: `cus_${organization.replaceAll('-', '')}`,
        organizationId: organization,
        planKey: 'growth',
        status: 'active',
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        cancelAtPeriodEnd: false,
        trialEndsAt: null,
      },
      ...overrides,
    };
  }
  async function apply(value: ReturnType<typeof event>) {
    return sql.begin(async (tx) => {
      await tx`set local role threadsignal_billing_api`;
      const [row] =
        await tx`select private.apply_billing_event(${tx.json(value as postgres.JSONValue)}) as value`;
      return row?.value as { applied: boolean; duplicate: boolean; stale: boolean };
    });
  }
  beforeAll(async () => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 6, connect_timeout: 5, onnotice: () => {} });
    for (const actor of Object.values(actors))
      await sql`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(${actor},${`${actor}@phase7.example`},now(),'{}')`;
    for (const actor of [actors.owner, actors.other]) {
      const [row] = await asUser(
        actor,
        (tx) =>
          tx`select public.create_organization('Billing fixtures',${`p7-${actor}`},${`${actor}@phase7.example`}) as id`,
      );
      if (actor === actors.owner) organization = String(row?.id);
      else otherOrganization = String(row?.id);
    }
    for (const role of ['admin', 'member', 'viewer'] as const)
      await sql`insert into public.organization_members(organization_id,user_id,role) values(${organization},${actors[role]},${role})`;
  });
  beforeEach(async () => {
    await sql`delete from public.billing_checkout_requests where organization_id=${organization}`;
    await sql`delete from public.billing_events where organization_id=${organization}`;
    await sql`delete from public.usage_counters where organization_id=${organization}`;
    await sql`delete from public.brands where organization_id=${organization}`;
    if (communities.length)
      await sql`delete from public.subreddits where id in ${sql(communities)}`;
    communities.length = 0;
    await sql`update public.organizations set timezone='UTC',status='active',deleted_at=null where id=${organization}`;
    await sql`update public.subscriptions set provider='mock',provider_customer_id=null,provider_subscription_id=null,plan_key='trial',status='trialing',current_period_start=now(),current_period_end=now()+interval '7 days',cancel_at_period_end=false,grace_ends_at=null,latest_provider_event_at=null,latest_provider_event_id=null where organization_id=${organization}`;
    await sql`delete from public.notification_deliveries where organization_id=${organization}`;
    await sql`delete from public.notification_preferences where organization_id=${organization}`;
  });
  afterAll(async () => {
    if (!sql) return;
    if (organization)
      await sql`delete from public.organizations where id in (${organization},${otherOrganization})`;
    await sql`delete from auth.users where id in ${sql(Object.values(actors))}`;
    if (communities.length)
      await sql`delete from public.subreddits where id in ${sql(communities)}`;
    await sql.end({ timeout: 5 });
  });

  it('restricts billing mutations to owner and keeps payment details out of member summaries', async () => {
    for (const actor of [actors.admin, actors.member, actors.viewer, actors.other])
      await expect(checkout('solo', randomUUID(), actor)).rejects.toThrow('FORBIDDEN');
    const [owner] = await asUser(
      actors.owner,
      (tx) => tx`select public.get_billing_subscription(${organization}) as value`,
    );
    const [member] = await asUser(
      actors.member,
      (tx) => tx`select public.get_billing_subscription(${organization}) as value`,
    );
    expect(owner?.value.billing_email).toBe(`${actors.owner}@phase7.example`);
    expect(member?.value).toMatchObject({
      plan_key: 'trial',
      billing_email: null,
      customer_id: null,
      subscription_id: null,
      can_manage: false,
    });
    await expect(
      asUser(actors.other, (tx) => tx`select public.get_billing_subscription(${organization})`),
    ).rejects.toThrow('FORBIDDEN');
  });
  it('deduplicates checkout and refuses changed plans, expired requests, and direct client completion', async () => {
    const key = randomUUID();
    const first = await checkout('solo', key);
    expect((await checkout('solo', key)).id).toBe(first.id);
    await expect(checkout('growth', key)).rejects.toThrow('BILLING_IDEMPOTENCY_CONFLICT');
    await expect(
      asUser(
        actors.owner,
        (tx) => tx`select public.complete_mock_checkout(${organization},${first.id})`,
      ),
    ).rejects.toThrow('permission denied');
    await expect(complete(first.id, actors.other)).rejects.toThrow('FORBIDDEN');
    await sql`update public.billing_checkout_requests set expires_at=now()-interval '1 second' where id=${first.id}`;
    await expect(complete(first.id)).rejects.toThrow('CHECKOUT_EXPIRED');
  });
  it('carries trial usage into checkout, preserves usage on upgrades, and deduplicates completion', async () => {
    await sql`insert into public.usage_counters(organization_id,metric,period_start,period_end,quantity) select organization_id,'ai_drafts',current_period_start,current_period_end,10 from public.subscriptions where organization_id=${organization}`;
    const request = await checkout();
    const paid = await complete(request.id);
    expect(paid.plan_key).toBe('solo');
    expect(await complete(request.id)).toEqual(paid);
    const growth = await complete((await checkout('growth')).id);
    expect(growth.period_start).toBe(paid.period_start);
    expect(growth.period_end).toBe(paid.period_end);
    const [usage] = await asUser(
      actors.member,
      (tx) => tx`select public.get_billing_usage(${organization}) as value`,
    );
    expect(usage?.value.meters).toContainEqual({ metric: 'ai_drafts', used: 10, limit: 300 });
    expect(usage?.value.meters).toContainEqual({ metric: 'members', used: 4, limit: 5 });
  });
  it('preserves brands when downgrading and blocks additional server allocation', async () => {
    await complete((await checkout('growth')).id);
    for (const name of ['Brand one', 'Brand two'])
      await asUser(
        actors.owner,
        (tx) =>
          tx`select public.save_brand(${organization},null,${tx.json({ ...demoBrand, name, competitors: [] })})`,
      );
    await complete((await checkout('solo')).id);
    const [count] =
      await sql`select count(*)::integer as value from public.brands where organization_id=${organization}`;
    expect(count?.value).toBe(2);
    await expect(
      asUser(
        actors.owner,
        (tx) =>
          tx`select public.save_brand(${organization},null,${tx.json({ ...demoBrand, name: 'Third brand', competitors: [] })})`,
      ),
    ).rejects.toThrow('BRAND_LIMIT');
  });
  it('reserves draft units atomically and never lets payment grace extend on repeat failures', async () => {
    await sql`insert into public.usage_counters(organization_id,metric,period_start,period_end,quantity) select organization_id,'ai_drafts',current_period_start,current_period_end,9 from public.subscriptions where organization_id=${organization}`;
    const results = await Promise.allSettled([
      sql`select private.reserve_draft_usage(${organization})`,
      sql`select private.reserve_draft_usage(${organization})`,
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const [notice] =
      await sql`select count(*)::integer as value from public.notification_deliveries where organization_id=${organization} and type='usage_limit'`;
    expect(notice?.value).toBe(4);
    await complete((await checkout()).id);
    const failed = await manage('payment_failed');
    expect(failed.active).toBe(true);
    expect((await manage('payment_failed')).grace_ends_at).toBe(failed.grace_ends_at);
    await sql`update public.subscriptions set grace_ends_at=now()-interval '1 second' where organization_id=${organization}`;
    await expect(sql`select private.reserve_draft_usage(${organization})`).rejects.toThrow(
      'PLAN_INACTIVE',
    );
    expect((await manage('payment_recovered')).active).toBe(true);
  });
  it('does not reset usage early, renews mock periods only when due, and honors cancellation', async () => {
    await complete((await checkout()).id);
    await expect(manage('renew')).rejects.toThrow('BILLING_PERIOD_NOT_DUE');
    expect((await manage('cancel')).cancel_at_period_end).toBe(true);
    expect((await manage('resume')).cancel_at_period_end).toBe(false);
    await sql`update public.subscriptions set current_period_start=now()-interval '2 months',current_period_end=now()-interval '1 month' where organization_id=${organization}`;
    await sql`select private.maintain_billing_periods(100)`;
    const [row] =
      await sql`select current_period_end>now() as active from public.subscriptions where organization_id=${organization}`;
    expect(row?.active).toBe(true);
    await manage('cancel');
    await sql`update public.subscriptions set current_period_start=now()-interval '2 months',current_period_end=now()-interval '1 month' where organization_id=${organization}`;
    await sql`select private.maintain_billing_periods(100)`;
    const [canceled] =
      await sql`select status from public.subscriptions where organization_id=${organization}`;
    expect(canceled?.status).toBe('canceled');
  });
  it('binds Stripe events to a registered checkout and deduplicates current snapshots and stale delivery', async () => {
    const first = event({ checkoutSessionId: 'cs_fixture' });
    await expect(apply(first)).rejects.toThrow('BILLING_CHECKOUT_REQUIRED');
    const request = await checkout('growth');
    await sql`select private.register_billing_session(${request.id},'stripe','cs_fixture',${first.subscription.customerId})`;
    expect(await apply(first)).toEqual({ applied: true, duplicate: false, stale: false });
    expect(await apply(first)).toEqual({ applied: false, duplicate: true, stale: false });
    expect(
      await apply({ ...first, subscription: { ...first.subscription, planKey: 'solo' } }),
    ).toEqual({ applied: false, duplicate: true, stale: false });
    const older = event({
      eventCreatedAt: new Date(Date.now() - 60_000).toISOString(),
      subscription: { ...first.subscription, planKey: 'solo' },
    });
    expect(await apply(older)).toEqual({ applied: false, duplicate: false, stale: true });
    const [row] =
      await sql`select plan_key from public.subscriptions where organization_id=${organization}`;
    expect(row?.plan_key).toBe('growth');
    await expect(
      apply(event({ subscription: { ...first.subscription, customerId: 'cus_unrelated' } })),
    ).rejects.toThrow('BILLING_CUSTOMER_CONFLICT');
  });
  it('binds a Stripe-created customer only through the previously registered checkout session', async () => {
    const first = event();
    const request = await checkout('growth');
    await sql`select private.register_billing_session(${request.id},'stripe','cs_newcustomer',null)`;
    await expect(apply(first)).rejects.toThrow('BILLING_CHECKOUT_REQUIRED');
    expect(await apply({ ...first, checkoutSessionId: 'cs_newcustomer' })).toMatchObject({
      applied: true,
    });
  });

  it('honors late paid Checkout only for its exact registered session without completing unrelated requests', async () => {
    const first = event({ checkoutSessionId: 'cs_latepayment' });
    const request = await checkout('growth');
    const unrelated = await checkout('growth');
    await sql`select private.register_billing_session(${request.id},'stripe','cs_latepayment',${first.subscription.customerId})`;
    await sql`select private.register_billing_session(${unrelated.id},'stripe','cs_unrelated',${first.subscription.customerId})`;
    await sql`update public.billing_checkout_requests set status='expired',expires_at=now()-interval '1 day' where id=${request.id}`;
    await expect(apply({ ...first, checkoutSessionId: 'cs_fabricated' })).rejects.toThrow(
      'BILLING_CHECKOUT_REQUIRED',
    );
    expect(await apply(first)).toMatchObject({ applied: true });
    const [paid] =
      await sql`select status from public.billing_checkout_requests where id=${request.id}`;
    const [pending] =
      await sql`select status from public.billing_checkout_requests where id=${unrelated.id}`;
    expect(paid?.status).toBe('completed');
    expect(pending?.status).toBe('pending');
  });

  it('uses the portal for an existing Stripe subscription and requires fresh Checkout after cancellation', async () => {
    const first = event({ checkoutSessionId: 'cs_first' });
    const request = await checkout('growth');
    await sql`select private.register_billing_session(${request.id},'stripe','cs_first',${first.subscription.customerId})`;
    await apply(first);
    await expect(checkout('solo')).rejects.toThrow('BILLING_PORTAL_REQUIRED');
    await apply(
      event({
        eventCreatedAt: new Date(Date.now() + 10).toISOString(),
        subscription: { ...first.subscription, status: 'canceled' },
      }),
    );
    expect(
      await apply(
        event({
          eventCreatedAt: new Date(Date.now() + 20).toISOString(),
          subscription: first.subscription,
        }),
      ),
    ).toMatchObject({ stale: true, applied: false });
    const replacement = event({
      eventCreatedAt: new Date(Date.now() + 30).toISOString(),
      checkoutSessionId: 'cs_replacement',
      subscription: { ...first.subscription, id: 'sub_replacement' },
    });
    await expect(apply(replacement)).rejects.toThrow('BILLING_CHECKOUT_REQUIRED');
    const next = await checkout('growth');
    await sql`select private.register_billing_session(${next.id},'stripe','cs_replacement',${first.subscription.customerId})`;
    expect(await apply(replacement)).toMatchObject({ applied: true });
  });
  it('limits the bridge to exact functions with no table, anonymous, or member permissions', async () => {
    const [row] =
      await sql`select has_table_privilege('threadsignal_billing_api','public.subscriptions','select') as table_access,has_function_privilege('anon','private.apply_billing_event(jsonb)','execute') as anonymous,has_function_privilege('authenticated','private.apply_billing_event(jsonb)','execute') as member`;
    expect(row).toMatchObject({ table_access: false, anonymous: false, member: false });
    await expect(
      asUser(actors.owner, (tx) => tx`select * from public.billing_events`),
    ).rejects.toThrow('permission denied');
    await expect(
      asUser(actors.owner, (tx) => tx`select * from public.notification_deliveries`),
    ).rejects.toThrow('permission denied');
  });
  it('stores preferences for the current member only and validates quiet hours/categories', async () => {
    expect(await setPreferences()).toMatchObject({
      digest_time: '00:00',
      minimum_score: 90,
      timezone: 'UTC',
    });
    const disabled = { ...preferences, categories: { ...categories, daily_digest: false } };
    expect((await setPreferences(disabled, actors.viewer)).categories.daily_digest).toBe(false);
    expect((await setPreferences()).categories.daily_digest).toBe(true);
    await expect(setPreferences(preferences, actors.other)).rejects.toThrow('FORBIDDEN');
    await expect(setPreferences({ ...preferences, quiet_start: '22:00' })).rejects.toThrow(
      'INVALID_NOTIFICATION_PREFERENCES',
    );
    await expect(
      setPreferences({ ...preferences, quiet_start: '22:00', quiet_end: '22:00' }),
    ).rejects.toThrow('INVALID_NOTIFICATION_PREFERENCES');
    await expect(
      setPreferences({ ...preferences, categories: { ...categories, arbitrary: true } }),
    ).rejects.toThrow('INVALID_NOTIFICATION_PREFERENCES');
  });
  it('deduplicates notification jobs, fences leases, and returns console suppression without recipient history', async () => {
    const key = randomUUID();
    const id = await enqueue('welcome', key);
    expect(id).toBeTypeOf('string');
    expect(await enqueue('welcome', key)).toBeNull();
    const result = await claim(id!);
    expect(result.value).toMatchObject({
      attempt: 1,
      type: 'welcome',
      recipient: `${actors.owner}@phase7.example`,
    });
    expect((await claim(id!)).value).toBeNull();
    const [wrong] =
      await sql`select private.finish_notification(${id},${randomUUID()},'suppressed','console','console_fixture',null) as value`;
    expect(wrong?.value).toBe(false);
    const [done] =
      await sql`select private.finish_notification(${id},${result.lease},'suppressed','console','console_fixture',null) as value`;
    expect(done?.value).toBe(true);
    const [history] = await asUser(
      actors.owner,
      (tx) => tx`select public.list_notification_deliveries(${organization}) as value`,
    );
    expect(history?.value).toHaveLength(1);
    expect(history?.value[0]).toMatchObject({
      status: 'suppressed',
      provider: 'console',
      attempts: 1,
    });
    expect(history?.value[0]).not.toHaveProperty('recipient');
    const [other] = await asUser(
      actors.member,
      (tx) => tx`select public.list_notification_deliveries(${organization}) as value`,
    );
    expect(other?.value).toEqual([]);
  });
  it('rechecks category disable, quiet hours in organization timezone, and current source presence', async () => {
    await setPreferences({ ...preferences, categories: { ...categories, welcome: false } });
    expect((await claim((await enqueue())!)).value).toBeNull();
    await sql`update public.organizations set timezone='Asia/Kolkata' where id=${organization}`;
    const [time] =
      await sql`select to_char((now() at time zone 'Asia/Kolkata')-interval '1 minute','HH24:MI') as start,to_char((now() at time zone 'Asia/Kolkata')+interval '1 hour','HH24:MI') as finish`;
    await setPreferences({
      ...preferences,
      quiet_start: String(time?.start),
      quiet_end: String(time?.finish),
    });
    const id = (await enqueue())!;
    expect((await claim(id)).value).toBeNull();
    const [delayed] =
      await sql`select attempts,available_at>now() as future,status from public.notification_deliveries where id=${id}`;
    expect(delayed).toMatchObject({ attempts: 0, future: true, status: 'queued' });
    await setPreferences();
    expect(
      (
        await claim(
          (await enqueue('high_score_alert', randomUUID(), {
            opportunity_id: randomUUID(),
            score: 99,
          }))!,
        )
      ).value,
    ).toBeNull();
    expect(
      (
        await claim(
          (await enqueue('ingestion_complete', randomUUID(), {
            source_id: randomUUID(),
            count: 2,
          }))!,
        )
      ).value,
    ).toBeNull();
  });
  it('retries delivery at most three times and rejects expired lease completion', async () => {
    const id = (await enqueue())!;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await claim(id);
      expect(result.value?.attempt).toBe(attempt);
      await sql`select private.finish_notification(${id},${result.lease},'retry','console',null,'PROVIDER_UNAVAILABLE')`;
      await sql`update public.notification_deliveries set available_at=now() where id=${id}`;
    }
    expect((await claim(id)).value).toBeNull();
    const [failed] =
      await sql`select status,attempts from public.notification_deliveries where id=${id}`;
    expect(failed).toMatchObject({ status: 'failed', attempts: 3 });
    const abandoned = (await enqueue())!;
    const lease = await claim(abandoned);
    await sql`update public.notification_deliveries set lease_expires_at=now()-interval '1 second' where id=${abandoned}`;
    const [expired] =
      await sql`select private.finish_notification(${abandoned},${lease.lease},'sent','resend','fixture_message',null) as value`;
    expect(expired?.value).toBe(false);
    await sql`select private.schedule_notifications(100)`;
    expect((await claim(abandoned)).value?.attempt).toBe(2);
  });
  it('schedules paid daily digests and trial warnings once and suppresses a downgraded digest', async () => {
    await setPreferences();
    await sql`update public.subscriptions set current_period_end=now()+interval '1 day' where organization_id=${organization}`;
    await sql`select private.schedule_notifications(100)`;
    await sql`select private.schedule_notifications(100)`;
    const [trial] =
      await sql`select count(*)::integer as value from public.notification_deliveries where organization_id=${organization} and user_id=${actors.owner} and type='trial_ending'`;
    expect(trial?.value).toBe(1);
    await complete((await checkout('solo')).id);
    await sql`select private.schedule_notifications(100)`;
    await sql`select private.schedule_notifications(100)`;
    const rows =
      await sql`select id from public.notification_deliveries where organization_id=${organization} and user_id=${actors.owner} and type='daily_digest'`;
    expect(rows).toHaveLength(1);
    await sql`update public.subscriptions set plan_key='trial' where organization_id=${organization}`;
    expect((await claim(String(rows[0]?.id))).value).toBeNull();
  });

  it('queues only threshold-crossing alerts and rechecks the current score and deleted thread', async () => {
    await setPreferences();
    const [brand] = await asUser(
      actors.owner,
      (tx) =>
        tx`select public.save_brand(${organization},null,${tx.json({ ...demoBrand, competitors: [] })}) as id`,
    );
    const name = `p7_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const [community] =
      await sql`insert into public.subreddits(name,display_name) values(${name},${name}) returning id`;
    const subreddit = String(community?.id);
    communities.push(subreddit);
    const [post] =
      await sql`insert into public.reddit_posts(provider,provider_post_id,subreddit_id,title,body,created_at_provider) values('mock',${randomUUID().replaceAll('-', '')},${subreddit},'Synthetic billing opportunity','A synthetic fixture.',now()) returning id`;
    const [opportunity] =
      await sql`insert into public.opportunities(organization_id,brand_id,reddit_post_id,subreddit_id,summary,user_need,intent_category,semantic_relevance,buying_intent,freshness,engagement_velocity,rule_fit,competitor_context,penalty_score,final_score,risk_level,suggested_action,reasoning_summary,input_checksum)
      values(${organization},${String(brand?.id)},${String(post?.id)},${subreddit},'Synthetic fixture','A documented need','recommendation',90,90,90,90,90,90,0,89,'low','reply','Synthetic test',${'a'.repeat(64)}) returning id`;
    const [before] =
      await sql`select count(*)::integer as value from public.notification_deliveries where organization_id=${organization} and type='high_score_alert'`;
    expect(before?.value).toBe(0);
    await sql`update public.opportunities set final_score=95 where id=${String(opportunity?.id)}`;
    const notices =
      await sql`select id from public.notification_deliveries where organization_id=${organization} and user_id=${actors.owner} and type='high_score_alert'`;
    expect(notices).toHaveLength(1);
    await sql`update public.opportunities set final_score=97 where id=${String(opportunity?.id)}`;
    const claimed = await claim(String(notices[0]?.id));
    expect(claimed.value?.payload).toMatchObject({ score: 97 });
    const second = (await enqueue('high_score_alert', randomUUID(), {
      opportunity_id: String(opportunity?.id),
      score: 97,
    }))!;
    await sql`update public.reddit_posts set is_deleted=true,title=null,body=null,author_name=null,permalink=null,flair=null,raw_metadata='{}',purged_at=now() where id=${String(post?.id)}`;
    expect((await claim(second)).value).toBeNull();
  });

  it('emits ingestion results per generation and suppresses superseded completion', async () => {
    const [brand] = await asUser(
      actors.owner,
      (tx) =>
        tx`select public.save_brand(${organization},null,${tx.json({ ...demoBrand, competitors: [] })}) as id`,
    );
    const [source] =
      await sql`insert into public.knowledge_sources(organization_id,brand_id,name,type,status) values(${organization},${String(brand?.id)},'Notification fixture','manual','processing') returning id`;
    await sql`update public.knowledge_sources set status='ready',page_count=2 where id=${String(source?.id)}`;
    const [notice] =
      await sql`select id from public.notification_deliveries where organization_id=${organization} and user_id=${actors.owner} and type='ingestion_complete'`;
    expect(notice?.id).toBeDefined();
    await sql`update public.knowledge_sources set status='processing',generation=generation+1 where id=${String(source?.id)}`;
    expect((await claim(String(notice?.id))).value).toBeNull();
    await sql`update public.knowledge_sources set status='failed' where id=${String(source?.id)}`;
    const [failure] =
      await sql`select id from public.notification_deliveries where organization_id=${organization} and user_id=${actors.owner} and type='ingestion_failed'`;
    expect((await claim(String(failure?.id))).value?.type).toBe('ingestion_failed');
  });

  it('blocks expired trial usage even before maintenance runs', async () => {
    await sql`update public.subscriptions set current_period_start=now()-interval '8 days',current_period_end=now()-interval '1 day' where organization_id=${organization}`;
    await expect(sql`select private.reserve_draft_usage(${organization})`).rejects.toThrow(
      'TRIAL_EXPIRED',
    );
    const [row] = await asUser(
      actors.owner,
      (tx) => tx`select public.get_billing_subscription(${organization}) as value`,
    );
    expect(row?.value).toMatchObject({ active: false, status: 'expired' });
  });

  it('bounds provider retry to 23 hours and never resends a key to a changed recipient', async () => {
    const expired = (await enqueue())!;
    const original = await claim(expired);
    await sql`select private.finish_notification(${expired},${original.lease},'retry','resend',null,'PROVIDER_UNAVAILABLE')`;
    await sql`update public.notification_deliveries set available_at=now(),first_attempt_at=now()-interval '24 hours' where id=${expired}`;
    expect((await claim(expired)).value).toBeNull();
    const [row] =
      await sql`select status,error_code,attempts from public.notification_deliveries where id=${expired}`;
    expect(row).toMatchObject({
      status: 'failed',
      error_code: 'NOTIFICATION_RETRY_WINDOW_EXPIRED',
      attempts: 1,
    });
    const changed = (await enqueue())!;
    const recipient = await claim(changed);
    await sql`select private.finish_notification(${changed},${recipient.lease},'retry','resend',null,'PROVIDER_UNAVAILABLE')`;
    await sql`update public.notification_deliveries set available_at=now() where id=${changed}`;
    await sql`update auth.users set email=${`${actors.owner}@updated.phase7.example`} where id=${actors.owner}`;
    expect((await claim(changed)).value).toBeNull();
    const [suppressed] =
      await sql`select status,error_code,attempts from public.notification_deliveries where id=${changed}`;
    expect(suppressed).toMatchObject({
      status: 'suppressed',
      error_code: 'NOTIFICATION_CONTEXT_CHANGED',
      attempts: 1,
    });
    await sql`update auth.users set email=${`${actors.owner}@phase7.example`} where id=${actors.owner}`;
  });

  it('suppresses lifecycle notices made obsolete by an upgrade or payment recovery', async () => {
    await setPreferences();
    await sql`update public.subscriptions set current_period_end=now()+interval '1 day' where organization_id=${organization}`;
    await sql`select private.schedule_notifications(100)`;
    const [trial] =
      await sql`select id from public.notification_deliveries where organization_id=${organization} and user_id=${actors.owner} and type='trial_ending'`;
    await sql`insert into public.usage_counters(organization_id,metric,period_start,period_end,quantity) select organization_id,'ai_drafts',current_period_start,current_period_end,10 from public.subscriptions where organization_id=${organization}`;
    const [usage] =
      await sql`select id from public.notification_deliveries where organization_id=${organization} and user_id=${actors.owner} and type='usage_limit'`;
    await complete((await checkout('solo')).id);
    expect((await claim(String(trial?.id))).value).toBeNull();
    expect((await claim(String(usage?.id))).value).toBeNull();
    await manage('payment_failed');
    const [payment] =
      await sql`select id from public.notification_deliveries where organization_id=${organization} and user_id=${actors.owner} and type='payment_failed'`;
    await manage('payment_recovered');
    expect((await claim(String(payment?.id))).value).toBeNull();
  });

  it('reschedules a queued digest when its preferred time moves later and suppresses old local dates', async () => {
    await complete((await checkout('solo')).id);
    const [zone] =
      await sql`select name from (values('UTC'),('Pacific/Honolulu'),('Asia/Tokyo')) as zones(name) where extract(hour from now() at time zone name)<12 limit 1`;
    await sql`update public.organizations set timezone=${String(zone?.name)} where id=${organization}`;
    await setPreferences();
    await sql`select private.schedule_notifications(100)`;
    const [digest] =
      await sql`select id from public.notification_deliveries where organization_id=${organization} and user_id=${actors.owner} and type='daily_digest'`;
    expect(digest?.id).toBeDefined();
    const [clock] =
      await sql`select to_char((now() at time zone ${String(zone?.name)})+interval '2 hours','HH24:MI') as later,((now() at time zone ${String(zone?.name)})::date-1)::text as yesterday`;
    await setPreferences({ ...preferences, digest_time: String(clock?.later) });
    expect((await claim(String(digest?.id))).value).toBeNull();
    const [delayed] =
      await sql`select status,attempts,available_at>now()+interval '1 hour' as future from public.notification_deliveries where id=${String(digest?.id)}`;
    expect(delayed).toMatchObject({ status: 'queued', attempts: 0, future: true });
    await setPreferences();
    await sql`update public.notification_deliveries set available_at=now() where id=${String(digest?.id)}`;
    expect((await claim(String(digest?.id))).value?.type).toBe('daily_digest');
    const stale = (await enqueue('daily_digest', String(clock?.yesterday), { count: 99 }))!;
    expect((await claim(stale)).value).toBeNull();
    const [old] =
      await sql`select status,error_code,attempts from public.notification_deliveries where id=${stale}`;
    expect(old).toMatchObject({
      status: 'suppressed',
      error_code: 'NOTIFICATION_DIGEST_STALE',
      attempts: 0,
    });
  });
});
