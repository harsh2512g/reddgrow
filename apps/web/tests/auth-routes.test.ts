import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  verify: vi.fn(),
  getUser: vi.fn(),
  rate: vi.fn(),
  google: vi.fn(),
  create: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/auth/config', () => ({
  getAuthConfiguration: () => ({ appUrl: 'http://127.0.0.1:3000' }),
}));
vi.mock('../src/lib/auth/server', () => ({ createServerSupabase: mocks.create }));
vi.mock('../src/lib/auth/rate-limit', () => ({ enforceAuthRateLimit: mocks.rate }));
vi.mock('../src/lib/auth/actions', () => ({ requestGoogleSignIn: mocks.google }));

import { GET as callback } from '../src/app/auth/callback/route';
import { POST as google } from '../src/app/api/auth/google/route';

describe('authentication route boundaries', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
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
  it('accepts the Google native form destination without exposing it to an external call', async () => {
    mocks.google.mockResolvedValue('https://fixture.supabase.example/auth/v1/authorize');
    const request = new Request('http://127.0.0.1:3000/api/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'http://127.0.0.1:3000',
      },
      body: 'next=%2Fapp%2Fsettings%2Fteam',
    });
    const response = await google(request);
    expect(mocks.google).toHaveBeenCalledWith('/app/settings/team', request.headers);
    expect(response.status).toBe(303);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
