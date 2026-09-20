import 'server-only';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { getServerEnv } from '../env/server';
import { getAuthConfiguration } from './config';
import { AuthActionError } from './errors';

export const AUTH_RATE_LIMIT_SCRIPT = `
local retry = 0
for index, key in ipairs(KEYS) do
  local count = tonumber(redis.call('GET', key) or '0')
  if count >= tonumber(ARGV[(index - 1) * 2 + 1]) then
    retry = math.max(retry, redis.call('PTTL', key))
  end
end
if retry > 0 then return {0, retry} end
for index, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('PEXPIRE', key, ARGV[(index - 1) * 2 + 2]) end
end
return {1, 0}
`;

/** No IP header is read. Redis sees only a fixed scope and a one-way email digest. */
export async function enforceAuthRateLimit(
  action: 'magic-link' | 'google' | 'callback',
  email?: string,
): Promise<void> {
  getAuthConfiguration();
  const env = getServerEnv();
  const url = new URL(env.REDIS_URL);
  if (process.env.THREADSIGNAL_LOCAL === '1') {
    if (
      url.protocol !== 'redis:' ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '56379' ||
      !['', '/', '/0'].includes(url.pathname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new AuthActionError('AUTH_UNAVAILABLE');
  } else if (url.protocol !== 'rediss:') throw new AuthActionError('AUTH_UNAVAILABLE');
  // Separate hosted sign-ins from the local demo while keeping both on owned local Redis.
  const scope =
    env.THREADSIGNAL_SUPABASE_MODE === 'personal-development'
      ? `threadsignal:auth:personal-development:${env.THREADSIGNAL_SUPABASE_PROJECT_REF}:${action}`
      : `threadsignal:auth:${action}`;
  const keys = [`${scope}:global`];
  const limits = [action === 'callback' ? 120 : 30, 60_000];
  if (email) {
    keys.push(`${scope}:email:${createHash('sha256').update(email).digest('hex')}`);
    limits.push(5, 600_000);
  }
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 2_000,
    commandTimeout: 2_000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    const result = await redis.eval(AUTH_RATE_LIMIT_SCRIPT, keys.length, ...keys, ...limits);
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      typeof result[0] !== 'number' ||
      typeof result[1] !== 'number'
    )
      throw new AuthActionError('AUTH_UNAVAILABLE');
    if (result[0] !== 1)
      throw new AuthActionError('RATE_LIMITED', Math.max(1, Math.ceil(result[1] / 1000)));
  } catch (error) {
    if (error instanceof AuthActionError) throw error;
    throw new AuthActionError('AUTH_UNAVAILABLE');
  } finally {
    redis.disconnect();
  }
}
