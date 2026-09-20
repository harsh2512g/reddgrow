import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionMissingError } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  createSupabase: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  limit: vi.fn(),
  redisConnect: vi.fn(),
  redisPing: vi.fn(),
  redisDisconnect: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('postgres', () => ({ default: vi.fn() }));
vi.mock('../src/lib/auth/server', () => ({ createServerSupabase: mocks.createSupabase }));
vi.mock('ioredis', () => ({
  Redis: vi.fn(function () {
    return {
      on: vi.fn(),
      connect: mocks.redisConnect,
      ping: mocks.redisPing,
      disconnect: mocks.redisDisconnect,
    };
  }),
}));

import postgres from 'postgres';
import { Redis } from 'ioredis';
import { checkDependencies } from '../src/lib/health/dependencies';

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.mocked(postgres).mockClear();
  vi.mocked(Redis).mockClear();
  vi.stubEnv('THREADSIGNAL_SUPABASE_MODE', undefined);
});

describe('local readiness isolation', () => {
  it.each([undefined, 'true'])(
    'never creates clients without an explicit ownership marker (%s)',
    async (marker) => {
      vi.stubEnv('THREADSIGNAL_SERVICES_READY', marker);
      const checks = await checkDependencies({
        DATABASE_URL: 'postgresql://127.0.0.1:54322/postgres',
        REDIS_URL: 'redis://127.0.0.1:56379',
      });
      expect(checks).toEqual({ database: 'unconfigured', redis: 'unconfigured' });
      expect(postgres).not.toHaveBeenCalled();
      expect(Redis).not.toHaveBeenCalled();
    },
  );

  it('never connects to a non-loopback database or Redis endpoint', async () => {
    vi.stubEnv('THREADSIGNAL_SERVICES_READY', '1');
    const checks = await checkDependencies({
      DATABASE_URL: 'postgresql://database.example.invalid/postgres',
      REDIS_URL: 'redis://queue.example.invalid:6379',
    });
    expect(checks).toEqual({ database: 'unavailable', redis: 'unavailable' });
    expect(postgres).not.toHaveBeenCalled();
    expect(Redis).not.toHaveBeenCalled();
  });

  it('does not claim readiness when dependencies are not configured', async () => {
    vi.stubEnv('THREADSIGNAL_SERVICES_READY', '1');
    expect(await checkDependencies({})).toEqual({
      database: 'unconfigured',
      redis: 'unconfigured',
    });
    expect(postgres).not.toHaveBeenCalled();
    expect(Redis).not.toHaveBeenCalled();
  });

  it('rejects invalid protocols before opening any connection', async () => {
    vi.stubEnv('THREADSIGNAL_SERVICES_READY', '1');
    expect(
      await checkDependencies({
        DATABASE_URL: 'https://127.0.0.1:54322',
        REDIS_URL: 'http://127.0.0.1:56379',
      }),
    ).toEqual({ database: 'unavailable', redis: 'unavailable' });
    expect(postgres).not.toHaveBeenCalled();
    expect(Redis).not.toHaveBeenCalled();
  });
});

