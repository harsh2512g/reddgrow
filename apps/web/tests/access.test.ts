import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), create: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('../src/lib/auth/server', () => ({ createServerSupabase: mocks.create }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

import { getOptionalUser, requireUser } from '../src/lib/auth/require-session';

describe('verified server route access', () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.getUser.mockReset();
    mocks.create.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  });
  it('denies anonymous app access even when the local launcher is active', async () => {
    vi.stubEnv('THREADSIGNAL_LOCAL', '1');
    await expect(requireUser()).rejects.toThrow('redirect:/login?next=%2Fapp');
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });
  it('returns the server-verified identity with the scoped Supabase client', async () => {
    const user = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'fixture@example.com',
      email_confirmed_at: '2026-09-15T00:00:00Z',
    };
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    expect((await requireUser()).user).toBe(user);
  });
  it('keeps public rendering available when local services are absent', async () => {
    mocks.create.mockRejectedValue(new Error('unavailable'));
    expect(await getOptionalUser()).toBeNull();
    await expect(requireUser('//example.com')).rejects.toThrow(
      'redirect:/login?error=service_unavailable&next=%2Fapp',
    );
  });
  it('does not trust a user alongside an authentication error', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: '11111111-1111-4111-8111-111111111111' } },
      error: new Error('revoked'),
    });
    expect(await getOptionalUser()).toBeNull();
  });
});
