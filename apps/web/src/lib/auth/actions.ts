import 'server-only';
import { cookies } from 'next/headers';
import { getServerEnv } from '../env/server';
import { createServerSupabase } from './server';
import { getAuthConfiguration } from './config';
import { AuthActionError } from './errors';
import { enforceAuthRateLimit } from './rate-limit';
import { hasTrustedOrigin, isSessionCookie, magicLinkInputSchema, safeNextPath } from './policy';

export const MAGIC_LINK_MESSAGE = 'Check your email for a sign-in link.';

export function assertAuthOrigin(headers: Pick<Headers, 'get'>): void {
  if (!hasTrustedOrigin(headers, getServerEnv().NEXT_PUBLIC_APP_URL))
    throw new AuthActionError('INVALID_ORIGIN');
}

export async function requestMagicLink(
  input: unknown,
  headers: Pick<Headers, 'get'>,
): Promise<{ ok: true; message: string }> {
  assertAuthOrigin(headers);
  const request = magicLinkInputSchema.safeParse(input);
  if (!request.success) throw new AuthActionError('INVALID_INPUT');
  const config = getAuthConfiguration();
  await enforceAuthRateLimit('magic-link', request.data.email);
  const supabase = await createServerSupabase({ writable: true });
  const callback = new URL('/auth/callback', config.appUrl);
  callback.searchParams.set('next', safeNextPath(request.data.next));
  const { error } = await supabase.auth.signInWithOtp({
    email: request.data.email,
    options: { shouldCreateUser: true, emailRedirectTo: callback.toString() },
  });
  if (error) {
    if (error.status === 429) throw new AuthActionError('RATE_LIMITED', 60);
    throw new AuthActionError('AUTH_UNAVAILABLE');
  }
  return { ok: true, message: MAGIC_LINK_MESSAGE };
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  for (const { name } of store.getAll()) if (isSessionCookie(name)) store.delete(name);
}

export async function signOut(headers: Pick<Headers, 'get'>): Promise<void> {
  assertAuthOrigin(headers);
  try {
    const supabase = await createServerSupabase({ writable: true });
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw new AuthActionError('AUTH_UNAVAILABLE');
  } finally {
    await clearSessionCookies();
  }
}

/** Google is deliberately disabled in this isolated environment, even if a flag is supplied. */
export async function requestGoogleSignIn(
  next: unknown,
  headers: Pick<Headers, 'get'>,
): Promise<string> {
  assertAuthOrigin(headers);
  const env = getServerEnv();
  if (process.env.THREADSIGNAL_LOCAL === '1' || !env.GOOGLE_AUTH_ENABLED)
    throw new AuthActionError('AUTH_PROVIDER_UNAVAILABLE');
  const config = getAuthConfiguration();
  await enforceAuthRateLimit('google');
  const callback = new URL('/auth/callback', config.appUrl);
  callback.searchParams.set('next', safeNextPath(next));
  const supabase = await createServerSupabase({ writable: true });
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: callback.toString(), skipBrowserRedirect: true },
  });
  if (error || !data.url) throw new AuthActionError('AUTH_UNAVAILABLE');
  const target = new URL(data.url);
  if (target.origin !== config.url || target.pathname !== '/auth/v1/authorize')
    throw new AuthActionError('AUTH_UNAVAILABLE');
  return data.url;
}
