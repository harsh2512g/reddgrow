import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmailProvider, type EmailProvider } from '@threadsignal/email';
import {
  processNotification,
  startNotificationWorker,
} from '../../apps/worker/src/jobs/notifications';
import { parseWorkerConfig } from '../../apps/worker/src/config';
import { localEnvironment } from '../../scripts/isolation.mjs';
import { localDatabaseUrl, verifyDocker } from '../../scripts/service-utils.mjs';

describe('Phase7 Supabase notification delivery worker', () => {
  let sql: postgres.Sql, organization: string;
  const user = randomUUID();
  beforeAll(async () => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 4, connect_timeout: 5, onnotice: () => undefined });
    await sql`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(${user},${`${user}@notification.example`},now(),'{}')`;
    const [row] = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: user, role: 'authenticated' })},true)`;
      await tx`set local role authenticated`;
      return tx`select public.create_organization('Delivery fixture',${`delivery-${user}`},${`${user}@notification.example`}) as id`;
    });
    organization = String(row?.id);
  });
  beforeEach(async () => {
    await sql`delete from public.notification_deliveries where organization_id=${organization}`;
    await sql`delete from public.notification_preferences where organization_id=${organization}`;
  });
  afterAll(async () => {
    if (!sql) return;
    if (organization) await sql`delete from public.organizations where id=${organization}`;
    await sql`delete from auth.users where id=${user}`;
    await sql.end({ timeout: 5 });
  });
  async function enqueue() {
    const [row] =
      await sql`select private.enqueue_notification(${organization},${user},'welcome',${randomUUID()}) as id`;
    return String(row?.id);
  }
  it('a real BullMQ delivery deferred for quiet hours can be queued again without consuming an attempt', async () => {
    const id = await enqueue();
    await sql`update public.notification_preferences set quiet_start=(localtime-interval '1 minute')::time,quiet_end=(localtime+interval '1 hour')::time where organization_id=${organization} and user_id=${user}`;
    const prefix = `threadsignal-p7-integration-${randomUUID()}`;
    const config = {
      ...parseWorkerConfig({
        ...localEnvironment(),
        DATABASE_URL: localDatabaseUrl(),
        LOG_LEVEL: 'silent',
      }),
      queuePrefix: prefix,
    };
    const runtime = await startNotificationWorker(sql, config);
    const redis = new Redis({
      host: '127.0.0.1',
      port: 56379,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    try {
      await expect
        .poll(
          async () => {
            const [row] =
              await sql`select status,attempts,available_at>now() as deferred from public.notification_deliveries where id=${id}`;
            return row?.status === 'queued' && row?.attempts === 0 && row?.deferred;
          },
          { timeout: 5000 },
        )
        .toBe(true);
      await sql`update public.notification_preferences set quiet_start=null,quiet_end=null where organization_id=${organization} and user_id=${user}`;
      await sql`update public.notification_deliveries set available_at=now() where id=${id}`;
      await expect
        .poll(
          async () => {
            const [row] =
              await sql`select status,attempts,provider from public.notification_deliveries where id=${id}`;
            return row;
          },
          { timeout: 15000 },
        )
        .toMatchObject({ status: 'suppressed', attempts: 1, provider: 'console' });
    } finally {
      await runtime.stop();
      await redis.connect();
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 100);
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== '0');
      redis.disconnect();
    }
  });
  it('renders and suppresses console delivery without logging recipient or message body', async () => {
    const id = await enqueue(),
      info = vi.fn();
    expect(await processNotification(sql, id, createEmailProvider('console', { info }))).toEqual({
      processed: true,
      delivery: 'suppressed',
    });
    const [row] =
      await sql`select status,provider,provider_message_id,attempts from public.notification_deliveries where id=${id}`;
    expect(row).toMatchObject({ status: 'suppressed', provider: 'console', attempts: 1 });
    expect(info).toHaveBeenCalledOnce();
    expect(JSON.stringify(info.mock.calls)).not.toContain('@notification.example');
    expect(JSON.stringify(info.mock.calls)).not.toContain('Delivery fixture');
  });
  it('duplicate jobs share a SQL lease and produce one provider send', async () => {
    const id = await enqueue();
    const send = vi.fn<EmailProvider['send']>(async () => ({
      id: 'provider_fixture',
      delivery: 'queued' as const,
    }));
    const provider: EmailProvider = { mode: 'resend', send };
    const results = await Promise.all([
      processNotification(sql, id, provider),
      processNotification(sql, id, provider),
    ]);
    expect(send).toHaveBeenCalledOnce();
    expect(results.filter((r) => r.processed)).toHaveLength(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ idempotencyKey: `notification_${id}` });
    const [row] =
      await sql`select status,attempts from public.notification_deliveries where id=${id}`;
    expect(row).toMatchObject({ status: 'sent', attempts: 1 });
    await processNotification(sql, id, provider);
    expect(send).toHaveBeenCalledOnce();
  });
  it('provider failures retry at most three times and retain only safe error codes', async () => {
    const id = await enqueue();
    const send = vi.fn<EmailProvider['send']>(async () => {
      throw new Error('private recipient or upstream payload');
    });
    const provider: EmailProvider = { mode: 'resend', send };
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(await processNotification(sql, id, provider)).toEqual({
        processed: false,
        retry: true,
      });
      const [row] =
        await sql`select status,attempts,error_code from public.notification_deliveries where id=${id}`;
      expect(row).toMatchObject({
        status: attempt === 3 ? 'failed' : 'queued',
        attempts: attempt,
        error_code: 'NOTIFICATION_DELIVERY_FAILED',
      });
      if (attempt < 3)
        await sql`update public.notification_deliveries set available_at=now() where id=${id}`;
    }
    await processNotification(sql, id, provider);
    expect(send).toHaveBeenCalledTimes(3);
    const messages = send.mock.calls.map(([message]) => message);
    expect(messages[1]).toEqual(messages[0]);
    expect(messages[2]).toEqual(messages[0]);
  });
  it('category opt-out is checked again after enqueue, before provider delivery', async () => {
    const id = await enqueue();
    await sql`insert into public.notification_preferences(organization_id,user_id) values(${organization},${user}) on conflict do nothing`;
    // The enqueue trigger initializes preferences, so update only this fixture's preference row.
    await sql`update public.notification_preferences set categories=jsonb_set(categories,'{welcome}','false') where organization_id=${organization} and user_id=${user}`;
    const send = vi.fn<EmailProvider['send']>(async () => ({
      id: 'unused',
      delivery: 'queued' as const,
    }));
    expect(await processNotification(sql, id, { mode: 'resend', send })).toEqual({
      processed: false,
    });
    expect(send).not.toHaveBeenCalled();
  });
});
