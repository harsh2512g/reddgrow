import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDatabaseUrl, verifyDocker } from '../../scripts/service-utils.mjs';

describe('bounded invitation retention on rollback-only local fixtures', () => {
  let sql: postgres.Sql;
  beforeAll(() => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 1, connect_timeout: 5, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql?.end({ timeout: 3 });
  });

  async function isolated(run: (tx: postgres.TransactionSql, org: string) => Promise<void>) {
    const rollback = new Error('ROLL_BACK_INVITATION_RETENTION_FIXTURE');
    try {
      await sql.begin(async (tx) => {
        const org = randomUUID();
        await tx`insert into public.organizations(id,name,slug,billing_email) values(${org},'Invitation retention fixture',${`retention-${org}`},'owner@retention.example')`;
        // These existing rows are restored with the complete fixture rollback.
        // Isolate batch-count assertions from other developer/test invitations.
        await tx`delete from public.organization_invitations`;
        await run(tx, org);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }
  async function invitation(
    tx: postgres.TransactionSql,
    org: string,
    days: { expired: number; accepted?: number; revoked?: number },
  ) {
    const id = randomUUID();
    const tokenHash = createHash('sha256').update(id).digest('hex');
    await tx`insert into public.organization_invitations(id,organization_id,email,role,token_hash,expires_at,accepted_at,revoked_at)
      values(${id},${org},${`${id}@retention.example`},'member',${tokenHash},
        now()-${days.expired}*interval '1 day',
        case when ${days.accepted ?? null}::integer is null then null else now()-${days.accepted ?? 0}*interval '1 day' end,
        case when ${days.revoked ?? null}::integer is null then null else now()-${days.revoked ?? 0}*interval '1 day' end)`;
    return id;
  }

  it('retains live invitations and 30 days of terminal history, using the latest terminal action', async () => {
    await isolated(async (tx, org) => {
      const deleted = [
        await invitation(tx, org, { expired: 31 }),
        await invitation(tx, org, { expired: 60, accepted: 31 }),
        await invitation(tx, org, { expired: 60, revoked: 31 }),
      ];
      const retained = [
        await invitation(tx, org, { expired: -7 }),
        await invitation(tx, org, { expired: 30 }),
        await invitation(tx, org, { expired: 60, accepted: 1 }),
        await invitation(tx, org, { expired: 60, revoked: 1 }),
        await invitation(tx, org, { expired: 60, accepted: 40, revoked: 1 }),
        await invitation(tx, org, { expired: 60, accepted: 1, revoked: 40 }),
      ];
      expect(
        (await tx`select private.cleanup_expired_invitations(100) as deleted`)[0]?.deleted,
      ).toBe(3);
      expect(
        await tx`select id from public.organization_invitations where id in ${tx(deleted)}`,
      ).toHaveLength(0);
      const remaining =
        await tx`select id from public.organization_invitations where id in ${tx(retained)}`;
      expect(remaining.map((row) => row.id).sort()).toEqual(retained.sort());
      expect(
        (await tx`select private.cleanup_expired_invitations(100) as deleted`)[0]?.deleted,
      ).toBe(0);
    });
  });

  it('deletes the oldest bounded batch and rejects invalid or unbounded limits', async () => {
    await isolated(async (tx, org) => {
      const oldest = await invitation(tx, org, { expired: 60 });
      const middle = await invitation(tx, org, { expired: 50 });
      const newest = await invitation(tx, org, { expired: 40 });
      for (const limit of [null, 0, -1, 101])
        await expect(
          tx.savepoint(
            (nested) => nested`select private.cleanup_expired_invitations(${limit}::integer)`,
          ),
        ).rejects.toThrow('INVALID_MAINTENANCE_LIMIT');
      expect((await tx`select private.cleanup_expired_invitations(2) as deleted`)[0]?.deleted).toBe(
        2,
      );
      expect(
        await tx`select id from public.organization_invitations where id in (${oldest},${middle})`,
      ).toHaveLength(0);
      expect(
        await tx`select id from public.organization_invitations where id=${newest}`,
      ).toHaveLength(1);
      expect((await tx`select private.cleanup_expired_invitations(2) as deleted`)[0]?.deleted).toBe(
        1,
      );
    });
  });

  it('denies anonymous and authenticated callers access to global invitation cleanup', async () => {
    await isolated(async (tx) => {
      for (const role of ['anon', 'authenticated'] as const) {
        expect(
          (
            await tx`select has_function_privilege(${role},'private.cleanup_expired_invitations(integer)','EXECUTE') as allowed`
          )[0]?.allowed,
        ).toBe(false);
        await expect(
          tx.savepoint(async (nested) => {
            await nested.unsafe(`set local role ${role}`);
            await nested`select private.cleanup_expired_invitations(100)`;
          }),
        ).rejects.toMatchObject({ code: '42501' });
      }
    });
  });
});
