import 'server-only';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { getServerEnv } from '../env/server';
import { AUTH_RATE_LIMIT_SCRIPT } from '../auth/rate-limit';
import { AttributionError } from './errors';
export async function enforceAttributionLimit(
  operation: 'redirect' | 'browser' | 'conversion' | 'management',
  scope?: string,
) {
  const env = getServerEnv();
  let url: URL;
  try {
    url = new URL(env.REDIS_URL);
  } catch {
    throw new AttributionError('UNAVAILABLE', 503);
  }
  if (
    process.env.THREADSIGNAL_LOCAL !== '1' ||
    process.env.THREADSIGNAL_SERVICES_READY !== '1' ||
    url.protocol !== 'redis:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '56379' ||
    env.THREADSIGNAL_SUPABASE_MODE !== 'local' ||
    !['', '/', '/0'].includes(url.pathname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new AttributionError('UNAVAILABLE', 503);
  const keys = [`threadsignal:attribution:local:${operation}:global`],
    limits = [operation === 'redirect' ? 1200 : 600, 60000];
  if (scope) {
    keys.push(
      `threadsignal:attribution:local:${operation}:scope:${createHash('sha256').update(scope.slice(0, 256)).digest('hex')}`,
    );
    limits.push(operation === 'redirect' ? 120 : 60, 60000);
  }
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1500,
    commandTimeout: 1500,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    const result: unknown = await redis.eval(
      AUTH_RATE_LIMIT_SCRIPT,
      keys.length,
      ...keys,
      ...limits,
    );
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      ![0, 1].includes(result[0]) ||
      !Number.isSafeInteger(result[1]) ||
      result[1] < 0 ||
      (result[0] === 0 && result[1] === 0)
    )
      throw new AttributionError('UNAVAILABLE', 503);
    if (result[0] === 0) throw new AttributionError('RATE_LIMITED', 429);
  } catch (error) {
    if (error instanceof AttributionError) throw error;
    throw new AttributionError('UNAVAILABLE', 503);
  } finally {
    redis.disconnect();
  }
}
