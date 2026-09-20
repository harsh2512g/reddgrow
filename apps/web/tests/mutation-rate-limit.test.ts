import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  create: vi.fn(),
  connect: vi.fn(),
  evaluate: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/env/server', () => ({ getServerEnv: mocks.env }));
vi.mock('ioredis', () => ({
  Redis: class {
    constructor(url: string, options: unknown) {
      mocks.create(url, options);
    }
    on() {
      return this;
    }
    connect = mocks.connect;
    eval = mocks.evaluate;
    disconnect = mocks.disconnect;
  },
}));

import { enforceMutationRateLimit } from '../src/lib/mutation-rate-limit';
const organizationId = '11111111-1111-4111-8111-111111111111';
import { AUTH_RATE_LIMIT_SCRIPT } from '../src/lib/auth/rate-limit';
const local = { REDIS_URL: 'redis://127.0.0.1:56379', THREADSIGNAL_SUPABASE_MODE: 'local' };
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.stubEnv('THREADSIGNAL_LOCAL', '1');
  vi.stubEnv('THREADSIGNAL_SERVICES_READY', '1');
  mocks.env.mockReturnValue(local);
  mocks.connect.mockResolvedValue(undefined);
  mocks.evaluate.mockResolvedValue([1, 0]);
});
afterEach(() => vi.unstubAllEnvs());

describe('knowledge/opportunity/draft mutation rate limits', () => {
  it.each(['knowledge', 'opportunities', 'drafts'] as const)(
    'atomically bounds %s writes using only hashed organization scope',
    async (operation) => {
      await enforceMutationRateLimit(operation, organizationId);
      expect(mocks.evaluate).toHaveBeenCalledExactlyOnceWith(
        AUTH_RATE_LIMIT_SCRIPT,
        2,
        `threadsignal:mutations:local:${operation}:global`,
        `threadsignal:mutations:local:${operation}:organization:${createHash('sha256').update(organizationId).digest('hex')}`,
        1200,
        60000,
        120,
        60000,
      );
      expect(JSON.stringify(mocks.evaluate.mock.calls)).not.toContain(organizationId);
      expect(mocks.disconnect).toHaveBeenCalledOnce();
    },
  );
  it('returns 429 on an exhausted bucket', async () => {
    mocks.evaluate.mockResolvedValue([0, 1000]);
    await expect(enforceMutationRateLimit('knowledge', organizationId)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
  it.each([
    'redis://localhost:56379',
    'redis://127.0.0.1:6379',
    'redis://user:secret@127.0.0.1:56379',
    'redis://127.0.0.1:56379/1',
    'redis://127.0.0.1:56379?other',
    'not-a-url',
  ])('refuses an unowned Redis target %s', async (url) => {
    mocks.env.mockReturnValue({ ...local, REDIS_URL: url });
    await expect(enforceMutationRateLimit('knowledge', organizationId)).rejects.toMatchObject({
      code: 'RATE_LIMIT_UNAVAILABLE',
      status: 503,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('refuses unverified services before connecting', async () => {
    vi.stubEnv('THREADSIGNAL_SERVICES_READY', '0');
    await expect(enforceMutationRateLimit('knowledge', organizationId)).rejects.toMatchObject({
      status: 503,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(['connect', 'evaluate'] as const)(
    'fails closed on Redis %s failure without leaking errors',
    async (operation) => {
      mocks[operation].mockRejectedValue(new Error('secret details'));
      await expect(enforceMutationRateLimit('drafts', organizationId)).rejects.toMatchObject({
        code: 'RATE_LIMIT_UNAVAILABLE',
        message: 'RATE_LIMIT_UNAVAILABLE',
        status: 503,
      });
      expect(mocks.disconnect).toHaveBeenCalledOnce();
    },
  );
  it.each([null, [], [1], ['1', 0], [0, 0], [1, -1], [0, NaN]])(
    'fails closed on invalid Redis response %j',
    async (result) => {
      mocks.evaluate.mockResolvedValue(result);
      await expect(enforceMutationRateLimit('drafts', organizationId)).rejects.toMatchObject({
        code: 'RATE_LIMIT_UNAVAILABLE',
        status: 503,
      });
    },
  );
});
