// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseServerEnv } from '@threadsignal/config';
vi.mock('server-only', () => ({}));
import {
  deploymentRuntime,
  runtimeDatabaseOptions,
  runtimeRedisOptions,
} from '../src/lib/env/runtime';
const ref = 'abcdefghijklmnopqrst';
const fixture = {
  NODE_ENV: 'production',
  THREADSIGNAL_SUPABASE_MODE: 'deployment',
  THREADSIGNAL_DEPLOYMENT_APPROVED: 'true',
  THREADSIGNAL_RUNTIME_ROLE: 'web',
  THREADSIGNAL_SUPABASE_PROJECT_REF: ref,
  NEXT_PUBLIC_APP_URL: 'https://app.threadsignal.dev',
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'x'.repeat(20)}`,
  DATABASE_URL: `postgresql://threadsignal_runtime_web:${'synthetic'}@db.${ref}.supabase.co:5432/postgres`,
  THREADSIGNAL_DATABASE_CA: '-----BEGIN CERTIFICATE-----\nYXVkaXQ=\n-----END CERTIFICATE-----',
  REDIS_URL: `rediss://default:${'synthetic'}@redis.threadsignal.dev:6380`,
  EXTENSION_ALLOWED_ORIGINS: `chrome-extension://${'a'.repeat(32)}`,
};
beforeEach(() => {
  vi.stubEnv('THREADSIGNAL_LOCAL', undefined);
  vi.stubEnv('THREADSIGNAL_SERVICES_READY', undefined);
});
afterEach(() => vi.unstubAllEnvs());
describe('web runtime boundaries', () => {
  it('uses only a restricted TLS web database and project Redis without local markers', () => {
    const env = parseServerEnv(fixture);
    expect(runtimeDatabaseOptions(env)).toMatchObject({
      username: 'threadsignal_runtime_web',
      ssl: { rejectUnauthorized: true },
    });
    expect(runtimeRedisOptions(env)).toMatchObject({
      host: 'redis.threadsignal.dev',
      tls: { rejectUnauthorized: true },
    });
    expect(deploymentRuntime(env)?.extensionId).toBe('a'.repeat(32));
  });
  it('cannot mix deployed configuration with an isolated local process', () => {
    vi.stubEnv('THREADSIGNAL_LOCAL', '1');
    expect(() => runtimeDatabaseOptions(parseServerEnv(fixture))).toThrow(
      'Invalid approved deployment',
    );
  });
  it('refuses an administrator URL before any connection can be created', () => {
    expect(() =>
      parseServerEnv({
        ...fixture,
        DATABASE_URL: fixture.DATABASE_URL.replace('threadsignal_runtime_web', 'postgres'),
      }),
    ).toThrow();
  });
  it('local services need both ownership markers and exact endpoints', () => {
    const local = parseServerEnv({
      DATABASE_URL: `postgresql://postgres:${'synthetic'}@127.0.0.1:54322/postgres`,
    });
    expect(() => runtimeDatabaseOptions(local)).toThrow();
    vi.stubEnv('THREADSIGNAL_LOCAL', '1');
    vi.stubEnv('THREADSIGNAL_SERVICES_READY', '1');
    expect(runtimeDatabaseOptions(local).ssl).toBe(false);
    expect(runtimeRedisOptions(local).host).toBe('127.0.0.1');
    expect(() =>
      runtimeDatabaseOptions({ ...local, DATABASE_URL: fixture.DATABASE_URL }),
    ).toThrow();
  });
  it('hosted Phase 2 cannot inherit later-phase database access', () => {
    const partial = {
      ...parseServerEnv({}),
      THREADSIGNAL_SUPABASE_MODE: 'personal-development' as const,
    };
    vi.stubEnv('THREADSIGNAL_LOCAL', '1');
    vi.stubEnv('THREADSIGNAL_SERVICES_READY', '1');
    expect(() => runtimeDatabaseOptions(partial)).toThrow();
    expect(() => runtimeRedisOptions(partial)).toThrow();
    expect(runtimeRedisOptions(partial, true).host).toBe('127.0.0.1');
  });
  it('deployment extension rejects local or spoofed host/origin/cookies', async () => {
    for (const [key, value] of Object.entries(fixture)) vi.stubEnv(key, value);
    vi.resetModules();
    const policy = await import('../src/lib/phase5/policy');
    const make = (headers: Record<string, string> = {}) =>
      new Request('https://app.threadsignal.dev/api/extension/current', {
        headers: {
          host: 'app.threadsignal.dev',
          origin: fixture.EXTENSION_ALLOWED_ORIGINS,
          'x-threadsignal-extension': 'a'.repeat(32),
          ...headers,
        },
      });
    expect(policy.trustedExtensionRequest(make())).toBe(true);
    for (const headers of [
      { host: '127.0.0.1:3000' },
      { origin: 'https://outside.dev' },
      { cookie: 'session=private' },
    ])
      expect(policy.trustedExtensionRequest(make(headers))).toBe(false);
    expect(policy.extensionCors(make()).get('Access-Control-Allow-Origin')).toBe(
      fixture.EXTENSION_ALLOWED_ORIGINS,
    );
    expect(policy.extensionCors(make()).has('Access-Control-Allow-Credentials')).toBe(false);
  });
});
