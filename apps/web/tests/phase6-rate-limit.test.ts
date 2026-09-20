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

import { enforceAttributionLimit } from '../src/lib/phase6/rate-limit';
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

describe('attribution rate limits', () => {
  it('atomically bounds global and hashed receipt scope without storing tokens', async () => {
    const token = `tsp_${'a'.repeat(43)}`;
    await enforceAttributionLimit('browser', token);
    expect(mocks.evaluate).toHaveBeenCalledExactlyOnceWith(
      AUTH_RATE_LIMIT_SCRIPT,
      2,
      'threadsignal:attribution:local:browser:global',
      `threadsignal:attribution:local:browser:scope:${createHash('sha256').update(token).digest('hex')}`,
      600,
      60000,
      60,
      60000,
    );
    expect(JSON.stringify(mocks.evaluate.mock.calls)).not.toContain(token);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
  it('limits anonymous traffic before parsing an event body', async () => {
    await enforceAttributionLimit('conversion');
    expect(mocks.evaluate).toHaveBeenCalledExactlyOnceWith(
      AUTH_RATE_LIMIT_SCRIPT,
      1,
      'threadsignal:attribution:local:conversion:global',
      600,
      60000,
    );
  });
  it('returns 429 on an exhausted bucket', async () => {
    mocks.evaluate.mockResolvedValue([0, 1000]);
    await expect(enforceAttributionLimit('redirect', 'code')).rejects.toMatchObject({
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
    await expect(enforceAttributionLimit('redirect')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      status: 503,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('refuses a hosted runtime before connecting', async () => {
    mocks.env.mockReturnValue({ ...local, THREADSIGNAL_SUPABASE_MODE: 'personal-development' });
    await expect(enforceAttributionLimit('redirect')).rejects.toMatchObject({ status: 503 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(['connect', 'evaluate'] as const)(
    'fails closed on Redis %s failure without leaking errors',
    async (operation) => {
      mocks[operation].mockRejectedValue(new Error('secret details'));
      await expect(enforceAttributionLimit('browser')).rejects.toMatchObject({
        code: 'UNAVAILABLE',
        message: 'UNAVAILABLE',
        status: 503,
      });
      expect(mocks.disconnect).toHaveBeenCalledOnce();
    },
  );
  it.each([null, [], [1], ['1', 0], [0, 0], [1, -1], [0, NaN]])(
    'fails closed on invalid Redis response %j',
    async (result) => {
      mocks.evaluate.mockResolvedValue(result);
      await expect(enforceAttributionLimit('browser')).rejects.toMatchObject({
        code: 'UNAVAILABLE',
        status: 503,
      });
    },
  );
});
