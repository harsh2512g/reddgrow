import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { z } from 'zod';
import { createAIProvider } from '@threadsignal/ai';
import { createRedditProvider } from '@threadsignal/reddit';
import { createCrawlerProvider } from '@threadsignal/crawler';
import { createEmailProvider } from '@threadsignal/email';
import { createBillingProvider } from '@threadsignal/billing';
import { startWorker } from '../../apps/worker/src/runtime';
import { parseWorkerConfig } from '../../apps/worker/src/config';
import { localDatabaseUrl, verifyDocker, supabase } from '../../scripts/service-utils.mjs';
import { parseWorkerStorageKey } from '../../scripts/worker-storage.mjs';
import { localEnvironment } from '../../scripts/isolation.mjs';

describe('local service and worker integration', () => {
  let sql: ReturnType<typeof postgres>;
  let redis: Redis;
  let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
  beforeAll(async () => {
    verifyDocker();
    const databaseUrl = localDatabaseUrl();
    sql = postgres(databaseUrl, { max: 1, connect_timeout: 3 });
    redis = new Redis({
      host: '127.0.0.1',
      port: 56379,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    worker = await startWorker(
      parseWorkerConfig({
        ...localEnvironment(),
        DATABASE_URL: databaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: parseWorkerStorageKey(
          supabase(['status', '--output', 'json']).stdout,
        ),
        LOG_LEVEL: 'silent',
      }),
    );
  });
  afterAll(async () => {
    await worker?.stop();
    redis?.disconnect();
    await sql?.end({ timeout: 3 });
  });
  it('connects to PostgreSQL with pgvector and private storage', async () => {
    expect(await sql`select extname from pg_extension where extname = 'vector'`).toHaveLength(1);
    const buckets = await sql`select public from storage.buckets where id = 'knowledge-private'`;
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.public).toBe(false);
  });
  it('includes Phase 1–8 foundations with private operations and privacy storage', async () => {
    const tables =
      await sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('organizations', 'profiles', 'subscriptions')`;
    expect(tables).toHaveLength(3);
    const opportunityTables =
      await sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('subreddits','reddit_posts','opportunities','drafts')`;
    expect(opportunityTables.map((row) => row.table_name).sort()).toEqual([
      'drafts',
      'opportunities',
      'reddit_posts',
      'subreddits',
    ]);
    expect(
      await sql`select table_name from information_schema.tables where table_schema='public' and table_name in ('extension_sessions','extension_connection_codes')`,
    ).toHaveLength(2);
    expect(
      await sql`select table_name from information_schema.tables where table_schema='public' and table_name in ('tracking_links','tracking_clicks','conversion_events','conversion_api_keys')`,
    ).toHaveLength(4);
    const billingTables =
      await sql`select table_name from information_schema.tables where table_schema='public' and table_name in ('notification_preferences','notification_deliveries','billing_events')`;
    expect(billingTables).toHaveLength(3);
    expect(
      await sql`select table_name from information_schema.tables where table_schema='public' and table_name='privacy_jobs'`,
    ).toHaveLength(1);
    expect(
      await sql`select table_name from information_schema.tables where table_schema='private' and table_name in ('platform_operations_audit','platform_job_retries','privacy_deletion_receipts')`,
    ).toHaveLength(3);
    const exportBuckets =
      await sql`select public,file_size_limit from storage.buckets where id='privacy-exports'`;
    expect(exportBuckets).toMatchObject([{ public: false }]);
    expect(Number(exportBuckets[0]?.file_size_limit)).toBe(67108864);
  });
  it('connects to Redis and processes a real BullMQ heartbeat', async () => {
    expect(await redis.ping()).toBe('PONG');
    await expect
      .poll(async () => (await worker?.readiness())?.status, { timeout: 10_000 })
      .toBe('ready');
    const response = await fetch('http://127.0.0.1:3001/api/health/ready');
    expect(response.status).toBe(200);
  });
  it('runs every provider without external credentials', async () => {
    expect(
      await createAIProvider().generateStructured({
        task: 'health',
        input: 'check',
        schema: z.object({ status: z.literal('ready'), provider: z.literal('mock') }),
      }),
    ).toEqual({ value: { status: 'ready', provider: 'mock' }, provider: 'mock' });
    expect(
      (await createRedditProvider().listPosts({ subreddit: 'SaaS', sort: 'new', limit: 1 })).posts,
    ).toHaveLength(1);
    expect(
      await createCrawlerProvider().fetchPage({
        url: 'https://clarityscale.example/docs',
        approvedDomains: ['clarityscale.example'],
      }),
    ).toBeDefined();
    expect(
      await createEmailProvider('console', { info() {} }).send({
        to: 'fixture@example.com',
        subject: 'fixture',
        text: 'fixture',
        idempotencyKey: 'fixture',
      }),
    ).toBeDefined();
    expect(await createBillingProvider().checkConnection()).toBeDefined();
  });
});
