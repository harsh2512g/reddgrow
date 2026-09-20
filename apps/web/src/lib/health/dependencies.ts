import 'server-only';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { createServerSupabase } from '../auth/server';
import { verifiedUser } from '../auth/session';
import type { Readiness } from './schema';

type DependencyState = Readiness['checks']['database'];

/** Direct database and Redis connections remain confined to local services. */
function isLoopback(value: string, protocol: 'postgres:' | 'redis:'): boolean {
  try {
    const url = new URL(value);
    const allowedProtocol =
      url.protocol === protocol || (protocol === 'postgres:' && url.protocol === 'postgresql:');
    return allowedProtocol && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function checkDatabase(url: string | undefined): Promise<DependencyState> {
  if (!url) return 'unconfigured';
  if (!isLoopback(url, 'postgres:')) return 'unavailable';
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 3,
    idle_timeout: 1,
    onnotice: () => undefined,
  });
  try {
    await sql`select 1`;
    return 'ready';
  } catch {
    return 'unavailable';
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function checkPersonalDevelopmentDatabase(): Promise<DependencyState> {
  try {
    // The shared client validates the selected personal project before any request.
    // Only the current user's verified session may access the protected schema.
    const supabase = await createServerSupabase();
    const identity = await supabase.auth.getUser();
    if (isAuthSessionMissingError(identity.error)) return 'unconfigured';
    if (identity.error) return 'unavailable';
    if (!verifiedUser(identity)) return 'unconfigured';

    // The public key alone cannot inspect this authenticated-only table. A zero-row
    // query proves it is queryable without retrieving plan or customer records.
    const result = await supabase.from('plan_catalog').select('key').limit(0);
    return !result.error && Array.isArray(result.data) && result.data.length === 0
      ? 'ready'
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

async function checkRedis(url: string | undefined): Promise<DependencyState> {
  if (!url) return 'unconfigured';
  if (!isLoopback(url, 'redis:')) return 'unavailable';
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 3_000,
    commandTimeout: 3_000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    return (await redis.ping()) === 'PONG' ? 'ready' : 'unavailable';
  } catch {
    return 'unavailable';
  } finally {
    redis.disconnect();
  }
}

export async function checkDependencies(env: {
  DATABASE_URL?: string | undefined;
  REDIS_URL?: string | undefined;
}): Promise<Readiness['checks']> {
  // Loopback addresses can belong to unrelated services. Only the isolated launcher
  // may enable probes after verifying this project's recorded container ownership.
  if (process.env.THREADSIGNAL_SERVICES_READY !== '1') {
    return { database: 'unconfigured', redis: 'unconfigured' };
  }
  const [database, redis] = await Promise.all([
    process.env.THREADSIGNAL_SUPABASE_MODE === 'personal-development'
      ? checkPersonalDevelopmentDatabase()
      : checkDatabase(env.DATABASE_URL),
    checkRedis(env.REDIS_URL),
  ]);
  return { database, redis };
}
