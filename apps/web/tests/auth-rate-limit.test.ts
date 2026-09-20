import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  config: vi.fn(),
  create: vi.fn(),
  connect: vi.fn(),
  evaluate: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/env/server', () => ({ getServerEnv: mocks.env }));
vi.mock('../src/lib/auth/config', () => ({ getAuthConfiguration: mocks.config }));
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

import { enforceAuthRateLimit } from '../src/lib/auth/rate-limit';

describe('authentication rate limit ownership and project scopes', () => {
  const hosted = {
    REDIS_URL: 'redis://127.0.0.1:56379',
    THREADSIGNAL_SUPABASE_MODE: 'personal-development',
    THREADSIGNAL_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  };
  beforeEach(() => {
    vi.stubEnv('THREADSIGNAL_LOCAL', '1');
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.env.mockReturnValue(hosted);
    mocks.connect.mockResolvedValue(undefined);
    mocks.evaluate.mockResolvedValue([1, 0]);
  });
  it('separates hosted limits from local limits and stores only an email digest', async () => {
    await enforceAuthRateLimit('magic-link', 'fixture@example.test');
    const hostedKeys = mocks.evaluate.mock.calls[0]?.slice(2, 4);
    expect(hostedKeys?.[0]).toBe(
      'threadsignal:auth:personal-development:abcdefghijklmnopqrst:magic-link:global',
    );
    expect(hostedKeys?.[1]).toMatch(/:email:[a-f0-9]{64}$/);
    expect(JSON.stringify(mocks.evaluate.mock.calls)).not.toContain('fixture@example.test');
    mocks.env.mockReturnValue({ REDIS_URL: hosted.REDIS_URL, THREADSIGNAL_SUPABASE_MODE: 'local' });
    await enforceAuthRateLimit('magic-link');
    expect(mocks.evaluate.mock.calls[1]?.[2]).toBe('threadsignal:auth:magic-link:global');
    expect(mocks.disconnect).toHaveBeenCalledTimes(2);
  });
  it('does not open Redis when the selected auth profile or service ownership fails', async () => {
    mocks.config.mockImplementation(() => {
      throw new Error('Unavailable profile');
    });
    await expect(enforceAuthRateLimit('magic-link')).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([
    'redis://127.0.0.1:6379',
    'redis://localhost:56379',
    'rediss://unrelated.example:56379',
    'redis://user:password@127.0.0.1:56379',
  ])('rejects a Redis endpoint outside the dedicated local service: %s', async (url) => {
    mocks.env.mockReturnValue({ ...hosted, REDIS_URL: url });
    await expect(enforceAuthRateLimit('magic-link')).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('honors retry delays and closes the connection on a throttled request', async () => {
    mocks.evaluate.mockResolvedValue([0, 1500]);
    await expect(enforceAuthRateLimit('magic-link')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfter: 2,
    });
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
});
