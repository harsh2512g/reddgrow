import 'server-only';
import { parseDeploymentRuntime, type ServerEnv } from '@threadsignal/config';

/** An explicitly configured deployment never inherits the local launcher permission. */
export function deploymentRuntime(env: ServerEnv) {
  if (env.THREADSIGNAL_SUPABASE_MODE !== 'deployment') return undefined;
  return parseDeploymentRuntime(
    { ...env, THREADSIGNAL_LOCAL: process.env.THREADSIGNAL_LOCAL },
    'web',
  );
}

export function runtimeDatabaseOptions(env: ServerEnv) {
  const deployment = deploymentRuntime(env);
  if (deployment) return deployment.database;
  try {
    const url = new URL(env.DATABASE_URL ?? '');
    if (
      process.env.THREADSIGNAL_LOCAL !== '1' ||
      process.env.THREADSIGNAL_SERVICES_READY !== '1' ||
      env.THREADSIGNAL_SUPABASE_MODE !== 'local' ||
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '54322' ||
      url.pathname !== '/postgres' ||
      url.search ||
      url.hash ||
      !url.username ||
      !url.password
    )
      throw new Error();
    return {
      host: url.hostname,
      port: 54322,
      database: 'postgres',
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      ssl: false as const,
    };
  } catch {
    throw new Error('Database runtime is unavailable.');
  }
}

export function runtimeRedisOptions(env: ServerEnv, allowPersonal = false) {
  const deployment = deploymentRuntime(env);
  if (deployment) return deployment.redis;
  try {
    const url = new URL(env.REDIS_URL);
    if (
      process.env.THREADSIGNAL_LOCAL !== '1' ||
      process.env.THREADSIGNAL_SERVICES_READY !== '1' ||
      (env.THREADSIGNAL_SUPABASE_MODE !== 'local' &&
        !(allowPersonal && env.THREADSIGNAL_SUPABASE_MODE === 'personal-development')) ||
      url.protocol !== 'redis:' ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '56379' ||
      !['', '/', '/0'].includes(url.pathname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    return { host: url.hostname, port: 56379, db: 0 };
  } catch {
    throw new Error('Request protection runtime is unavailable.');
  }
}
