import {
  assertLocalProviders,
  parseDeploymentRuntime,
  parseServerEnv,
  type DeploymentRuntime,
} from '@threadsignal/config';
import type { OpenAIProviderOptions } from '@threadsignal/ai';
import type { OAuthRedditOptions } from '@threadsignal/reddit';
import type { ResendEmailOptions } from '@threadsignal/email';
import { z } from 'zod';
import { QUEUE_PREFIX } from './jobs/heartbeat';

export const WORKER_ENVIRONMENT_KEYS = [
  'NODE_ENV',
  'WORKER_PORT',
  'DATABASE_URL',
  'REDIS_URL',
  'LOG_LEVEL',
  'REDDIT_PROVIDER',
  'AI_PROVIDER',
  'EMAIL_PROVIDER',
  'BILLING_PROVIDER',
  'CRAWLER_PROVIDER',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'THREADSIGNAL_SUPABASE_MODE',
  'THREADSIGNAL_WORKER_MODE',
  'THREADSIGNAL_SUPABASE_PROJECT_REF',
  'THREADSIGNAL_DATABASE_CA',
  'SUPABASE_SECRET_KEY',
  'REDDIT_MAX_POST_AGE_DAYS',
  'REDDIT_CONTENT_RETENTION_DAYS',
  'DRAFT_MAX_SOURCE_CHARACTERS',
  'DRAFT_MAX_CONTEXT_CHARACTERS',
  'THREADSIGNAL_LOCAL',
  'THREADSIGNAL_DEPLOYMENT_APPROVED',
  'THREADSIGNAL_RUNTIME_ROLE',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'REDDIT_USER_AGENT',
  'REDDIT_COMMERCIAL_APPROVAL_CONFIRMED',
  'OPENAI_API_KEY',
  'AI_FAST_MODEL',
  'AI_SMART_MODEL',
  'AI_EMBEDDING_MODEL',
  'AI_MODEL_COSTS_JSON',
  'AI_MAX_RETRIES',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_SOLO_PRICE_ID',
  'STRIPE_GROWTH_PRICE_ID',
] as const;

export const redditPolicySchema = z
  .object({
    maxAgeDays: z.coerce.number().int().min(1).max(30).default(30),
    retentionDays: z.coerce.number().int().min(1).max(30).default(30),
  })
  .refine(
    (policy) => policy.maxAgeDays <= policy.retentionDays,
    'Post age cannot exceed content retention.',
  );

export const draftPolicySchema = z
  .object({
    maxSourceCharacters: z.coerce.number().int().min(1000).max(24_000).default(24_000),
    maxContextCharacters: z.coerce.number().int().min(20_000).max(80_000).default(80_000),
  })
  .strict()
  .refine(
    (policy) => policy.maxSourceCharacters <= policy.maxContextCharacters,
    'Source context cannot exceed the total draft context budget.',
  );

export type WorkerStorageConfig =
  | { mode: 'local'; baseUrl: 'http://127.0.0.1:54321'; key: string | undefined }
  | {
      mode: 'personal-development' | 'deployment';
      baseUrl: string;
      projectRef: string;
      key: string;
    };

export type WorkerProviderConfig = {
  ai: { mode: 'mock' | 'openai'; options?: OpenAIProviderOptions };
  reddit: { mode: 'mock' | 'oauth'; options?: OAuthRedditOptions };
  email: { mode: 'console' | 'resend'; options?: ResendEmailOptions };
  crawler: 'fixture' | 'simple';
};

export type WorkerConfig = {
  mode: 'local' | 'personal-development' | 'deployment';
  appOrigin?: string;
  providers?: WorkerProviderConfig;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  database: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl: false | { rejectUnauthorized: true; ca: string; servername: string };
  };
  redis: { host: string; port: number; db: number } | DeploymentRuntime['redis'];
  queuePrefix: string;
  storage: WorkerStorageConfig;
  redditPolicy: z.infer<typeof redditPolicySchema>;
  draftPolicy: z.infer<typeof draftPolicySchema>;
};

function parseLocalRedis(value: string) {
  try {
    const redis = new URL(value);
    if (
      redis.protocol !== 'redis:' ||
      redis.hostname !== '127.0.0.1' ||
      redis.port !== '56379' ||
      !['', '/', '/0'].includes(redis.pathname) ||
      redis.username !== '' ||
      redis.password !== '' ||
      redis.search !== '' ||
      redis.hash !== ''
    )
      throw new Error();
    return { host: redis.hostname, port: Number(redis.port), db: 0 };
  } catch {
    throw new Error('Worker Redis must be the isolated ThreadSignal local Redis service.');
  }
}

