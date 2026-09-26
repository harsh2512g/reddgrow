import { describe, expect, it } from 'vitest';
import { parseWorkerConfig } from '../src/config';
import { QUEUE_PREFIX } from '../src/jobs/heartbeat';
import {
  createWorkerAI,
  createWorkerCrawler,
  createWorkerEmail,
  createWorkerReddit,
} from '../src/providers';

const local = {
  DATABASE_URL: 'postgresql://postgres:fixture-password@127.0.0.1:54322/postgres',
};

describe('worker isolation', () => {
  it('accepts project-local services with mock defaults and no real provider secrets', () => {
    const config = parseWorkerConfig(local);
    expect(config.port).toBe(3001);
    expect(config.redis).toEqual({ host: '127.0.0.1', port: 56379, db: 0 });
    expect(config.database.ssl).toBe(false);
    expect(config.queuePrefix).toBe(QUEUE_PREFIX);
  });

  it('requires freshly configured local database connection settings', () => {
    expect(() => parseWorkerConfig({})).toThrow();
  });

  it.each([
    { DATABASE_URL: 'postgresql://postgres:fixture-password@db.example.com:54322/postgres' },
    { DATABASE_URL: 'postgresql://postgres:fixture-password@127.0.0.1:5432/postgres' },
    {
      DATABASE_URL:
        'postgresql://postgres:fixture-password@127.0.0.1:54322/postgres?sslmode=require',
    },
    { REDIS_URL: 'redis://127.0.0.1:6379' },
    { REDIS_URL: 'redis://redis.example.com:56379' },
    { REDIS_URL: 'redis://127.0.0.1:56379/1' },
    { REDIS_URL: 'redis://:fixture-password@127.0.0.1:56379' },
    { AI_PROVIDER: 'openai' },
  ])('rejects nonproject services or nonlocal providers: %j', (override) => {
    expect(() => parseWorkerConfig({ ...local, ...override })).toThrow();
  });
});

const projectRef = 'abcdefghijklmnopqrst';
const databaseUrl = `postgresql://threadsignal_worker.${projectRef}:synthetic-worker-password@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`;
// Only schema shape is exercised here. The launcher validates its downloaded
// public certificate, and the TLS client validates the actual server chain.
const ca = '-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----';
const hosted = {
  THREADSIGNAL_WORKER_MODE: 'personal-development',
  THREADSIGNAL_SUPABASE_MODE: 'personal-development',
  THREADSIGNAL_SUPABASE_PROJECT_REF: projectRef,
  NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
  DATABASE_URL: databaseUrl,
  THREADSIGNAL_DATABASE_CA: ca,
  SUPABASE_SECRET_KEY: `sb_secret_${'synthetic'.repeat(3)}`,
};

