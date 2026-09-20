import { parseClientEnv, type ServerEnv } from '@threadsignal/config';
import { AuthActionError } from './errors';

type AuthEnvironment = Pick<
  ServerEnv,
  | 'NEXT_PUBLIC_SUPABASE_URL'
  | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'
  | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
  | 'NEXT_PUBLIC_APP_URL'
  | 'NODE_ENV'
> &
  Partial<Pick<ServerEnv, 'THREADSIGNAL_SUPABASE_MODE' | 'THREADSIGNAL_SUPABASE_PROJECT_REF'>>;

function authEndpoints(env: AuthEnvironment) {
  const validated = parseClientEnv(env);
  if (!validated.NEXT_PUBLIC_SUPABASE_URL) throw new AuthActionError('AUTH_UNAVAILABLE');
  const url = new URL(validated.NEXT_PUBLIC_SUPABASE_URL);
  const appUrl = new URL(validated.NEXT_PUBLIC_APP_URL);
  for (const endpoint of [url, appUrl]) {
    if (
      endpoint.pathname !== '/' ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.username ||
      endpoint.password
    )
      throw new AuthActionError('AUTH_UNAVAILABLE');
  }
  return { ...validated, url, appUrl };
}

function assertPersonalDevelopment(
  env: AuthEnvironment,
  endpoints: ReturnType<typeof authEndpoints>,
) {
  if (
    env.THREADSIGNAL_SUPABASE_MODE !== 'personal-development' ||
    !/^[a-z]{20}$/.test(env.THREADSIGNAL_SUPABASE_PROJECT_REF ?? '') ||
    endpoints.url.origin !== `https://${env.THREADSIGNAL_SUPABASE_PROJECT_REF}.supabase.co` ||
    endpoints.appUrl.origin !== 'http://localhost:3002' ||
    !endpoints.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    endpoints.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !['development', 'production'].includes(env.NODE_ENV)
  )
    throw new AuthActionError('AUTH_UNAVAILABLE');
}

/** A safe fallback origin does not imply that services are ready or perform a network request. */
export function personalDevelopmentAppOrigin(env: AuthEnvironment): string | undefined {
  try {
    const endpoints = authEndpoints(env);
    assertPersonalDevelopment(env, endpoints);
    return endpoints.appUrl.origin;
  } catch {
    return undefined;
  }
}

/** Hosted development requires its dedicated profile; ordinary local mode stays local. */
export function parseAuthConfiguration(
  env: AuthEnvironment,
  boundary: { local: boolean; servicesReady: boolean },
) {
  try {
    const endpoints = authEndpoints(env);
    const { url, appUrl } = endpoints;
    const key =
      endpoints.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? endpoints.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!key) throw new AuthActionError('AUTH_UNAVAILABLE');
    if (env.THREADSIGNAL_SUPABASE_MODE === 'personal-development') {
      if (!boundary.local || !boundary.servicesReady) throw new AuthActionError('AUTH_UNAVAILABLE');
      assertPersonalDevelopment(env, endpoints);
    } else if (boundary.local) {
      if (
        !boundary.servicesReady ||
        url.origin !== 'http://127.0.0.1:54321' ||
        appUrl.origin !== 'http://127.0.0.1:3000'
      )
        throw new AuthActionError('AUTH_UNAVAILABLE');
    } else if (
      url.protocol !== 'https:' ||
      appUrl.protocol !== 'https:' ||
      env.NODE_ENV !== 'production'
    ) {
      throw new AuthActionError('AUTH_UNAVAILABLE');
    }
    return {
      url: url.origin,
      key,
      appUrl: appUrl.origin,
      production: env.NODE_ENV === 'production',
      verifiedLocalHttp: boundary.local && boundary.servicesReady,
    };
  } catch {
    throw new AuthActionError('AUTH_UNAVAILABLE');
  }
}
