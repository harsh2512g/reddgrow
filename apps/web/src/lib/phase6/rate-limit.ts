import 'server-only';
import { runtimeRedisOptions } from '../env/runtime';
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
  let connection;
  try {
    connection = runtimeRedisOptions(env);
  } catch {
    throw new AttributionError('UNAVAILABLE', 503);
  }
  const namespace =
    env.THREADSIGNAL_SUPABASE_MODE === 'deployment'
      ? env.THREADSIGNAL_SUPABASE_PROJECT_REF
      : 'local';
  const keys = [`threadsignal:attribution:${namespace}:${operation}:global`],
    limits = [operation === 'redirect' ? 1200 : 600, 60000];
  if (scope) {
    keys.push(
      `threadsignal:attribution:${namespace}:${operation}:scope:${createHash('sha256').update(scope.slice(0, 256)).digest('hex')}`,
    );
    limits.push(operation === 'redirect' ? 120 : 60, 60000);
  }
  const redis = new Redis({
    ...connection,
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
