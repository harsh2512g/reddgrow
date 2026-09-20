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
vi.mock('../src/lib/phase4/api', () => ({ DraftError: class extends Error {} }));
vi.mock('../src/lib/knowledge/http', () => ({ KnowledgeError: class extends Error {} }));
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

import { enforceExtensionRateLimit } from '../src/lib/phase5/rate-limit';
import { AUTH_RATE_LIMIT_SCRIPT } from '../src/lib/auth/rate-limit';

const token = `tse_${'a'.repeat(43)}`;
const local = { REDIS_URL: 'redis://127.0.0.1:56379', THREADSIGNAL_SUPABASE_MODE: 'local' };
function request(path = 'current', authorization: string | null = `Bearer ${token}`) {
  return new Request(`http://127.0.0.1:3000/api/extension/${path}`, {
    headers: {
      ...(authorization ? { authorization } : {}),
      'x-forwarded-for': '198.51.100.42',
      'x-real-ip': '198.51.100.43',
    },
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.stubEnv('THREADSIGNAL_LOCAL', '1');
  vi.stubEnv('THREADSIGNAL_SERVICES_READY', '1');
  mocks.env.mockReturnValue(local);
  mocks.connect.mockResolvedValue(undefined);
  mocks.evaluate.mockResolvedValue([1, 0]);
});
afterEach(() => vi.unstubAllEnvs());

describe('extension request throttling', () => {
  it('atomically applies endpoint/global/token windows using only a SHA-256 token digest', async () => {
    await enforceExtensionRateLimit(request());
    expect(mocks.evaluate).toHaveBeenCalledExactlyOnceWith(
      AUTH_RATE_LIMIT_SCRIPT,
      3,
      'threadsignal:extension:local:endpoint:current',
      'threadsignal:extension:local:token-operations:global',
      `threadsignal:extension:local:token:${createHash('sha256').update(token).digest('hex')}`,
      300,
      60_000,
      600,
      60_000,
      120,
      60_000,
    );
    const calls = JSON.stringify(mocks.evaluate.mock.calls);
    expect(calls).not.toContain(token);
    expect(calls).not.toContain('198.51.100');
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it('bounds exchange attempts before looking at the one-time code or request body', async () => {
    const req = new Request('http://127.0.0.1:3000/api/extension/exchange', {
      method: 'POST',
      body: 'malformed private body',
    });
    await enforceExtensionRateLimit(req);
    expect(req.bodyUsed).toBe(false);
    expect(mocks.evaluate).toHaveBeenCalledExactlyOnceWith(
      AUTH_RATE_LIMIT_SCRIPT,
      2,
      'threadsignal:extension:local:endpoint:exchange',
      'threadsignal:extension:local:exchange:global',
      300,
      60_000,
      30,
      60_000,
    );
  });

  it('puts invalid and absent credentials through the limiter without unbounded input keys', async () => {
    await enforceExtensionRateLimit(request('current', null));
    await enforceExtensionRateLimit(request('current', 'Bearer malformed-secret'));
    expect(mocks.evaluate.mock.calls[0]).toEqual(mocks.evaluate.mock.calls[1]);
    expect(JSON.stringify(mocks.evaluate.mock.calls)).not.toContain('malformed-secret');
  });

  it('shares draft action endpoint limits across IDs and keeps actions distinct', async () => {
    await enforceExtensionRateLimit(request('drafts/one/prepare'));
    await enforceExtensionRateLimit(request('drafts/two/prepare'));
    await enforceExtensionRateLimit(request('drafts/three/inserted'));
    expect(mocks.evaluate.mock.calls[0]?.[2]).toBe(
      'threadsignal:extension:local:endpoint:draft-prepare',
    );
    expect(mocks.evaluate.mock.calls[1]?.[2]).toBe(mocks.evaluate.mock.calls[0]?.[2]);
    expect(mocks.evaluate.mock.calls[2]?.[2]).toBe(
      'threadsignal:extension:local:endpoint:draft-inserted',
    );
  });

  it('rejects the next request once the atomic limiter reports any exhausted bucket', async () => {
    mocks.evaluate.mockResolvedValue([0, 999]);
    await expect(enforceExtensionRateLimit(request())).rejects.toMatchObject({
      code: 'EXTENSION_RATE_LIMIT',
      status: 429,
    });
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it.each([
    ['THREADSIGNAL_LOCAL', '0'],
    ['THREADSIGNAL_SERVICES_READY', '0'],
  ] as const)('refuses an unverified runtime gate %s', async (name, value) => {
    vi.stubEnv(name, value);
    await expect(enforceExtensionRateLimit(request())).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      status: 503,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    'redis://127.0.0.1:6379',
    'redis://localhost:56379',
    'rediss://127.0.0.1:56379',
    'redis://127.0.0.1:56379/1',
    'redis://user:secret@127.0.0.1:56379',
    'redis://127.0.0.1:56379?connectionName=other',
    'redis://127.0.0.1:56379#other',
    'not-a-url',
  ])('rejects a non-owned Redis configuration %s', async (url) => {
    mocks.env.mockReturnValue({ ...local, REDIS_URL: url });
    await expect(enforceExtensionRateLimit(request())).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      status: 503,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses a hosted Supabase mode even with a local Redis URL', async () => {
    mocks.env.mockReturnValue({ ...local, THREADSIGNAL_SUPABASE_MODE: 'personal-development' });
    await expect(enforceExtensionRateLimit(request())).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      status: 503,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(['connect', 'evaluate'] as const)(
    'fails closed if Redis %s fails without exposing errors',
    async (operation) => {
      mocks[operation].mockRejectedValueOnce(new Error('private connection details'));
      await expect(enforceExtensionRateLimit(request())).rejects.toMatchObject({
        code: 'UNAVAILABLE',
        status: 503,
        message: 'UNAVAILABLE',
      });
      expect(mocks.disconnect).toHaveBeenCalledOnce();
    },
  );

  it.each([null, [], [1], ['1', 0], [0, 0], [1, -1], [0, Number.NaN]])(
    'fails closed on an invalid Redis response %j',
    async (result) => {
      mocks.evaluate.mockResolvedValueOnce(result);
      await expect(enforceExtensionRateLimit(request())).rejects.toMatchObject({
        code: 'UNAVAILABLE',
        status: 503,
      });
    },
  );
});
