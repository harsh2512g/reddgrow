import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  verify: vi.fn(),
  getUser: vi.fn(),
  rate: vi.fn(),
  google: vi.fn(),
  create: vi.fn(),
  config: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/auth/config', () => ({
  getAuthConfiguration: mocks.config,
}));
vi.mock('../src/lib/auth/server', () => ({ createServerSupabase: mocks.create }));
vi.mock('../src/lib/auth/rate-limit', () => ({ enforceAuthRateLimit: mocks.rate }));
vi.mock('../src/lib/auth/actions', () => ({ requestGoogleSignIn: mocks.google }));

import { GET as callback } from '../src/app/auth/callback/route';
import { POST as google } from '../src/app/api/auth/google/route';

describe('authentication route boundaries', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.config.mockReturnValue({ appUrl: 'http://127.0.0.1:3000' });
    mocks.create.mockResolvedValue({
      auth: {
        exchangeCodeForSession: mocks.exchange,
        verifyOtp: mocks.verify,
        getUser: mocks.getUser,
      },
    });
    mocks.exchange.mockResolvedValue({ error: null });
    mocks.verify.mockResolvedValue({ error: null });
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
  });
  it('exchanges the exact PKCE flow and removes private values from the final redirect', async () => {
    const response = await callback(
      new Request(
        'http://127.0.0.1:3000/auth/callback?code=fixture-code&sb_flow_id=fixtureFlow123&next=%2Fapp%2Fsettings%2Fteam',
      ),
    );
    expect(mocks.exchange).toHaveBeenCalledWith('fixture-code', { flowId: 'fixtureFlow123' });
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/app/settings/team');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('rejects duplicate flow selectors before reaching the authentication provider', async () => {
    const response = await callback(
      new Request(
        'http://127.0.0.1:3000/auth/callback?code=fixture-code&sb_flow_id=fixtureFlow123&sb_flow_id=otherFlow123',
      ),
    );
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/login?error=invalid_link');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('verifies supported token-hash links and bounds their redirect', async () => {
    const token = 'a'.repeat(64);
    const response = await callback(
      new Request(
        `http://127.0.0.1:3000/auth/callback?token_hash=${token}&type=invite&next=%2F%2Fexample.test`,
      ),
    );
    expect(mocks.verify).toHaveBeenCalledWith({ token_hash: token, type: 'invite' });
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/app');
  });
  it('never treats successful token exchange alone as verified identity', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'synthetic-provider-detail' },
    });
    const response = await callback(
      new Request('http://127.0.0.1:3000/auth/callback?code=fixture-code'),
    );
    expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/login?error=invalid_link');
  });
  it('returns the Google destination as JSON so CSP does not block a native form redirect', async () => {
    const url = 'https://fixture.supabase.example/auth/v1/authorize?provider=google';
    mocks.google.mockResolvedValue(url);
    const request = new Request('http://127.0.0.1:3000/api/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:3000',
      },
      body: JSON.stringify({ next: '/app/settings/team' }),
    });
    const response = await google(request);
    expect(mocks.google).toHaveBeenCalledWith('/app/settings/team', request.headers);
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toEqual({ url });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('does not send a broken hosted callback to localhost or reflect the request host', async () => {
    mocks.config.mockImplementation(() => {
      throw new Error('Invalid private configuration');
    });
    const response = await callback(
      new Request('https://untrusted.example/auth/callback?code=fixture-code'),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login?error=service_unavailable');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('preserves the HTTPS origin and destination after a verified hosted magic link', async () => {
    mocks.config.mockReturnValue({ appUrl: 'https://threadsignal.example' });
    const response = await callback(
      new Request(
        'https://threadsignal.example/auth/callback?code=fixture-code&next=%2Fapp%2Fsettings%2Fteam',
      ),
    );
    expect(response.headers.get('location')).toBe('https://threadsignal.example/app/settings/team');
    expect(mocks.exchange).toHaveBeenCalledWith('fixture-code', undefined);
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });
});
