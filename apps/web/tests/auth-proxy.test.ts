import type { CookieOptions } from '@supabase/ssr';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type CookieAdapter = {
  global: { fetch: typeof fetch };
  cookies: {
    getAll(): { name: string; value: string }[];
    setAll(
      values: { name: string; value: string; options: CookieOptions }[],
      headers: Record<string, string>,
    ): void;
  };
};
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  config: vi.fn(),
  env: vi.fn(),
  create:
    vi.fn<
      (
        url: string,
        key: string,
        options: CookieAdapter,
      ) => { auth: { getUser: ReturnType<typeof vi.fn> } }
    >(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.create }));
vi.mock('../src/lib/auth/config', () => ({ getAuthConfiguration: mocks.config }));
vi.mock('../src/lib/env/server', () => ({ getServerEnv: mocks.env }));

import { refreshSession } from '../src/lib/auth/proxy-session';

describe('session refresh proxy', () => {
  beforeEach(() => {
    vi.stubEnv('THREADSIGNAL_LOCAL', '1');
    mocks.env.mockReset();
    mocks.env.mockReturnValue({
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
      NODE_ENV: 'production',
    });
    mocks.config.mockReset();
    mocks.getUser.mockReset();
    mocks.create.mockReset();
    mocks.config.mockReturnValue({
      url: 'http://127.0.0.1:54321',
      key: 'synthetic-anon',
      appUrl: 'http://127.0.0.1:3000',
      production: false,
      verifiedLocalHttp: true,
    });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.create.mockImplementation(() => ({ auth: { getUser: mocks.getUser } }));
  });
  it('denies anonymous app access using a fixed origin and internal next destination', async () => {
    const response = await refreshSession(
      new NextRequest('http://127.0.0.1:3000/app/settings/team'),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://127.0.0.1:3000/login?next=%2Fapp%2Fsettings%2Fteam',
    );
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });
  it('requires verified sign-in for internal administration and preserves the destination', async () => {
    const response = await refreshSession(
      new NextRequest('http://127.0.0.1:3000/internal/admin/jobs'),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://127.0.0.1:3000/login?next=%2Finternal%2Fadmin%2Fjobs',
    );
  });
  it('keeps login rendering available without services and fails closed for app paths', async () => {
    mocks.config.mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect((await refreshSession(new NextRequest('http://127.0.0.1:3000/login'))).status).toBe(200);
    const response = await refreshSession(new NextRequest('http://127.0.0.1:3000/app'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://127.0.0.1:3000/login?error=service_unavailable&next=%2Fapp',
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('preserves a protected destination during downtime without reflecting an untrusted host', async () => {
    mocks.config.mockImplementation(() => {
      throw new Error('unavailable');
    });
    const response = await refreshSession(
      new NextRequest('https://untrusted.example/app/settings/team?tab=members'),
    );
    expect(response.headers.get('location')).toBe(
      'http://127.0.0.1:3000/login?error=service_unavailable&next=%2Fapp%2Fsettings%2Fteam%3Ftab%3Dmembers',
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('uses the configured HTTPS app origin during nonlocal auth downtime', async () => {
    vi.stubEnv('THREADSIGNAL_LOCAL', '0');
    mocks.env.mockReturnValue({
      NEXT_PUBLIC_APP_URL: 'https://app.threadsignal.example',
      NODE_ENV: 'production',
    });
    mocks.config.mockImplementation(() => {
      throw new Error('unavailable');
    });
    const response = await refreshSession(new NextRequest('https://untrusted.example/app'));
    expect(response.headers.get('location')).toBe(
      'https://app.threadsignal.example/login?error=service_unavailable&next=%2Fapp',
    );
  });
  it('uses a loopback absolute URL when the environment cannot provide a safe origin', async () => {
    vi.stubEnv('THREADSIGNAL_LOCAL', '0');
    mocks.config.mockImplementation(() => {
      throw new Error('unavailable');
    });
    for (const appUrl of [
      'invalid',
      'https://user:password@example.test',
      'https://example.test/path',
      'http://example.test',
    ]) {
      mocks.env.mockReturnValue({ NEXT_PUBLIC_APP_URL: appUrl, NODE_ENV: 'production' });
      const response = await refreshSession(new NextRequest('https://untrusted.example/app'));
      expect(response.headers.get('location')).toBe(
        'http://127.0.0.1:3000/login?error=service_unavailable&next=%2Fapp',
      );
    }
    mocks.env.mockImplementation(() => {
      throw new Error('invalid environment');
    });
    const response = await refreshSession(new NextRequest('https://untrusted.example/app'));
    expect(response.headers.get('location')).toBe(
      'http://127.0.0.1:3000/login?error=service_unavailable&next=%2Fapp',
    );
  });
  it('retains the personal development origin during downtime without trusting the request host', async () => {
    const env = {
      NEXT_PUBLIC_APP_URL: 'http://localhost:3002',
      NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'synthetic_fixture'.repeat(2),
      THREADSIGNAL_SUPABASE_MODE: 'personal-development',
      THREADSIGNAL_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
      NODE_ENV: 'development',
    };
    mocks.env.mockReturnValue(env);
    mocks.config.mockImplementation(() => {
      throw new Error('unavailable');
    });
    let response = await refreshSession(
      new NextRequest('https://untrusted.example/app/settings/team'),
    );
    expect(response.headers.get('location')).toBe(
      'http://localhost:3002/login?error=service_unavailable&next=%2Fapp%2Fsettings%2Fteam',
    );
    mocks.env.mockReturnValue({
      ...env,
      THREADSIGNAL_SUPABASE_PROJECT_REF: 'differentprojecthere',
    });
    response = await refreshSession(new NextRequest('https://untrusted.example/app'));
    expect(response.headers.get('location')).toBe(
      'http://127.0.0.1:3000/login?error=service_unavailable&next=%2Fapp',
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects redirects while fetching auth data so credentials cannot follow another origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await refreshSession(new NextRequest('http://127.0.0.1:3000/login'));
    const adapter = mocks.create.mock.calls[0]?.[2];
    expect(adapter).toBeDefined();
    await adapter?.global.fetch('https://abcdefghijklmnopqrst.supabase.co/auth/v1/user', {
      redirect: 'follow',
      cache: 'force-cache',
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
  it('never forwards local-demo cookies when hosted mode is opened through an alternate hostname', async () => {
    mocks.config.mockReturnValue({
      url: 'https://abcdefghijklmnopqrst.supabase.co',
      key: 'sb_publishable_' + 'synthetic_fixture'.repeat(2),
      appUrl: 'http://localhost:3002',
      production: false,
      verifiedLocalHttp: true,
    });
    const response = await refreshSession(
      new NextRequest('http://127.0.0.1:3002/app', {
        headers: {
          host: '127.0.0.1:3002',
          cookie: 'sb-threadsignal-auth-token=synthetic-local-session',
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it('refreshes request and response cookies with protected flags and no-store headers', async () => {
    mocks.getUser.mockImplementation(async () => {
      const options = mocks.create.mock.calls[0]?.[2];
      options?.cookies.setAll(
        [
          {
            name: 'sb-threadsignal-auth-token',
            value: 'synthetic-refreshed-session',
            options: { httpOnly: false, sameSite: 'none' },
          },
        ],
        { 'Cache-Control': 'private, no-store', Expires: '0' },
      );
      return {
        data: {
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'fixture@example.com',
            email_confirmed_at: '2026-09-15T00:00:00Z',
          },
        },
        error: null,
      };
    });
    const request = new NextRequest('http://127.0.0.1:3000/app', {
      headers: {
        cookie: 'sb-threadsignal-auth-token=old-synthetic; sb-otherproject-auth-token=unrelated',
      },
    });
    const response = await refreshSession(request);
    expect(response.status).toBe(200);
    expect(request.cookies.get('sb-threadsignal-auth-token')?.value).toBe(
      'synthetic-refreshed-session',
    );
    expect(response.cookies.get('sb-threadsignal-auth-token')?.httpOnly).toBe(true);
    expect(response.cookies.get('sb-threadsignal-auth-token')?.sameSite).toBe('lax');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('expires')).toBe('0');
    expect(mocks.create.mock.calls[0]?.[2].cookies.getAll().map((cookie) => cookie.name)).toEqual([
      'sb-threadsignal-auth-token',
    ]);
  });
});
