import { z } from 'zod';
import { parseDeploymentRuntime } from './deployment.js';

const optionalText = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

const optionalUrl = z.preprocess((value) => (value === '' ? undefined : value), z.url().optional());

const modelCostsSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(150)
      .refine((key) => !['__proto__', 'constructor', 'prototype'].includes(key)),
    z
      .object({
        inputPerMillion: z.number().finite().nonnegative(),
        outputPerMillion: z.number().finite().nonnegative(),
      })
      .strict(),
  )
  .refine((value) => Object.keys(value).length <= 50);
const optionalModelCosts = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .max(16384)
    .transform((value, context) => {
      try {
        const parsed = modelCostsSchema.safeParse(JSON.parse(value));
        if (parsed.success) return parsed.data;
      } catch {
        /* Report the field name only through the environment error boundary. */
      }
      context.addIssue({ code: 'custom', message: 'Invalid model cost configuration' });
      return z.NEVER;
    })
    .optional(),
);

const optionalPublishableKey = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .regex(/^sb_publishable_[A-Za-z0-9_-]{16,200}$/)
    .optional(),
);

const optionalAnonKey = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .max(4096)
    .refine((value) => {
      // This checks the public role only. Supabase verifies the JWT signature.
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return false;
      try {
        const payload = value.split('.')[1];
        if (!payload) return false;
        const decoded: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
        return z.object({ role: z.literal('anon') }).safeParse(decoded).success;
      } catch {
        return false;
      }
    })
    .optional(),
);

const booleanFlag = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean().default(false),
);

const publicShape = {
  NEXT_PUBLIC_APP_URL: z.url().default('http://127.0.0.1:3000'),
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalAnonKey,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalPublishableKey,
};

export const clientEnvSchema = z.object(publicShape);

