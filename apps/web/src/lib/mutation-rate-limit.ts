import 'server-only';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { AUTH_RATE_LIMIT_SCRIPT } from './auth/rate-limit';
import { getServerEnv } from './env/server';
import { KnowledgeError } from './knowledge/http';

/** Additional request budget; PostgreSQL still owns quotas and mutation authorization. */
export async function enforceMutationRateLimit(
  operation: 'knowledge' | 'opportunities' | 'drafts',
  organizationId: string,
): Promise<void> {
  let redis: Redis | undefined;
  try {
    const env = getServerEnv();
    const url = new URL(env.REDIS_URL);
    if (
      process.env.THREADSIGNAL_LOCAL !== '1' ||
      process.env.THREADSIGNAL_SERVICES_READY !== '1' ||
      url.protocol !== 'redis:' ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '56379' ||
      !['', '/', '/0'].includes(url.pathname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new KnowledgeError('RATE_LIMIT_UNAVAILABLE', 503);
    z.enum(['knowledge', 'opportunities', 'drafts']).parse(operation);
    const scope = createHash('sha256').update(z.uuid().parse(organizationId)).digest('hex');
    const prefix = `threadsignal:mutations:${env.THREADSIGNAL_SUPABASE_MODE}:${operation}`;
    redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 1500,
      commandTimeout: 1500,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
    await redis.connect();
    const result: unknown = await redis.eval(
      AUTH_RATE_LIMIT_SCRIPT,
      2,
      `${prefix}:global`,
      `${prefix}:organization:${scope}`,
      1200,
      60000,
      120,
      60000,
    );
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      ![0, 1].includes(result[0]) ||
      !Number.isSafeInteger(result[1]) ||
      result[1] < 0 ||
      (result[0] === 1 && result[1] !== 0) ||
      (result[0] === 0 && result[1] === 0)
    )
      throw new KnowledgeError('RATE_LIMIT_UNAVAILABLE', 503);
    if (result[0] === 0) throw new KnowledgeError('RATE_LIMITED', 429);
  } catch (error) {
    if (error instanceof KnowledgeError) throw error;
    throw new KnowledgeError('RATE_LIMIT_UNAVAILABLE', 503);
  } finally {
    redis?.disconnect();
  }
}
