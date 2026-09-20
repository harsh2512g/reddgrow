import { beforeEach, describe, expect, it, vi } from 'vitest';

type ClientOptions = {
  cookieOptions: { httpOnly: boolean; secure: boolean; sameSite: string };
  global: { fetch: typeof fetch };
  cookies: { getAll(): { name: string; value: string }[] };
};
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  headers: vi.fn(),
  cookies: vi.fn(),
  create: vi.fn<(url: string, key: string, options: ClientOptions) => object>(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/auth/config', () => ({ getAuthConfiguration: mocks.config }));
vi.mock('next/headers', () => ({ headers: mocks.headers, cookies: mocks.cookies }));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.create }));

import { createServerSupabase } from '../src/lib/auth/server';

describe('personal Supabase server client boundary', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.config.mockReturnValue({
      url: 'https://abcdefghijklmnopqrst.supabase.co',
      key: 'sb_publishable_' + 'synthetic_fixture'.repeat(2),
      appUrl: 'http://localhost:3002',
      production: false,
      verifiedLocalHttp: true,
    });
    mocks.headers.mockResolvedValue(new Headers({ host: 'localhost:3002' }));
    mocks.cookies.mockResolvedValue({
      getAll: () => [
        { name: 'sb-threadsignal-auth-token', value: 'synthetic-session' },
        { name: 'unrelated-cookie', value: 'unrelated' },
      ],
    });
    mocks.create.mockReturnValue({});
  });
  it.each(['127.0.0.1:3002', 'localhost:3000', 'unrelated.example'])(
    'rejects an alternate hostname before reading cookies or constructing the remote client: %s',
    async (host) => {
      mocks.headers.mockResolvedValue(new Headers({ host }));
      await expect(createServerSupabase()).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE' });
      expect(mocks.cookies).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it('uses only protected ThreadSignal cookies and forbids provider redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await createServerSupabase();
    const options = mocks.create.mock.calls[0]?.[2];
    expect(options?.cookieOptions).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    });
    expect(options?.cookies.getAll()).toEqual([
      { name: 'sb-threadsignal-auth-token', value: 'synthetic-session' },
    ]);
    await options?.global.fetch('https://abcdefghijklmnopqrst.supabase.co/auth/v1/user', {
      redirect: 'follow',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://abcdefghijklmnopqrst.supabase.co/auth/v1/user',
      expect.objectContaining({
        redirect: 'error',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
