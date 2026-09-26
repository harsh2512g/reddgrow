import { describe, expect, it } from 'vitest';
import { parseDeploymentRuntime, parseServerEnv } from '../src/index.js';
const ref = 'abcdefghijklmnopqrst';
const password = ['synthetic', 'credential'].join('-');
export const deploymentFixture = {
  NODE_ENV: 'production',
  THREADSIGNAL_SUPABASE_MODE: 'deployment',
  THREADSIGNAL_DEPLOYMENT_APPROVED: 'true',
  THREADSIGNAL_RUNTIME_ROLE: 'web',
  THREADSIGNAL_SUPABASE_PROJECT_REF: ref,
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'x'.repeat(20)}`,
  NEXT_PUBLIC_APP_URL: 'https://app.threadsignal.dev',
  DATABASE_URL: `postgresql://threadsignal_runtime_web:${password}@db.${ref}.supabase.co:5432/postgres?sslmode=require`,
  THREADSIGNAL_DATABASE_CA: '-----BEGIN CERTIFICATE-----\nYXVkaXQ=\n-----END CERTIFICATE-----',
  REDIS_URL: `rediss://default:${password}@redis.threadsignal.dev:6380`,
  EXTENSION_ALLOWED_ORIGINS: `chrome-extension://${'a'.repeat(32)}`,
};
describe('explicit deployment runtime', () => {
  it('uses certificate-verified database and Redis with a restricted role and namespace', () => {
    const result = parseDeploymentRuntime(deploymentFixture, 'web');
    expect(result.database).toMatchObject({
      username: 'threadsignal_runtime_web',
      ssl: { rejectUnauthorized: true, servername: `db.${ref}.supabase.co` },
    });
    expect(result.redis).toMatchObject({
      tls: { rejectUnauthorized: true, servername: 'redis.threadsignal.dev' },
    });
    expect(result.queuePrefix).toBe(`threadsignal-deployment-${ref}`);
    expect(result.storageKey).toBeUndefined();
    expect(parseServerEnv(deploymentFixture).AI_PROVIDER).toBe('mock');
  });
  it('pins the restricted session-pooler username to the selected project', () => {
    const result = parseDeploymentRuntime(
      {
        ...deploymentFixture,
        DATABASE_URL: `postgresql://threadsignal_runtime_web.${ref}:${password}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`,
      },
      'web',
    );
    expect(result.database.username).toBe(`threadsignal_runtime_web.${ref}`);
  });
  it('keeps the Storage key worker-only', () => {
    const worker = {
      ...deploymentFixture,
      THREADSIGNAL_RUNTIME_ROLE: 'worker',
      DATABASE_URL: deploymentFixture.DATABASE_URL.replace('runtime_web', 'runtime_worker'),
      SUPABASE_SECRET_KEY: ['sb', 'secret', 'synthetic'.repeat(3)].join('_'),
    };
    expect(parseDeploymentRuntime(worker, 'worker').storageKey).toBe(worker.SUPABASE_SECRET_KEY);
    expect(() => parseDeploymentRuntime(worker, 'web')).toThrow('Invalid approved deployment');
    expect(() =>
      parseDeploymentRuntime(
        { ...deploymentFixture, SUPABASE_SECRET_KEY: worker.SUPABASE_SECRET_KEY },
        'web',
      ),
    ).toThrow();
  });
  it.each([
    { THREADSIGNAL_DEPLOYMENT_APPROVED: 'false' },
    { THREADSIGNAL_LOCAL: '1' },
    { NODE_ENV: 'development' },
    { THREADSIGNAL_RUNTIME_ROLE: undefined },
    { THREADSIGNAL_SUPABASE_MODE: 'personal-development' },
    { THREADSIGNAL_DATABASE_CA: '' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' },
    { NEXT_PUBLIC_APP_URL: 'http://app.threadsignal.dev' },
    { NEXT_PUBLIC_APP_URL: 'https://127.0.0.1' },
    { NEXT_PUBLIC_APP_URL: 'https://app.threadsignal.dev/path' },
    { NEXT_PUBLIC_APP_URL: 'https://user:secret@app.threadsignal.dev' },
    { DATABASE_URL: deploymentFixture.DATABASE_URL.replace('runtime_web', 'worker') },
    {
      DATABASE_URL: deploymentFixture.DATABASE_URL.replace('threadsignal_runtime_web', 'postgres'),
    },
    { DATABASE_URL: deploymentFixture.DATABASE_URL.replace(':5432', ':6543') },
    { DATABASE_URL: `${deploymentFixture.DATABASE_URL}&options=-c%20role%3Dpostgres` },
    { DATABASE_URL: deploymentFixture.DATABASE_URL.replace('require', 'disable') },
    { REDIS_URL: 'redis://localhost:56379' },
    { REDIS_URL: 'rediss://default:fake@127.0.0.1' },
    { REDIS_URL: 'rediss://redis.threadsignal.dev' },
    { REDIS_URL: `${deploymentFixture.REDIS_URL}/1` },
    { REDIS_URL: `${deploymentFixture.REDIS_URL}?tls.rejectUnauthorized=false` },
    { EXTENSION_ALLOWED_ORIGINS: '*' },
    { EXTENSION_ALLOWED_ORIGINS: undefined },
  ])('rejects unsafe or mixed configuration without retaining values %#', (overrides) => {
    expect(() => parseDeploymentRuntime({ ...deploymentFixture, ...overrides }, 'web')).toThrow(
      'Invalid approved deployment runtime configuration.',
    );
  });
  it('cannot activate deployment through the ordinary local schema', () => {
    expect(() => parseServerEnv({ THREADSIGNAL_DEPLOYMENT_APPROVED: 'true' })).toThrow();
    expect(() => parseServerEnv({ ...deploymentFixture, AI_PROVIDER: 'openai' })).toThrow(
      'AI_EMBEDDING_MODEL',
    );
  });
});