const hostedSchema = z.object({
  THREADSIGNAL_WORKER_MODE: z.literal('personal-development'),
  THREADSIGNAL_SUPABASE_MODE: z.literal('personal-development'),
  THREADSIGNAL_SUPABASE_PROJECT_REF: z.string().regex(/^[a-z]{20}$/),
  NEXT_PUBLIC_SUPABASE_URL: z.string().max(200),
  DATABASE_URL: z.string().min(1).max(4096),
  // The launcher downloads and verifies this public CA. PostgreSQL performs
  // certificate-chain and hostname validation when opening every connection.
  THREADSIGNAL_DATABASE_CA: z
    .string()
    .max(10000)
    .regex(
      /^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----\s*$/,
    ),
  SUPABASE_SECRET_KEY: z.string().regex(/^sb_secret_[A-Za-z0-9_-]{16,200}$/),
  SUPABASE_SERVICE_ROLE_KEY: z.undefined().optional(),
  REDIS_URL: z.string().default('redis://127.0.0.1:56379'),
  WORKER_PORT: z.coerce.number().pipe(z.literal(3003)).default(3003),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  REDDIT_PROVIDER: z.literal('mock').default('mock'),
  AI_PROVIDER: z.literal('mock').default('mock'),
  EMAIL_PROVIDER: z.literal('console').default('console'),
  BILLING_PROVIDER: z.literal('mock').default('mock'),
  CRAWLER_PROVIDER: z.literal('fixture').default('fixture'),
});

function parseHostedWorkerConfig(input: Record<string, unknown>): WorkerConfig {
  // This deliberately does not relax the shared web environment schema, which
  // must continue to refuse administrator database and Storage credentials.
  const result = hostedSchema.safeParse(input);
  if (!result.success) throw new Error('Invalid personal development worker configuration.');
  const env = result.data;
  const projectRef = env.THREADSIGNAL_SUPABASE_PROJECT_REF;
  if (env.NEXT_PUBLIC_SUPABASE_URL !== `https://${projectRef}.supabase.co`)
    throw new Error('Hosted worker must use the exact personal Supabase project.');
  let database: URL;
  let username: string;
  let password: string;
  try {
    database = new URL(env.DATABASE_URL);
    username = decodeURIComponent(database.username);
    password = decodeURIComponent(database.password);
    const direct = database.hostname === `db.${projectRef}.supabase.co`;
    const pooler = /^aws-\d+-[a-z]+-[a-z]+-\d+\.pooler\.supabase\.com$/.test(database.hostname);
    if (
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      (!direct && !pooler) ||
      (direct
        ? username !== 'threadsignal_worker'
        : username !== `threadsignal_worker.${projectRef}`) ||
      !password ||
      /[\r\n\0]/.test(password) ||
      !['', '5432'].includes(database.port) ||
      database.pathname !== '/postgres' ||
      database.hash ||
      [...database.searchParams].length > 1 ||
      [...database.searchParams].some(
        ([key, value]) => key !== 'sslmode' || !['require', 'verify-full'].includes(value),
      )
    )
      throw new Error();
  } catch {
    // A URL parser exception can contain the entire credential. Never retain it.
    throw new Error(
      'Hosted worker requires its restricted database role on the personal project session or direct connection.',
    );
  }
  return {
    mode: 'personal-development',
    redditPolicy: redditPolicySchema.parse({}),
    draftPolicy: draftPolicySchema.parse({}),
    port: env.WORKER_PORT,
    logLevel: env.LOG_LEVEL,
    database: {
      host: database.hostname,
      port: 5432,
      database: 'postgres',
      username,
      password,
      ssl: {
        rejectUnauthorized: true,
        ca: env.THREADSIGNAL_DATABASE_CA,
        servername: database.hostname,
      },
    },
    redis: parseLocalRedis(env.REDIS_URL),
    queuePrefix: `threadsignal-hosted-${projectRef}`,
    storage: {
      mode: 'personal-development',
      baseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      projectRef,
      key: env.SUPABASE_SECRET_KEY,
    },
  };
}

