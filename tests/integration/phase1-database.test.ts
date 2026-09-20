import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { PLANS } from '../../packages/config/src/plans.js';
import { localDatabaseUrl, verifyDocker } from '../../scripts/service-utils.mjs';

const users = Object.fromEntries(
  ['owner', 'admin', 'member', 'viewer', 'other', 'invitee', 'stranger', 'newcomer'].map((role) => [
    role,
    randomUUID(),
  ]),
) as Record<
  'owner' | 'admin' | 'member' | 'viewer' | 'other' | 'invitee' | 'stranger' | 'newcomer',
  string
>;
const runId = randomUUID().slice(0, 8);
const email = (id: string) => `${id}@phase1.example`;
const tokenHash = () => createHash('sha256').update(randomUUID()).digest('hex');

describe('Phase 1 authenticated PostgreSQL contracts', () => {
  let sql: ReturnType<typeof postgres>;
  let organization: string;
  let otherOrganization: string;

  async function asUser<T>(id: string, operation: (tx: postgres.TransactionSql) => Promise<T>) {
    return sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub', ${id}, true), set_config('request.jwt.claims', ${JSON.stringify({ sub: id, role: 'authenticated' })}, true)`;
      await tx`set local role authenticated`;
      return operation(tx);
    });
  }

  beforeAll(async () => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 6, connect_timeout: 5, onnotice: () => {} });
    for (const [name, id] of Object.entries(users)) {
      await sql`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(${id},${email(id)},now(),${sql.json({ full_name: `Fixture ${name}`, is_platform_admin: true })})`;
    }
    const created = await asUser(
      users.owner,
      (tx) =>
        tx`select public.create_organization('Fixture A', ${`fixture-a-${runId}`}, ${email(users.owner)}) as id`,
    );
    organization = String(created[0]?.id);
    const other = await asUser(
      users.other,
      (tx) =>
        tx`select public.create_organization('Fixture B', ${`fixture-b-${runId}`}, ${email(users.other)}) as id`,
    );
    otherOrganization = String(other[0]?.id);
    for (const role of ['admin', 'member', 'viewer'] as const) {
      await sql`insert into public.organization_members(organization_id,user_id,role) values(${organization},${users[role]},${role})`;
    }
  });

  beforeEach(async () => {
    await sql`delete from public.organization_invitations where organization_id in (${organization},${otherOrganization})`;
    await sql`delete from public.organization_data_requests where organization_id in (${organization},${otherOrganization})`;
    await sql`delete from public.organization_members where organization_id = ${organization} and user_id not in (${users.owner},${users.admin},${users.member},${users.viewer})`;
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      await sql`update public.organization_members set role = ${role} where organization_id = ${organization} and user_id = ${users[role]}`;
    }
    await sql`update public.organizations set status = 'active', deleted_at = null where id = ${organization}`;
    await sql`update public.subscriptions set plan_key = 'growth', status = 'active', current_period_start = now(), current_period_end = now() + interval '30 days' where organization_id = ${organization}`;
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      await sql`delete from public.organizations where slug like ${`fixture-%-${runId}`}`;
      await sql`delete from auth.users where id in ${sql(Object.values(users))}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it('mirrors every centralized plan price, limit and feature exactly', async () => {
    const rows = await sql`select * from public.plan_catalog order by key`;
    expect(rows).toHaveLength(3);
    for (const plan of Object.values(PLANS)) {
      expect(rows.find((row) => row.key === plan.key)).toMatchObject({
        name: plan.name,
        monthly_price_usd: plan.monthlyPriceUsd,
        trial_days: plan.trialDays,
        organization_limit: plan.limits.organizations,
        brand_limit: plan.limits.brands,
        subreddit_limit: plan.limits.monitoredSubreddits,
        opportunity_limit: plan.limits.opportunities,
        ai_draft_limit: plan.limits.aiDrafts,
        member_limit: plan.limits.members,
        opportunity_period: plan.opportunityPeriod,
        features: plan.features,
      });
    }
  });

  it('creates a seven-day trial atomically and prevents repeated onboarding', async () => {
    const trial = await asUser(
      users.other,
      (tx) => tx`select * from public.get_organization_plan(${otherOrganization})`,
    );
    expect(trial[0]).toMatchObject({
      plan_key: 'trial',
      status: 'trialing',
      seat_limit: 1,
      seats_used: '1',
      seats_reserved: '0',
    });
    const dates =
      await sql`select extract(epoch from (trial_ends_at - trial_started_at)) as seconds from public.organizations where id = ${otherOrganization}`;
    expect(Number(dates[0]?.seconds)).toBe(7 * 24 * 3600);
    await expect(
      asUser(
        users.other,
        (tx) =>
          tx`select public.create_organization('Again', ${`again-${runId}`}, ${email(users.other)})`,
      ),
    ).rejects.toThrow('ORGANIZATION_LIMIT');
  });

  it('never promotes platform administrators from user-controlled Auth metadata', async () => {
    const profiles = await asUser(
      users.owner,
      (tx) => tx`select id,is_platform_admin from public.profiles`,
    );
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ id: users.owner, is_platform_admin: false });
    await expect(
      asUser(
        users.owner,
        (tx) => tx`update public.profiles set is_platform_admin = true where id = ${users.owner}`,
      ),
    ).rejects.toThrow(/permission denied/);
    await asUser(
      users.owner,
      (tx) =>
        tx`update public.profiles set full_name = 'Updated fixture' where id = ${users.owner}`,
    );
    const crossProfile = await asUser(
      users.owner,
      (tx) =>
        tx`update public.profiles set full_name = 'Forged' where id = ${users.other} returning id`,
    );
    expect(crossProfile).toHaveLength(0);
  });

  it('serializes simultaneous onboarding requests into one trial organization', async () => {
    const attempts = await Promise.allSettled([
      asUser(
        users.newcomer,
        (tx) =>
          tx`select public.create_organization('New workspace', ${`fixture-new-a-${runId}`}, ${email(users.newcomer)})`,
      ),
      asUser(
        users.newcomer,
        (tx) =>
          tx`select public.create_organization('New workspace', ${`fixture-new-b-${runId}`}, ${email(users.newcomer)})`,
      ),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = attempts.find((result) => result.status === 'rejected');
    expect(failed?.status === 'rejected' ? String(failed.reason) : '').toContain(
      'ORGANIZATION_LIMIT',
    );
  });

  it('isolates organization, membership, billing, invitations and audit reads across tenants', async () => {
    await asUser(
      users.owner,
      (tx) =>
        tx`select public.invite_member(${organization},${email(users.invitee)},'member',${tokenHash()})`,
    );
    for (const query of [
      (tx: postgres.TransactionSql) =>
        tx`select id from public.organizations where id = ${otherOrganization}`,
      (tx: postgres.TransactionSql) =>
        tx`select * from public.organization_members where organization_id = ${otherOrganization}`,
      (tx: postgres.TransactionSql) =>
        tx`select * from public.subscriptions where organization_id = ${otherOrganization}`,
      (tx: postgres.TransactionSql) =>
        tx`select id from public.organization_invitations where organization_id = ${organization}`,
      (tx: postgres.TransactionSql) =>
        tx`select * from public.audit_logs where organization_id = ${organization}`,
    ].entries()) {
      const [index, operation] = query;
      expect(await asUser(index < 3 ? users.owner : users.other, operation)).toHaveLength(0);
    }
    await expect(
      asUser(
        users.other,
        (tx) => tx`select * from public.get_organization_settings(${organization})`,
      ),
    ).rejects.toThrow('FORBIDDEN');
    await expect(
      asUser(users.other, (tx) => tx`select * from public.get_organization_plan(${organization})`),
    ).rejects.toThrow('FORBIDDEN');
    await expect(
      asUser(
        users.other,
        (tx) => tx`select * from public.list_organization_members(${organization})`,
      ),
    ).rejects.toThrow('FORBIDDEN');
  });

  it('enforces settings roles and hides billing contact and subscription details from nonowners', async () => {
    await asUser(
      users.owner,
      (tx) =>
        tx`select public.update_organization(${organization},'Owner update',${email(users.owner)},'UTC','USD')`,
    );
    await asUser(
      users.admin,
      (tx) =>
        tx`select public.update_organization(${organization},'Admin update',null,'Asia/Kolkata','USD')`,
    );
    for (const role of ['member', 'viewer', 'other'] as const) {
      await expect(
        asUser(
          users[role],
          (tx) =>
            tx`select public.update_organization(${organization},'Forbidden',null,'UTC','USD')`,
        ),
      ).rejects.toThrow('FORBIDDEN');
    }
    for (const role of ['admin', 'member', 'viewer'] as const) {
      expect(
        await asUser(
          users[role],
          (tx) => tx`select * from public.subscriptions where organization_id = ${organization}`,
        ),
      ).toHaveLength(0);
      const settings = await asUser(
        users[role],
        (tx) => tx`select * from public.get_organization_settings(${organization})`,
      );
      expect(settings[0]?.billing_email).toBeNull();
      expect(
        await asUser(
          users[role],
          (tx) => tx`select * from public.get_organization_plan(${organization})`,
        ),
      ).toHaveLength(1);
    }
    await expect(
      asUser(
        users.admin,
        (tx) =>
          tx`select public.update_organization(${organization},'Admin update','forged@example.com','UTC','USD')`,
      ),
    ).rejects.toThrow('BILLING_OWNER_ONLY');
    await expect(
      asUser(users.owner, (tx) => tx`select billing_email from public.organizations`),
    ).rejects.toThrow(/permission denied/);
  });

  it('rejects direct table mutations even when a user knows another tenant ID', async () => {
    await expect(
      asUser(
        users.owner,
        (tx) =>
          tx`update public.subscriptions set plan_key = 'growth' where organization_id = ${otherOrganization}`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(
        users.member,
        (tx) =>
          tx`insert into public.organization_members(organization_id,user_id,role) values(${otherOrganization},${users.member},'owner')`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(
        users.owner,
        (tx) =>
          tx`update public.organizations set trial_ends_at = now() + interval '1 year' where id = ${organization}`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(
        users.owner,
        (tx) =>
          tx`insert into public.audit_logs(action,target_type) values('forged','organization')`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(
        users.owner,
        (tx) => tx`select private.audit(${organization},'forged','organization',${organization})`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('denies anonymous table access and mutation RPC execution', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role anon`;
        return tx`select id from public.organizations`;
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role anon`;
        return tx`select public.create_organization('Anonymous','anonymous', 'anon@example.com')`;
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it('keeps owner authority protected and never removes or demotes the final owner', async () => {
    await expect(
      asUser(
        users.admin,
        (tx) => tx`select public.change_member_role(${organization},${users.owner},'member')`,
      ),
    ).rejects.toThrow('OWNERSHIP_OWNER_ONLY');
    await expect(
      asUser(
        users.admin,
        (tx) => tx`select public.change_member_role(${organization},${users.admin},'owner')`,
      ),
    ).rejects.toThrow('OWNERSHIP_OWNER_ONLY');
    await expect(
      asUser(users.admin, (tx) => tx`select public.remove_member(${organization},${users.owner})`),
    ).rejects.toThrow('OWNERSHIP_OWNER_ONLY');
    await expect(
      asUser(
        users.owner,
        (tx) => tx`select public.change_member_role(${organization},${users.owner},'admin')`,
      ),
    ).rejects.toThrow('LAST_OWNER');
    await expect(
      asUser(users.owner, (tx) => tx`select public.remove_member(${organization},${users.owner})`),
    ).rejects.toThrow('LAST_OWNER');
    await asUser(
      users.admin,
      (tx) => tx`select public.change_member_role(${organization},${users.member},'viewer')`,
    );
    await expect(
      asUser(
        users.viewer,
        (tx) => tx`select public.remove_member(${organization},${users.member})`,
      ),
    ).rejects.toThrow('FORBIDDEN');
  });

  it('reserves the final Growth seat and serializes simultaneous invitations', async () => {
    const attempts = await Promise.allSettled([
      asUser(
        users.owner,
        (tx) =>
          tx`select public.invite_member(${organization},${email(users.invitee)},'member',${tokenHash()})`,
      ),
      asUser(
        users.admin,
        (tx) =>
          tx`select public.invite_member(${organization},${email(users.stranger)},'viewer',${tokenHash()})`,
      ),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const failure = attempts.find((result) => result.status === 'rejected');
    expect(failure?.status === 'rejected' ? String(failure.reason) : '').toContain('SEAT_LIMIT');
    const plan = await asUser(
      users.member,
      (tx) => tx`select * from public.get_organization_plan(${organization})`,
    );
    expect(plan[0]).toMatchObject({ seats_used: '4', seats_reserved: '1', seat_limit: 5 });
  });

  it('protects the final owner during concurrent owner demotions', async () => {
    await asUser(
      users.owner,
      (tx) => tx`select public.change_member_role(${organization},${users.admin},'owner')`,
    );
    const attempts = await Promise.allSettled([
      asUser(
        users.owner,
        (tx) => tx`select public.change_member_role(${organization},${users.owner},'admin')`,
      ),
      asUser(
        users.admin,
        (tx) => tx`select public.change_member_role(${organization},${users.admin},'admin')`,
      ),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = attempts.find((result) => result.status === 'rejected');
    expect(failed?.status === 'rejected' ? String(failed.reason) : '').toContain('LAST_OWNER');
  });

  it('accepts only a matching verified user once and stores no readable invitation hashes', async () => {
    const hash = tokenHash();
    await asUser(
      users.owner,
      (tx) =>
        tx`select public.invite_member(${organization},${email(users.invitee).toUpperCase()},'member',${hash})`,
    );
    await expect(
      asUser(users.owner, (tx) => tx`select token_hash from public.organization_invitations`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(users.stranger, (tx) => tx`select public.accept_invitation(${hash})`),
    ).rejects.toThrow('INVITATION_INVALID');
    await sql`update auth.users set email_confirmed_at = null where id = ${users.invitee}`;
    await expect(
      asUser(users.invitee, (tx) => tx`select public.accept_invitation(${hash})`),
    ).rejects.toThrow('INVITATION_INVALID');
    await sql`update auth.users set email_confirmed_at = now() where id = ${users.invitee}`;
    const accepted = await asUser(
      users.invitee,
      (tx) => tx`select public.accept_invitation(${hash}) as organization_id`,
    );
    expect(accepted[0]?.organization_id).toBe(organization);
    await expect(
      asUser(users.invitee, (tx) => tx`select public.accept_invitation(${hash})`),
    ).rejects.toThrow('INVITATION_INVALID');
    expect(
      await asUser(
        users.invitee,
        (tx) => tx`select id from public.organizations where id = ${organization}`,
      ),
    ).toHaveLength(1);
  });

  it('rejects revoked and expired invitations and releases their seat reservations', async () => {
    const revoked = tokenHash();
    const invitation = await asUser(
      users.admin,
      (tx) =>
        tx`select public.invite_member(${organization},${email(users.invitee)},'member',${revoked}) as id`,
    );
    await asUser(
      users.admin,
      (tx) => tx`select public.revoke_invitation(${String(invitation[0]?.id)})`,
    );
    await expect(
      asUser(users.invitee, (tx) => tx`select public.accept_invitation(${revoked})`),
    ).rejects.toThrow('INVITATION_INVALID');
    const expired = tokenHash();
    await asUser(
      users.owner,
      (tx) =>
        tx`select public.invite_member(${organization},${email(users.invitee)},'member',${expired})`,
    );
    await sql`update public.organization_invitations set expires_at = now() - interval '1 second' where token_hash = ${expired}`;
    await expect(
      asUser(users.invitee, (tx) => tx`select public.accept_invitation(${expired})`),
    ).rejects.toThrow('INVITATION_INVALID');
    await asUser(
      users.owner,
      (tx) =>
        tx`select public.invite_member(${organization},${email(users.stranger)},'viewer',${tokenHash()})`,
    );
  });

  it('rejects duplicate members, unauthorized invitations and one-seat trial usage', async () => {
    await expect(
      asUser(
        users.owner,
        (tx) =>
          tx`select public.invite_member(${organization},${email(users.member)},'member',${tokenHash()})`,
      ),
    ).rejects.toThrow('ALREADY_MEMBER');
    await expect(
      asUser(
        users.member,
        (tx) =>
          tx`select public.invite_member(${organization},${email(users.invitee)},'member',${tokenHash()})`,
      ),
    ).rejects.toThrow('FORBIDDEN');
    await expect(
      asUser(
        users.admin,
        (tx) =>
          tx`select public.invite_member(${organization},${email(users.invitee)},'owner',${tokenHash()})`,
      ),
    ).rejects.toThrow('OWNERSHIP_OWNER_ONLY');
    await expect(
      asUser(
        users.other,
        (tx) =>
          tx`select public.invite_member(${otherOrganization},${email(users.invitee)},'viewer',${tokenHash()})`,
      ),
    ).rejects.toThrow('SEAT_LIMIT');
  });

  it('rechecks seat limits when a pending invite is accepted after a downgrade', async () => {
    const hash = tokenHash();
    await asUser(
      users.owner,
      (tx) =>
        tx`select public.invite_member(${organization},${email(users.invitee)},'member',${hash})`,
    );
    await sql`update public.subscriptions set plan_key = 'solo' where organization_id = ${organization}`;
    await expect(
      asUser(users.invitee, (tx) => tx`select public.accept_invitation(${hash})`),
    ).rejects.toThrow('SEAT_LIMIT');
    expect(
      await asUser(
        users.owner,
        (tx) =>
          tx`select * from public.organization_members where organization_id = ${organization}`,
      ),
    ).toHaveLength(4);
  });

  it('enforces expiry on the server while preserving read access and owner data requests', async () => {
    await sql`update public.subscriptions set plan_key = 'trial', status = 'trialing', current_period_start = now() - interval '8 days', current_period_end = now() - interval '1 day' where organization_id = ${organization}`;
    const plan = await asUser(
      users.viewer,
      (tx) => tx`select * from public.get_organization_plan(${organization})`,
    );
    expect(plan[0]?.status).toBe('expired');
    await expect(
      asUser(
        users.owner,
        (tx) =>
          tx`select public.invite_member(${organization},${email(users.invitee)},'member',${tokenHash()})`,
      ),
    ).rejects.toThrow('TRIAL_EXPIRED');
    await asUser(
      users.owner,
      (tx) => tx`select public.request_organization_data(${organization},'export')`,
    );
    await expect(
      asUser(
        users.admin,
        (tx) => tx`select public.request_organization_data(${organization},'delete')`,
      ),
    ).rejects.toThrow('FORBIDDEN');
    await asUser(
      users.owner,
      (tx) => tx`select public.request_organization_data(${organization},'export')`,
    );
    const requests = await asUser(
      users.owner,
      (tx) =>
        tx`select id,organization_id,requested_by,kind,status,created_at,updated_at,
          confirmed_at,completed_at,expires_at,error_code
          from public.organization_data_requests where organization_id = ${organization}`,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      organization_id: organization,
      requested_by: users.owner,
      kind: 'export',
      status: 'requested',
      confirmed_at: null,
      completed_at: null,
      expires_at: null,
      error_code: null,
    });
    for (const column of ['artifact_path', 'artifact_sha256', 'artifact_bytes']) {
      await expect(
        asUser(
          users.owner,
          (tx) =>
            tx`select ${tx(column)} from public.organization_data_requests where organization_id = ${organization}`,
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('fails closed for suspended tenants and audits successful mutations without tokens', async () => {
    await sql`update public.organizations set status = 'suspended' where id = ${organization}`;
    expect(
      await asUser(
        users.owner,
        (tx) => tx`select id from public.organizations where id = ${organization}`,
      ),
    ).toHaveLength(0);
    await expect(
      asUser(
        users.owner,
        (tx) => tx`select public.update_organization(${organization},'Suspended',null,'UTC','USD')`,
      ),
    ).rejects.toThrow('FORBIDDEN');
    await sql`update public.organizations set status = 'active' where id = ${organization}`;
    const audit = await asUser(
      users.owner,
      (tx) =>
        tx`select action,metadata from public.audit_logs where organization_id = ${organization}`,
    );
    expect(audit.some((row) => row.action === 'organization.created')).toBe(true);
    expect(audit.every((row) => !JSON.stringify(row.metadata).includes('token'))).toBe(true);
  });
});
