import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.literal('production'),
  THREADSIGNAL_SUPABASE_MODE: z.literal('deployment'),
  THREADSIGNAL_DEPLOYMENT_APPROVED: z.union([z.literal(true), z.literal('true')]),
  THREADSIGNAL_LOCAL: z.undefined().optional(),
  THREADSIGNAL_RUNTIME_ROLE: z.enum(['web', 'worker']),
  THREADSIGNAL_SUPABASE_PROJECT_REF: z.string().regex(/^[a-z]{20}$/),
  NEXT_PUBLIC_SUPABASE_URL: z.string(),
  NEXT_PUBLIC_APP_URL: z.string(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .regex(/^sb_publishable_[A-Za-z0-9_-]{16,200}$/)
    .optional(),
  DATABASE_URL: z.string().max(4096),
  THREADSIGNAL_DATABASE_CA: z
    .string()
    .max(10000)
    .regex(
      /^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----\s*$/,
    ),
  REDIS_URL: z.string().max(4096),
  EXTENSION_ALLOWED_ORIGINS: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.undefined().optional(),
});

function publicHostname(host: string) {
  return (
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host) &&
    !/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/i.test(host)
  );
}

/** Pure validation only. No credentials are discovered, files read, or connections opened. */
export function parseDeploymentRuntime(input: Record<string, unknown>, role: 'web' | 'worker') {
  try {
    const env = schema.parse(input);
    if (env.THREADSIGNAL_RUNTIME_ROLE !== role) throw new Error();
    const projectRef = env.THREADSIGNAL_SUPABASE_PROJECT_REF;
    if (env.NEXT_PUBLIC_SUPABASE_URL !== `https://${projectRef}.supabase.co`) throw new Error();
    const app = new URL(env.NEXT_PUBLIC_APP_URL);
    if (
      app.protocol !== 'https:' ||
      !publicHostname(app.hostname) ||
      app.port ||
      app.username ||
      app.password ||
      app.pathname !== '/' ||
      app.search ||
      app.hash
    )
      throw new Error();
    const db = new URL(env.DATABASE_URL);
    const direct = db.hostname === `db.${projectRef}.supabase.co`;
    const pooler = /^aws-\d+-[a-z]+-[a-z]+-\d+\.pooler\.supabase\.com$/.test(db.hostname);
    const expectedRole = `threadsignal_runtime_${role}`;
    const username = decodeURIComponent(db.username);
    const password = decodeURIComponent(db.password);
    if (
      !['postgres:', 'postgresql:'].includes(db.protocol) ||
      (!direct && !pooler) ||
      username !== (direct ? expectedRole : `${expectedRole}.${projectRef}`) ||
      !password ||
      /[\r\n\0]/.test(password) ||
      !['', '5432'].includes(db.port) ||
      db.pathname !== '/postgres' ||
      db.hash ||
      [...db.searchParams].length > 1 ||
      [...db.searchParams].some(
        ([key, value]) => key !== 'sslmode' || !['require', 'verify-full'].includes(value),
      )
    )
      throw new Error();
    const redis = new URL(env.REDIS_URL);
    if (
      redis.protocol !== 'rediss:' ||
      !publicHostname(redis.hostname) ||
      !redis.password ||
      redis.hash ||
      redis.search ||
      !['', '/', '/0'].includes(redis.pathname) ||
      (redis.port && (!/^\d+$/.test(redis.port) || Number(redis.port) < 1))
    )
      throw new Error();
    const redisPassword = decodeURIComponent(redis.password);
    const redisUsername = decodeURIComponent(redis.username);
    if (/[\r\n\0]/.test(redisPassword + redisUsername)) throw new Error();
    let extensionId: string | undefined;
    if (role === 'web') {
      if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_SECRET_KEY) throw new Error();
      const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(env.EXTENSION_ALLOWED_ORIGINS ?? '');
      if (!match?.[1]) throw new Error();
      extensionId = match[1];
    } else if (!/^sb_secret_[A-Za-z0-9_-]{16,200}$/.test(env.SUPABASE_SECRET_KEY ?? ''))
      throw new Error();
    return {
      mode: 'deployment' as const,
      role,
      projectRef,
      appOrigin: app.origin,
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      extensionId,
      storageKey: role === 'worker' ? env.SUPABASE_SECRET_KEY : undefined,
      database: {
        host: db.hostname,
        port: 5432,
        database: 'postgres',
        username,
        password,
        ssl: {
          rejectUnauthorized: true as const,
          ca: env.THREADSIGNAL_DATABASE_CA,
          servername: db.hostname,
        },
      },
      redis: {
        host: redis.hostname,
        port: Number(redis.port || 6379),
        db: 0,
        username: redisUsername || 'default',
        password: redisPassword,
        tls: { rejectUnauthorized: true as const, servername: redis.hostname },
      },
      queuePrefix: `threadsignal-deployment-${projectRef}`,
    };
  } catch {
    // Never expose Zod issues or URL exceptions: both may retain credentials.
    throw new Error('Invalid approved deployment runtime configuration.');
  }
}
export type DeploymentRuntime = ReturnType<typeof parseDeploymentRuntime>;
