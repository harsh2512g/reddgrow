import 'server-only';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { tokenSchema } from '@threadsignal/extension-contracts';
import { AUTH_RATE_LIMIT_SCRIPT } from '../auth/rate-limit';
import { getServerEnv } from '../env/server';
import { ExtensionError } from './errors';

const WINDOW_MS = 60_000;
const PREFIX = 'threadsignal:extension:local';

function endpoint(request: Request): string {
  const path = new URL(request.url).pathname;
  const fixed =
    /^\/api\/extension\/(exchange|current|disconnect|connection-code|sessions|revoke)$/.exec(path);
  if (fixed?.[1]) return fixed[1];
  const draft = /^\/api\/extension\/drafts\/[^/]+(?:\/(prepare|inserted|published))?$/.exec(path);
  if (draft) return draft[1] ? `draft-${draft[1]}` : 'draft-save';
  // A fixed bucket also bounds malformed/unknown requests without user-controlled keys.
  return 'other';
}

/**
 * Runs before parsing credentials/body or reaching PostgreSQL, so failed attempts
 * consume limits too. Keys contain fixed operations and token digests only; no IP
 * headers, connection codes, raw credentials, draft IDs, or request URLs are stored.
 */
export async function enforceExtensionRateLimit(request: Request): Promise<void> {
  let redis: Redis | undefined;
  try {
    if (process.env.THREADSIGNAL_LOCAL !== '1' || process.env.THREADSIGNAL_SERVICES_READY !== '1') {
      throw new ExtensionError('UNAVAILABLE', 503);
    }
    const env = getServerEnv();
    const url = new URL(env.REDIS_URL);
    if (
      env.THREADSIGNAL_SUPABASE_MODE !== 'local' ||
      url.protocol !== 'redis:' ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '56379' ||
      !['', '/', '/0'].includes(url.pathname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new ExtensionError('UNAVAILABLE', 503);

    const operation = endpoint(request);
    const keys = [`${PREFIX}:endpoint:${operation}`];
    const limits = [300, WINDOW_MS];
    if (operation === 'exchange') {
      keys.push(`${PREFIX}:exchange:global`);
      limits.push(30, WINDOW_MS);
    } else {
      keys.push(`${PREFIX}:token-operations:global`);
      limits.push(600, WINDOW_MS);
      const authorization = request.headers.get('authorization') ?? '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      const valid = tokenSchema.safeParse(token);
      // All absent/malformed credentials share a bounded bucket. Valid-shape but
      // nonexistent tokens still consume the global and per-token limits.
      const digest = createHash('sha256')
        .update(valid.success ? valid.data : 'invalid-token')
        .digest('hex');
      keys.push(`${PREFIX}:token:${digest}`);
      limits.push(120, WINDOW_MS);
    }
    redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
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
      typeof result[1] !== 'number' ||
      !Number.isFinite(result[1]) ||
      (result[0] === 1 && result[1] !== 0) ||
      (result[0] === 0 && result[1] <= 0)
    )
      throw new ExtensionError('UNAVAILABLE', 503);
    if (result[0] === 0) throw new ExtensionError('EXTENSION_RATE_LIMIT', 429);
  } catch (error) {
    if (error instanceof ExtensionError) throw error;
    throw new ExtensionError('UNAVAILABLE', 503);
  } finally {
    redis?.disconnect();
  }
}