export function parseWorkerConfig(input: Record<string, unknown>): WorkerConfig {
  if (input.THREADSIGNAL_WORKER_MODE === 'deployment') return parseDeploymentWorkerConfig(input);
  if (input.THREADSIGNAL_WORKER_MODE === 'personal-development')
    return parseHostedWorkerConfig(input);
  if (input.THREADSIGNAL_WORKER_MODE !== undefined && input.THREADSIGNAL_WORKER_MODE !== 'local')
    throw new Error('Invalid worker mode.');
  if (input.SUPABASE_SECRET_KEY !== undefined || input.THREADSIGNAL_DATABASE_CA !== undefined)
    throw new Error('Hosted credentials cannot be used by the local worker.');
  const env = parseServerEnv(input);
  assertLocalProviders(env);
  if (
    env.THREADSIGNAL_SUPABASE_MODE !== 'local' ||
    (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321')
  )
    throw new Error('Hosted worker processing is not enabled.');
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const parts = env.SUPABASE_SERVICE_ROLE_KEY.split('.');
      if (
        parts.length !== 3 ||
        !parts[1] ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(env.SUPABASE_SERVICE_ROLE_KEY) ||
        env.SUPABASE_SERVICE_ROLE_KEY.length > 4096 ||
        JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role !== 'service_role'
      )
        throw new Error();
    } catch {
      throw new Error('Invalid local worker storage key.');
    }
  }

  if (!env.DATABASE_URL) {
    throw new Error('Start through the ThreadSignal runner after pnpm services:start.');
  }

  const database = new URL(env.DATABASE_URL);
  if (
    database.protocol !== 'postgresql:' ||
    database.hostname !== '127.0.0.1' ||
    database.port !== '54322' ||
    database.pathname !== '/postgres' ||
    database.search !== '' ||
    database.hash !== '' ||
    !database.username ||
    !database.password
  ) {
    throw new Error('Worker database must be the isolated ThreadSignal local PostgreSQL service.');
  }
  return {
    mode: 'local',
    draftPolicy: draftPolicySchema.parse({
      maxSourceCharacters: input.DRAFT_MAX_SOURCE_CHARACTERS,
      maxContextCharacters: input.DRAFT_MAX_CONTEXT_CHARACTERS,
    }),
    redditPolicy: redditPolicySchema.parse({
      maxAgeDays: input.REDDIT_MAX_POST_AGE_DAYS,
      retentionDays: input.REDDIT_CONTENT_RETENTION_DAYS,
    }),
    port: env.WORKER_PORT,
    logLevel: env.LOG_LEVEL,
    database: {
      host: database.hostname,
      port: Number(database.port),
      database: 'postgres',
      username: decodeURIComponent(database.username),
      password: decodeURIComponent(database.password),
      ssl: false,
    },
    redis: parseLocalRedis(env.REDIS_URL),
    queuePrefix: QUEUE_PREFIX,
    storage: {
      mode: 'local',
      baseUrl: 'http://127.0.0.1:54321',
      key: env.SUPABASE_SERVICE_ROLE_KEY,
    },
  };
}

function parseDeploymentWorkerConfig(input: Record<string, unknown>): WorkerConfig {
  try {
    const runtime = parseDeploymentRuntime(input, 'worker');
    const env = parseServerEnv(input);
    if (!runtime.storageKey || env.CRAWLER_PROVIDER === 'firecrawl') throw new Error();
    return {
      mode: 'deployment',
      appOrigin: runtime.appOrigin,
      port: env.WORKER_PORT,
      logLevel: env.LOG_LEVEL,
      database: runtime.database,
      redis: runtime.redis,
      queuePrefix: runtime.queuePrefix,
      storage: {
        mode: 'deployment',
        baseUrl: runtime.supabaseUrl,
        projectRef: runtime.projectRef,
        key: runtime.storageKey,
      },
      redditPolicy: redditPolicySchema.parse({
        maxAgeDays: input.REDDIT_MAX_POST_AGE_DAYS,
        retentionDays: input.REDDIT_CONTENT_RETENTION_DAYS,
      }),
      draftPolicy: draftPolicySchema.parse({
        maxSourceCharacters: input.DRAFT_MAX_SOURCE_CHARACTERS,
        maxContextCharacters: input.DRAFT_MAX_CONTEXT_CHARACTERS,
      }),
      providers: {
        crawler: env.CRAWLER_PROVIDER,
        ai: {
          mode: env.AI_PROVIDER,
          ...(env.AI_PROVIDER === 'openai'
            ? {
                options: {
                  apiKey: env.OPENAI_API_KEY ?? '',
                  fastModel: env.AI_FAST_MODEL ?? '',
                  smartModel: env.AI_SMART_MODEL ?? '',
                  embeddingModel: env.AI_EMBEDDING_MODEL ?? '',
                  ...(env.AI_MODEL_COSTS_JSON ? { modelCosts: env.AI_MODEL_COSTS_JSON } : {}),
                  maxRetries: Math.min(2, env.AI_MAX_RETRIES),
                  allowNetwork: true,
                },
              }
            : {}),
        },
        reddit: {
          mode: env.REDDIT_PROVIDER,
          ...(env.REDDIT_PROVIDER === 'oauth'
            ? {
                options: {
                  commercialApprovalConfirmed: env.REDDIT_COMMERCIAL_APPROVAL_CONFIRMED,
                  clientId: env.REDDIT_CLIENT_ID ?? '',
                  clientSecret: env.REDDIT_CLIENT_SECRET ?? '',
                  userAgent: env.REDDIT_USER_AGENT ?? '',
                },
              }
            : {}),
        },
        email: {
          mode: env.EMAIL_PROVIDER,
          ...(env.EMAIL_PROVIDER === 'resend'
            ? {
                options: {
                  apiKey: env.RESEND_API_KEY ?? '',
                  from: env.EMAIL_FROM ?? '',
                },
              }
            : {}),
        },
      },
    };
  } catch {
    throw new Error('Invalid approved worker deployment configuration.');
  }
}
