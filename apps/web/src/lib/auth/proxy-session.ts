import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@threadsignal/database';
import { NextResponse, type NextRequest } from 'next/server';
import { getServerEnv } from '../env/server';
import { getAuthConfiguration } from './config';
import { personalDevelopmentAppOrigin } from './config-policy';
import { isSessionCookie, safeNextPath, sessionCookieOptions } from './policy';
import { verifiedUser } from './session';

function fallbackAppOrigin(): string {
  const localOrigin = 'http://127.0.0.1:3000';
  try {
    const env = getServerEnv();
    const url = new URL(env.NEXT_PUBLIC_APP_URL);
    if (process.env.THREADSIGNAL_LOCAL === '1')
      return personalDevelopmentAppOrigin(env) ?? localOrigin;
    if (
      env.NODE_ENV === 'production' &&
      url.protocol === 'https:' &&
      url.pathname === '/' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
      return url.origin;
  } catch {
    // Public redirects remain available when complete provider configuration is unavailable.
  }
  return localOrigin;
}

export async function refreshSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request: { headers: request.headers } });
  const pendingCookies = new Map<string, { value: string; options: CookieOptions }>();
  const pendingHeaders = new Map<string, string>();
  const transferCookies = (target: NextResponse) => {
    for (const [name, { value, options }] of pendingCookies)
      target.cookies.set(name, value, options);
    for (const [name, value] of pendingHeaders) target.headers.set(name, value);
    target.headers.set('Cache-Control', 'private, no-store, max-age=0');
    return target;
  };
  const protectedPath = /^\/(?:app|internal)(?:\/|$)/.test(request.nextUrl.pathname);
  try {
    const config = getAuthConfiguration();
    if (
      config.appUrl === 'http://localhost:3002' &&
      request.headers.get('host') !== 'localhost:3002'
    )
      return transferCookies(new NextResponse('Invalid request host.', { status: 400 }));
    const protectedOptions = sessionCookieOptions(config.production, config.verifiedLocalHttp);
    const supabase = createServerClient<Database>(config.url, config.key, {
      cookieOptions: { name: 'sb-threadsignal-auth-token', ...protectedOptions },
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
        getAll: () => request.cookies.getAll().filter(({ name }) => isSessionCookie(name)),
        setAll(values, headers) {
          for (const { name, value, options } of values) {
            request.cookies.set(name, value);
            pendingCookies.set(name, { value, options: { ...options, ...protectedOptions } });
          }
          for (const [name, value] of Object.entries(headers)) pendingHeaders.set(name, value);
          response = transferCookies(NextResponse.next({ request: { headers: request.headers } }));
        },
      },
    });
    const user = verifiedUser(await supabase.auth.getUser());
    if (!user && protectedPath) {
      const login = new URL('/login', config.appUrl);
      login.searchParams.set(
        'next',
        safeNextPath(request.nextUrl.pathname + request.nextUrl.search),
      );
      return transferCookies(NextResponse.redirect(login));
    }
  } catch {
    if (protectedPath) {
      // Next's proxy pipeline requires an absolute URL; never derive its origin from Host.
      const login = new URL('/login', fallbackAppOrigin());
      login.searchParams.set('error', 'service_unavailable');
      login.searchParams.set(
        'next',
        safeNextPath(request.nextUrl.pathname + request.nextUrl.search),
      );
      return transferCookies(NextResponse.redirect(login));
    }
  }
  return transferCookies(response);
}