describe('explicit personal hosted worker', () => {
  it('uses restricted session credentials, verified TLS and a separate queue namespace', () => {
    const config = parseWorkerConfig(hosted);
    expect(config.port).toBe(3003);
    expect(config.database.username).toBe(`threadsignal_worker.${projectRef}`);
    expect(config.database.ssl).toEqual({
      rejectUnauthorized: true,
      ca,
      servername: 'aws-0-ap-northeast-1.pooler.supabase.com',
    });
    expect(config.redis).toEqual(parseWorkerConfig(local).redis);
    expect(config.queuePrefix).toBe(`threadsignal-hosted-${projectRef}`);
    expect(config.queuePrefix).not.toBe(parseWorkerConfig(local).queuePrefix);
    expect(config.storage.mode).toBe('personal-development');
  });

  it('accepts the restricted direct role and decodes password escapes exactly once', () => {
    const config = parseWorkerConfig({
      ...hosted,
      DATABASE_URL: `postgresql://threadsignal_worker:synthetic%2540%40password@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
    });
    expect(config.database.username).toBe('threadsignal_worker');
    expect(config.database.password).toBe('synthetic%40@password');
    expect(config.database.ssl).toMatchObject({
      rejectUnauthorized: true,
      servername: `db.${projectRef}.supabase.co`,
    });
  });

  it.each([
    { THREADSIGNAL_WORKER_MODE: undefined },
    { THREADSIGNAL_WORKER_MODE: 'hosted' },
    { THREADSIGNAL_SUPABASE_MODE: 'local' },
    { THREADSIGNAL_SUPABASE_PROJECT_REF: 'wrong-project' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://example.com' },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co/` },
    { THREADSIGNAL_DATABASE_CA: undefined },
    { THREADSIGNAL_DATABASE_CA: 'not a certificate' },
    { SUPABASE_SECRET_KEY: undefined },
    { SUPABASE_SECRET_KEY: 'legacy.jwt.key' },
    { SUPABASE_SERVICE_ROLE_KEY: 'legacy.jwt.key' },
    { WORKER_PORT: '3001' },
    { REDIS_URL: 'redis://unrelated.example:56379' },
    { REDIS_URL: 'redis://127.0.0.1:56379/1' },
    { REDDIT_PROVIDER: 'oauth' },
    { AI_PROVIDER: 'openai' },
    { EMAIL_PROVIDER: 'resend' },
    { BILLING_PROVIDER: 'stripe' },
    { CRAWLER_PROVIDER: 'simple' },
    { DATABASE_URL: databaseUrl.replace('threadsignal_worker.', 'postgres.') },
    { DATABASE_URL: databaseUrl.replace(projectRef, 'tsrqponmlkjihgfedcba') },
    { DATABASE_URL: databaseUrl.replace(':5432/', ':6543/') },
    { DATABASE_URL: databaseUrl.replace('pooler.supabase.com', 'pooler.supabase.com.example') },
    { DATABASE_URL: `${databaseUrl}?sslmode=disable` },
    { DATABASE_URL: `${databaseUrl}?sslmode=require&sslmode=verify-full` },
    { DATABASE_URL: `${databaseUrl}?options=unsafe` },
    { DATABASE_URL: `${databaseUrl}#unexpected` },
    { DATABASE_URL: databaseUrl.replace('/postgres', '/another_database') },
  ])('refuses incompatible or privileged configuration (%#)', (override) => {
    expect(() => parseWorkerConfig({ ...hosted, ...override })).toThrow();
  });

  it('does not retain secret-bearing parser exceptions', () => {
    const secret = 'synthetic-value-that-must-not-be-in-errors';
    try {
      parseWorkerConfig({ ...hosted, DATABASE_URL: secret });
      expect.fail('Invalid database URL was accepted');
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(error).not.toHaveProperty('cause');
    }
  });
});

const deployment = {
  NODE_ENV: 'production',
  THREADSIGNAL_WORKER_MODE: 'deployment',
  THREADSIGNAL_SUPABASE_MODE: 'deployment',
  THREADSIGNAL_DEPLOYMENT_APPROVED: 'true',
  THREADSIGNAL_RUNTIME_ROLE: 'worker',
  THREADSIGNAL_SUPABASE_PROJECT_REF: projectRef,
  NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
  NEXT_PUBLIC_APP_URL: 'https://app.threadsignal.example.com',
  DATABASE_URL: `postgresql://threadsignal_runtime_worker:synthetic-password@db.${projectRef}.supabase.co:5432/postgres`,
  THREADSIGNAL_DATABASE_CA: ca,
  SUPABASE_SECRET_KEY: `sb_secret_${'synthetic'.repeat(3)}`,
  REDIS_URL: 'rediss://default:synthetic-password@redis.threadsignal.example.com:6379/0',
};

describe('explicit deployment worker without external connections', () => {
  it('requires distinct deployment role, TLS, managed Redis and explicit provider selection', () => {
    const config = parseWorkerConfig(deployment);
    expect(config).toMatchObject({
      mode: 'deployment',
      appOrigin: deployment.NEXT_PUBLIC_APP_URL,
      providers: {
        ai: { mode: 'mock' },
        reddit: { mode: 'mock' },
        email: { mode: 'console' },
        crawler: 'fixture',
      },
    });
    expect(config.database.username).toBe('threadsignal_runtime_worker');
    expect(config.database.ssl).toMatchObject({
      rejectUnauthorized: true,
      servername: `db.${projectRef}.supabase.co`,
    });
    expect(config.redis).toMatchObject({
      tls: { rejectUnauthorized: true, servername: 'redis.threadsignal.example.com' },
    });
    expect(config.queuePrefix).toBe(`threadsignal-deployment-${projectRef}`);
    expect(createWorkerAI(config).mode).toBe('mock');
    expect(createWorkerReddit(config).mode).toBe('mock');
    expect(createWorkerCrawler(config).mode).toBe('fixture');
    expect(createWorkerEmail(config).mode).toBe('console');
  });
  it('constructs configured real adapters without network requests or ambient credential discovery', () => {
    const config = parseWorkerConfig({
      ...deployment,
      CRAWLER_PROVIDER: 'simple',
      REDDIT_PROVIDER: 'oauth',
      REDDIT_COMMERCIAL_APPROVAL_CONFIRMED: 'true',
      REDDIT_CLIENT_ID: 'synthetic_client',
      REDDIT_CLIENT_SECRET: 'synthetic-client-secret',
      REDDIT_USER_AGENT: 'web:threadsignal:v1.0 (by /u/synthetic_user)',
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'synthetic-ai-value',
      AI_FAST_MODEL: 'configured-fast',
      AI_SMART_MODEL: 'configured-smart',
      AI_EMBEDDING_MODEL: 'configured-embedding',
      AI_MODEL_COSTS_JSON: '{"configured-smart":{"inputPerMillion":2,"outputPerMillion":4}}',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: `re_${'synthetic'.repeat(3)}`,
      EMAIL_FROM: 'notifications@threadsignal.example.com',
    });
    expect(createWorkerAI(config).mode).toBe('openai');
    expect(config.providers?.ai.options?.modelCosts).toEqual({
      'configured-smart': { inputPerMillion: 2, outputPerMillion: 4 },
    });
    expect(createWorkerReddit(config).mode).toBe('oauth');
    expect(createWorkerCrawler(config).mode).toBe('simple');
    expect(createWorkerEmail(config).mode).toBe('resend');
  });
  it.each([
    { THREADSIGNAL_DEPLOYMENT_APPROVED: 'false' },
    { THREADSIGNAL_LOCAL: '1' },
    { THREADSIGNAL_RUNTIME_ROLE: 'web' },
    { NODE_ENV: 'development' },
    { DATABASE_URL: deployment.DATABASE_URL.replace('threadsignal_runtime_worker', 'postgres') },
    { REDIS_URL: 'redis://127.0.0.1:56379' },
    { SUPABASE_SECRET_KEY: undefined },
    { CRAWLER_PROVIDER: 'firecrawl', FIRECRAWL_API_KEY: 'synthetic-unused-value' },
    { AI_PROVIDER: 'openai' },
    { EMAIL_PROVIDER: 'resend' },
    { REDDIT_PROVIDER: 'oauth' },
  ])('rejects incomplete, mixed or privileged deployment configuration (%#)', (override) => {
    expect(() => parseWorkerConfig({ ...deployment, ...override })).toThrow(
      'Invalid approved worker deployment configuration.',
    );
  });
  it('refuses an externally selected provider attached to a local runtime object', () => {
    const config = parseWorkerConfig(local);
    config.providers = {
      crawler: 'simple',
      ai: { mode: 'mock' },
      reddit: { mode: 'mock' },
      email: { mode: 'console' },
    };
    expect(() => createWorkerCrawler(config)).toThrow('approved deployment');
    expect(() => createWorkerAI(config)).toThrow('approved deployment');
  });
});
