import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@threadsignal/database';
import { cookies, headers } from 'next/headers';
import { getAuthConfiguration } from './config';
import { AuthActionError } from './errors';
import { isSessionCookie, sessionCookieOptions } from './policy';

/** Cookies are written in handlers/actions; Proxy persists refreshes during page rendering. */
export async function createServerSupabase(
  options: { writable?: boolean } = {},
): Promise<SupabaseClient<Database>> {
  const config = getAuthConfiguration();
  // Cookies have no port boundary. Never forward local-demo cookies from an alternate hostname.
  if (
    config.appUrl === 'http://localhost:3002' &&
    (await headers()).get('host') !== 'localhost:3002'
  )
    throw new AuthActionError('AUTH_UNAVAILABLE');
  const store = await cookies();
  const protectedOptions = sessionCookieOptions(config.production, config.verifiedLocalHttp);
  return createServerClient<Database>(config.url, config.key, {
    cookieOptions: { name: 'sb-threadsignal-auth-token', ...protectedOptions },
    auth: { flowType: 'pkce', autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(5_000),
        }),
    },
    cookies: {
      getAll: () => store.getAll().filter(({ name }) => isSessionCookie(name)),
      setAll(values) {
        const writeCookies = () => {
          for (const { name, value, options } of values)
            store.set(name, value, { ...options, ...protectedOptions });
        };
        if (options.writable) {
          writeCookies();
          return;
        }
        try {
          writeCookies();
        } catch {
          // Server Components cannot mutate cookies. The matching Proxy refreshes them.
        }
      },
    },
  });
}