const serverEnvSchema = z
  .object({
    ...publicShape,
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PRODUCT_NAME: z.literal('ThreadSignal').default('ThreadSignal'),
    THREADSIGNAL_SUPABASE_MODE: z
      .enum(['local', 'personal-development', 'deployment'])
      .default('local'),
    THREADSIGNAL_DEPLOYMENT_APPROVED: booleanFlag,
    THREADSIGNAL_RUNTIME_ROLE: z.enum(['web', 'worker']).optional(),
    THREADSIGNAL_LOCAL: z.string().optional(),
    THREADSIGNAL_DATABASE_CA: optionalText,
    THREADSIGNAL_HOSTED_KNOWLEDGE_READY: z.enum(['0', '1']).default('0'),
    THREADSIGNAL_SUPABASE_PROJECT_REF: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .regex(/^[a-z]{20}$/)
        .optional(),
    ),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    WORKER_PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
    DATABASE_URL: optionalUrl,
    REDIS_URL: z
      .url()
      .refine((value) => /^rediss?:/.test(value))
      .default('redis://127.0.0.1:56379'),
    SUPABASE_SERVICE_ROLE_KEY: optionalText,
    SUPABASE_SECRET_KEY: optionalText,
    GOOGLE_AUTH_ENABLED: booleanFlag,
    REDDIT_PROVIDER: z.enum(['mock', 'oauth']).default('mock'),
    REDDIT_CLIENT_ID: optionalText,
    REDDIT_CLIENT_SECRET: optionalText,
    REDDIT_USER_AGENT: optionalText,
    REDDIT_COMMERCIAL_APPROVAL_CONFIRMED: booleanFlag,
    AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
    OPENAI_API_KEY: optionalText,
    AI_FAST_MODEL: optionalText,
    AI_SMART_MODEL: optionalText,
    AI_EMBEDDING_MODEL: optionalText,
    AI_MODEL_COSTS_JSON: optionalModelCosts,
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    CRAWLER_PROVIDER: z.enum(['fixture', 'simple', 'firecrawl']).default('fixture'),
    FIRECRAWL_API_KEY: optionalText,
    EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
    RESEND_API_KEY: optionalText,
    EMAIL_FROM: optionalText,
    BILLING_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
    STRIPE_SECRET_KEY: optionalText,
    STRIPE_WEBHOOK_SECRET: optionalText,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalText,
    STRIPE_SOLO_PRICE_ID: optionalText,
    STRIPE_GROWTH_PRICE_ID: optionalText,
    SENTRY_DSN: optionalUrl,
    NEXT_PUBLIC_SENTRY_DSN: optionalUrl,
    POSTHOG_KEY: optionalText,
    NEXT_PUBLIC_POSTHOG_KEY: optionalText,
    TRACKING_HASH_SALT: optionalText,
    CONVERSION_COOKIE_NAME: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/)
      .default('ts_click_id'),
    DEFAULT_ATTRIBUTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    EXTENSION_TOKEN_SECRET: optionalText,
    EXTENSION_ALLOWED_ORIGINS: optionalText,
    STORAGE_BUCKET_KNOWLEDGE: z.literal('knowledge-private').default('knowledge-private'),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(10),
    MAX_SOLO_CRAWL_PAGES: z.coerce.number().int().min(1).max(1000).default(30),
    MAX_GROWTH_CRAWL_PAGES: z.coerce.number().int().min(1).max(1000).default(100),
  })
  .superRefine((env, context) => {
    if (env.THREADSIGNAL_SUPABASE_MODE === 'deployment') {
      try {
        parseDeploymentRuntime(env, env.THREADSIGNAL_RUNTIME_ROLE ?? 'web');
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['THREADSIGNAL_SUPABASE_MODE'],
          message: 'Invalid deployment configuration',
        });
      }
    } else if (env.THREADSIGNAL_DEPLOYMENT_APPROVED || env.THREADSIGNAL_RUNTIME_ROLE) {
      context.addIssue({
        code: 'custom',
        path: ['THREADSIGNAL_RUNTIME_ROLE'],
        message: 'Deployment configuration cannot be used in local profiles',
      });
    }
    const required = (names: readonly (keyof typeof env)[]) => {
      for (const name of names) {
        const value = env[name];
        if (typeof value !== 'string' || value.trim().length === 0) {
          context.addIssue({
            code: 'custom',
            path: [name],
            message: 'Required for selected provider',
          });
        }
      }
    };
    if (env.REDDIT_PROVIDER === 'oauth') {
      required(['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USER_AGENT']);
      if (!env.REDDIT_COMMERCIAL_APPROVAL_CONFIRMED) {
        context.addIssue({
          code: 'custom',
          path: ['REDDIT_COMMERCIAL_APPROVAL_CONFIRMED'],
          message: 'Approved access required',
        });
      }
    }
    if (env.AI_PROVIDER === 'openai')
      required(['OPENAI_API_KEY', 'AI_FAST_MODEL', 'AI_SMART_MODEL', 'AI_EMBEDDING_MODEL']);
    if (env.CRAWLER_PROVIDER === 'firecrawl') required(['FIRECRAWL_API_KEY']);
    if (env.EMAIL_PROVIDER === 'resend') required(['RESEND_API_KEY', 'EMAIL_FROM']);
    if (env.BILLING_PROVIDER === 'stripe')
      required([
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
        'STRIPE_SOLO_PRICE_ID',
        'STRIPE_GROWTH_PRICE_ID',
      ]);
    if (
      env.THREADSIGNAL_HOSTED_KNOWLEDGE_READY === '1' &&
      env.THREADSIGNAL_SUPABASE_MODE !== 'personal-development'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['THREADSIGNAL_HOSTED_KNOWLEDGE_READY'],
        message: 'Hosted knowledge requires a validated personal development profile',
      });
    }
    if (env.THREADSIGNAL_SUPABASE_MODE === 'personal-development') {
      required([
        'THREADSIGNAL_SUPABASE_PROJECT_REF',
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      ]);
      const expected = {
        NEXT_PUBLIC_SUPABASE_URL: `https://${env.THREADSIGNAL_SUPABASE_PROJECT_REF}.supabase.co`,
        NEXT_PUBLIC_APP_URL: 'http://localhost:3002',
        REDDIT_PROVIDER: 'mock',
        AI_PROVIDER: 'mock',
        EMAIL_PROVIDER: 'console',
        BILLING_PROVIDER: 'mock',
        CRAWLER_PROVIDER: 'fixture',
        GOOGLE_AUTH_ENABLED: false,
      } as const;
      for (const [name, value] of Object.entries(expected)) {
        if (env[name as keyof typeof expected] !== value) {
          context.addIssue({
            code: 'custom',
            path: [name],
            message: 'Invalid personal development configuration',
          });
        }
      }
      if (
        env.DATABASE_URL ||
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        env.SUPABASE_SERVICE_ROLE_KEY ||
        env.SUPABASE_SECRET_KEY
      ) {
        context.addIssue({
          code: 'custom',
          path: ['THREADSIGNAL_SUPABASE_MODE'],
          message: 'Personal development uses only the public Supabase API',
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

/** Contains field names only: never retain Zod issues, input values, or a secret-bearing cause. */
export class EnvironmentValidationError extends Error {
  constructor(readonly fields: readonly string[]) {
    super(`Invalid environment fields: ${fields.join(', ')}`);
    this.name = 'EnvironmentValidationError';
  }
}

function parseEnvironment<T>(schema: z.ZodType<T>, input: Record<string, unknown>): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new EnvironmentValidationError(
      [
        ...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? 'environment'))),
      ].sort(),
    );
  }
  return result.data;
}

/** Call with the process environment only inside the isolated local runner. */
export function parseServerEnv(input: Record<string, unknown>): ServerEnv {
  return parseEnvironment(serverEnvSchema, input);
}

/** Explicit public allowlist; server fields are never returned. */
export function parseClientEnv(input: Record<string, unknown>): ClientEnv {
  return parseEnvironment(clientEnvSchema, input);
}
