import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  otp: vi.fn(),
  logout: vi.fn(),
  oauth: vi.fn(),
  rate: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/env/server', () => ({
  getServerEnv: () => ({ NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000', GOOGLE_AUTH_ENABLED: true }),
}));
vi.mock('../src/lib/auth/config', () => ({
  getAuthConfiguration: () => ({ appUrl: 'http://127.0.0.1:3000', url: 'http://127.0.0.1:54321' }),
}));
vi.mock('../src/lib/auth/server', () => ({ createServerSupabase: mocks.create }));
vi.mock('../src/lib/auth/rate-limit', () => ({ enforceAuthRateLimit: mocks.rate }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [
      { name: 'sb-threadsignal-auth-token', value: 'synthetic-cookie' },
      {
        name: 'sb-threadsignal-auth-token-flow-fixtureFlow123-code-verifier',
        value: 'synthetic-flow-cookie',
      },
      { name: 'sb-threadsignal-auth-token-flows-code-verifier', value: 'synthetic-flow-index' },
      { name: 'sb-otherproject-auth-token', value: 'unrelated' },
    ],
    delete: mocks.remove,
  }),
}));

import { requestGoogleSignIn, requestMagicLink, signOut } from '../src/lib/auth/actions';

describe('authentication actions', () => {
  const headers = new Headers({ origin: 'http://127.0.0.1:3000' });
  beforeEach(() => {
    vi.stubEnv('THREADSIGNAL_LOCAL', '1');
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.create.mockResolvedValue({
      auth: { signInWithOtp: mocks.otp, signOut: mocks.logout, signInWithOAuth: mocks.oauth },
    });
    mocks.otp.mockResolvedValue({ error: null });
    mocks.logout.mockResolvedValue({ error: null });
  });
  it('sends a normalized email only after origin, schema, and rate checks', async () => {
    const result = await requestMagicLink(
      { email: ' Fixture@Example.com ', next: '//example.com' },
      headers,
    );
    expect(result).toEqual({ ok: true, message: 'Check your email for a sign-in link.' });
    expect(mocks.rate).toHaveBeenCalledWith('magic-link', 'fixture@example.com');
    expect(mocks.create).toHaveBeenCalledWith({ writable: true });
    expect(mocks.otp).toHaveBeenCalledWith({
      email: 'fixture@example.com',
      options: {
        shouldCreateUser: true,
        emailRedirectTo: 'http://127.0.0.1:3000/auth/callback?next=%2Fapp',
      },
    });
  });
  it('rejects an untrusted origin without creating an auth client', async () => {
    await expect(
      requestMagicLink(
        { email: 'fixture@example.com' },
        new Headers({ origin: 'https://example.com' }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ORIGIN' });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
  });
  it('fails closed before delivery when the rate limiter is unavailable', async () => {
    mocks.rate.mockRejectedValue(new Error('limiter unavailable'));
    await expect(requestMagicLink({ email: 'fixture@example.com' }, headers)).rejects.toThrow();
    expect(mocks.otp).not.toHaveBeenCalled();
  });
  it('does not expose a raw authentication-provider message', async () => {
    mocks.otp.mockResolvedValue({ error: { status: 500, message: 'synthetic-sensitive-value' } });
    await expect(requestMagicLink({ email: 'fixture@example.com' }, headers)).rejects.toMatchObject(
      { code: 'AUTH_UNAVAILABLE' },
    );
  });
  it('keeps Google disabled locally even when its external flag is true', async () => {
    await expect(requestGoogleSignIn('/app', headers)).rejects.toMatchObject({
      code: 'AUTH_PROVIDER_UNAVAILABLE',
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.oauth).not.toHaveBeenCalled();
  });
  it('logs out the current auth session and removes only ThreadSignal cookies', async () => {
    await signOut(headers);
    expect(mocks.logout).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.remove.mock.calls.map(([name]) => name)).toEqual([
      'sb-threadsignal-auth-token',
      'sb-threadsignal-auth-token-flow-fixtureFlow123-code-verifier',
      'sb-threadsignal-auth-token-flows-code-verifier',
    ]);
  });
  it('still clears local session cookies if Supabase is unavailable', async () => {
    mocks.create.mockRejectedValue(new Error('offline'));
    await expect(signOut(headers)).rejects.toThrow('offline');
    expect(mocks.remove.mock.calls.map(([name]) => name)).toEqual([
      'sb-threadsignal-auth-token',
      'sb-threadsignal-auth-token-flow-fixtureFlow123-code-verifier',
      'sb-threadsignal-auth-token-flows-code-verifier',
    ]);
  });
});
