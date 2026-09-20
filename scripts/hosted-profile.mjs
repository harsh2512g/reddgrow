import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { assertInside, state } from './isolation.mjs';

export const hostedAppOrigin = 'http://localhost:3002';
export const hostedProfilePath = join(state, 'hosted-supabase.json');

const profileSchema = z
  .strictObject({
    purpose: z.literal('personal-development'),
    projectRef: z.string().regex(/^[a-z]{20}$/),
    url: z.string().max(256),
    publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]{20,128}$/),
  })
  .refine((profile) => profile.url === `https://${profile.projectRef}.supabase.co`);

/** Never retain parser errors, which can contain the supplied configuration. */
export function parseHostedProfile(input) {
  const result = profileSchema.safeParse(input);
  if (!result.success)
    throw new Error('Invalid personal Supabase profile; public configuration only.');
  return result.data;
}

export function readHostedProfile() {
  try {
    const file = assertInside(hostedProfilePath);
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > 4096) throw new Error('Invalid profile file.');
    return parseHostedProfile(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    throw new Error('Configure .threadsignal/hosted-supabase.json using docs/hosted-supabase.md.');
  }
}

/** The caller supplies a fresh isolated environment, never the inherited shell environment. */
export function applyHostedProfile(localEnv, profile, servicesReady) {
  const config = parseHostedProfile(profile);
  const env = {
    ...localEnv,
    THREADSIGNAL_LOCAL: '1',
    THREADSIGNAL_SUPABASE_MODE: config.purpose,
    THREADSIGNAL_SUPABASE_PROJECT_REF: config.projectRef,
    THREADSIGNAL_SERVICES_READY: servicesReady ? '1' : '0',
    NEXT_PUBLIC_APP_URL: hostedAppOrigin,
    NEXT_PUBLIC_SUPABASE_URL: config.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
    GOOGLE_AUTH_ENABLED: 'false',
    REDDIT_PROVIDER: 'mock',
    AI_PROVIDER: 'mock',
    EMAIL_PROVIDER: 'console',
    BILLING_PROVIDER: 'mock',
    CRAWLER_PROVIDER: 'fixture',
  };
  // A hosted web process must never silently read from the local database or use admin keys.
  for (const name of [
    'DATABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_ACCESS_TOKEN',
  ])
    delete env[name];
  return env;
}

/** Read-only connectivity checks. Anonymous access cannot verify the authenticated schema. */
export async function checkHostedConnection(input, request = fetch) {
  const profile = parseHostedProfile(input);
  const get = async (path) => {
    try {
      const response = await request(new URL(path, profile.url), {
        method: 'GET',
        headers: { apikey: profile.publishableKey, Accept: 'application/json' },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      // Body content is neither needed nor logged; the status is sufficient for this check.
      await response.body?.cancel();
      return response.status;
    } catch {
      return null;
    }
  };
  const authStatus = await get('/auth/v1/settings');
  const schemaStatus =
    authStatus === 200 ? await get('/rest/v1/plan_catalog?select=key&limit=0') : null;
  return {
    authStatus,
    auth: authStatus === 200 ? 'reachable' : 'unavailable',
    schemaStatus,
    schema: schemaStatus === 404 ? 'missing-or-not-exposed' : 'requires-authenticated-verification',
  };
}
