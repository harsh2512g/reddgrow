import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleSignInDestination } from '../src/lib/auth/google-client';

const origin = 'https://abcdefghijklmnopqrst.supabase.co';
const destination = `${origin}/auth/v1/authorize?provider=google&code_challenge=fixture`;

afterEach(() => vi.unstubAllGlobals());

describe('Google authorization transport', () => {
  it('uses a same-origin JSON POST and validates the returned destination before navigation', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ url: destination }));
    vi.stubGlobal('fetch', request);
    expect(await googleSignInDestination('/app/settings/team', origin)).toBe(destination);
    expect(request).toHaveBeenCalledWith(
      '/api/auth/google',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ next: '/app/settings/team' }),
      }),
    );
  });
  it.each([
    'https://untrusted.example/auth/v1/authorize?provider=google',
    'javascript:alert(1)',
    `${origin}/auth/v1/authorize?provider=github`,
    `${origin}/auth/v1/authorize?provider=google&provider=github`,
    `${origin}/other?provider=google`,
    `${origin}/auth/v1/authorize?provider=google#fragment`,
    'https://user:password@abcdefghijklmnopqrst.supabase.co/auth/v1/authorize?provider=google',
    null,
  ])('refuses an unexpected authorization destination: %s', async (url) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ url })));
    await expect(googleSignInDestination('/app', origin)).rejects.toThrow(
      'temporarily unavailable',
    );
  });
  it('maps throttling without showing raw provider or infrastructure messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(Response.json({ error: 'private fixture detail' }, { status: 429 })),
    );
    await expect(googleSignInDestination('/app', origin)).rejects.toThrow(
      'Too many sign-in attempts.',
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(Response.json({ error: 'private fixture detail' }, { status: 503 })),
    );
    await expect(googleSignInDestination('/app', origin)).rejects.toThrow(
      'Google sign-in is temporarily unavailable.',
    );
  });
});