describe('personal development readiness', () => {
  beforeEach(() => {
    vi.stubEnv('THREADSIGNAL_LOCAL', '1');
    vi.stubEnv('THREADSIGNAL_SERVICES_READY', '1');
    vi.stubEnv('THREADSIGNAL_SUPABASE_MODE', 'personal-development');
    mocks.createSupabase.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
    });
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'fixture@example.test',
          email_confirmed_at: '2026-09-15T00:00:00Z',
        },
      },
      error: null,
    });
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ limit: mocks.limit });
    mocks.limit.mockResolvedValue({ data: [], error: null });
    mocks.redisConnect.mockResolvedValue(undefined);
    mocks.redisPing.mockResolvedValue('PONG');
  });

  it('requires verified local service ownership before either probe', async () => {
    vi.stubEnv('THREADSIGNAL_SERVICES_READY', undefined);
    expect(await checkDependencies({ REDIS_URL: 'redis://127.0.0.1:56379' })).toEqual({
      database: 'unconfigured',
      redis: 'unconfigured',
    });
    expect(mocks.createSupabase).not.toHaveBeenCalled();
    expect(Redis).not.toHaveBeenCalled();
  });

  it('uses the verified user for an empty schema query and keeps Redis local', async () => {
    const checks = await checkDependencies({
      // A leftover local database must never make the selected hosted project ready.
      DATABASE_URL: 'postgresql://127.0.0.1:54322/postgres',
      REDIS_URL: 'redis://127.0.0.1:56379',
    });
    expect(checks).toEqual({ database: 'ready', redis: 'ready' });
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith('plan_catalog');
    expect(mocks.select).toHaveBeenCalledWith('key');
    expect(mocks.limit).toHaveBeenCalledWith(0);
    expect(postgres).not.toHaveBeenCalled();
    expect(Redis).toHaveBeenCalledWith('redis://127.0.0.1:56379', expect.any(Object));
    expect(mocks.redisDisconnect).toHaveBeenCalledOnce();
  });

  it.each([null, new AuthSessionMissingError()])(
    'reports an anonymous schema as unconfigured, never ready (%s)',
    async (error) => {
      mocks.getUser.mockResolvedValue({ data: { user: null }, error });
      expect(await checkDependencies({})).toEqual({
        database: 'unconfigured',
        redis: 'unconfigured',
      });
      expect(mocks.from).not.toHaveBeenCalled();
      expect(postgres).not.toHaveBeenCalled();
    },
  );

  it('does not query schema with an unverified identity', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: '11111111-1111-4111-8111-111111111111' } },
      error: null,
    });
    expect((await checkDependencies({})).database).toBe('unconfigured');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each(['configuration', 'authentication', 'schema'])(
    'contains %s exceptions without exposing provider details',
    async (stage) => {
      const failure = new Error('synthetic-provider-detail');
      if (stage === 'configuration') mocks.createSupabase.mockRejectedValue(failure);
      if (stage === 'authentication') mocks.getUser.mockRejectedValue(failure);
      if (stage === 'schema') mocks.limit.mockRejectedValue(failure);
      expect(await checkDependencies({ REDIS_URL: 'redis://127.0.0.1:56379' })).toEqual({
        database: 'unavailable',
        redis: 'ready',
      });
      if (stage === 'configuration') expect(mocks.getUser).not.toHaveBeenCalled();
    },
  );

  it('does not query after a revoked or rejected authentication token', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'synthetic-provider-detail' },
    });
    expect((await checkDependencies({})).database).toBe('unavailable');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each(['42P01', '42501', 'PGRST205'])(
    'does not report a missing or inaccessible schema as ready (%s)',
    async (code) => {
      mocks.limit.mockResolvedValue({ data: null, error: { code } });
      expect((await checkDependencies({})).database).toBe('unavailable');
    },
  );

  it.each([null, {}, [{ key: 'trial' }]])(
    'rejects unexpected schema probe data (%s)',
    async (data) => {
      mocks.limit.mockResolvedValue({ data, error: null });
      expect((await checkDependencies({})).database).toBe('unavailable');
    },
  );

  it('keeps Redis unavailable if its endpoint is external', async () => {
    expect(await checkDependencies({ REDIS_URL: 'redis://queue.example.invalid:6379' })).toEqual({
      database: 'ready',
      redis: 'unavailable',
    });
    expect(Redis).not.toHaveBeenCalled();
  });

  it('reports a failed local Redis connection separately from hosted schema readiness', async () => {
    mocks.redisConnect.mockRejectedValue(new Error('synthetic-provider-detail'));
    expect(await checkDependencies({ REDIS_URL: 'redis://127.0.0.1:56379' })).toEqual({
      database: 'ready',
      redis: 'unavailable',
    });
    expect(mocks.redisDisconnect).toHaveBeenCalledOnce();
  });
});
