import { describe, expect, it } from 'vitest';
import {
  assertLocalProviders,
  EnvironmentValidationError,
  getProviderModes,
  LOCAL_PROVIDERS,
  parseClientEnv,
  parseServerEnv,
} from '../src/index.js';

describe('environment validation', () => {
  it('starts all development providers without credentials, even in a production build', () => {
    const env = parseServerEnv({ NODE_ENV: 'production' });
    expect(getProviderModes(env)).toEqual(LOCAL_PROVIDERS);
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(() => assertLocalProviders(env)).not.toThrow();
  });

  it.each([
    ['AI_PROVIDER', 'openai', 'OPENAI_API_KEY'],
    ['REDDIT_PROVIDER', 'oauth', 'REDDIT_CLIENT_SECRET'],
    ['EMAIL_PROVIDER', 'resend', 'RESEND_API_KEY'],
    ['BILLING_PROVIDER', 'stripe', 'STRIPE_SECRET_KEY'],
    ['CRAWLER_PROVIDER', 'firecrawl', 'FIRECRAWL_API_KEY'],
  ])('requires secrets only when %s selects %s', (selector, value, missing) => {
    expect(() => parseServerEnv({ [selector]: value })).toThrow(missing);
    expect(() => parseServerEnv({})).not.toThrow();
  });

  it('validates a complete selected AI configuration without other provider keys', () => {
    const env = parseServerEnv({
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'fixture-value',
      AI_FAST_MODEL: 'configured-fast',
      AI_SMART_MODEL: 'configured-smart',
      AI_EMBEDDING_MODEL: 'configured-embedding',
    });
    expect(env.REDDIT_CLIENT_SECRET).toBeUndefined();
    expect(() => assertLocalProviders(env)).toThrow('Phase 0');
  });

  it('fails closed for unapproved Reddit access', () => {
    expect(() =>
      parseServerEnv({
        REDDIT_PROVIDER: 'oauth',
        REDDIT_CLIENT_ID: 'fixture',
        REDDIT_CLIENT_SECRET: 'fixture',
        REDDIT_USER_AGENT: 'fixture',
      }),
    ).toThrow('REDDIT_COMMERCIAL_APPROVAL_CONFIRMED');
  });

  it('returns no server secrets or arbitrary input fields to client code', () => {
    const env = parseClientEnv({
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
      OPENAI_API_KEY: 'sensitive-test-value',
      SUPABASE_SERVICE_ROLE_KEY: 'sensitive-test-value',
      SUPABASE_SECRET_KEY: 'sensitive-test-value',
      THREADSIGNAL_HOSTED_KNOWLEDGE_READY: '1',
      ARBITRARY_KEY: 'sensitive-test-value',
    });
    expect(env).toEqual({ NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000' });
  });

  it('supports a public publishable key without a legacy key or privileged credentials', () => {
    const publishable = 'sb_publishable_' + 'synthetic_fixture'.repeat(2);
    const env = parseClientEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable });
    expect(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(publishable);
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBeUndefined();
  });

  it('allows only the anonymous role in legacy public JWT keys', () => {
    const jwt = (role: string) =>
      [btoa('{}'), btoa(JSON.stringify({ role })), 'synthetic']
        .map((part) => part.replace(/=+$/, ''))
        .join('.');
    expect(
      parseClientEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon') }).NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ).toBe(jwt('anon'));
    expect(() => parseClientEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('service_role') })).toThrow(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    );
  });

  it.each(['sb_secret_synthetic_fixture_value', 'service_role', 'malformed'])(
    'rejects a private or malformed key in every public key field: %s',
    (key) => {
      for (const field of [
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      ]) {
        try {
          parseClientEnv({ [field]: key });
          expect.fail('Public keys must validate');
        } catch (error) {
          expect(error).toBeInstanceOf(EnvironmentValidationError);
          expect(String(error)).toContain(field);
          expect(JSON.stringify(error)).not.toContain(key);
        }
      }
    },
  );

  it('confines personal hosted development to its selected project and mock providers', () => {
    const profile = {
      THREADSIGNAL_SUPABASE_MODE: 'personal-development',
      THREADSIGNAL_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
      NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3002',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'synthetic_fixture'.repeat(2),
    };
    const env = parseServerEnv(profile);
    expect(getProviderModes(env)).toEqual(LOCAL_PROVIDERS);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.SUPABASE_SECRET_KEY).toBeUndefined();
    expect(env.THREADSIGNAL_HOSTED_KNOWLEDGE_READY).toBe('0');
    expect(parseClientEnv(profile)).not.toHaveProperty('THREADSIGNAL_SUPABASE_PROJECT_REF');
    const readyProfile = { ...profile, THREADSIGNAL_HOSTED_KNOWLEDGE_READY: '1' };
    expect(parseServerEnv(readyProfile).THREADSIGNAL_HOSTED_KNOWLEDGE_READY).toBe('1');
    expect(parseClientEnv(readyProfile)).not.toHaveProperty('THREADSIGNAL_HOSTED_KNOWLEDGE_READY');
    for (const change of [
      { THREADSIGNAL_SUPABASE_PROJECT_REF: undefined },
      { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://differentprojecthere.supabase.co' },
      { NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000' },
      { CRAWLER_PROVIDER: 'simple' },
      { GOOGLE_AUTH_ENABLED: true },
      { DATABASE_URL: 'postgres://localhost/database' },
      { SUPABASE_SERVICE_ROLE_KEY: 'synthetic-private-value' },
      { SUPABASE_SECRET_KEY: 'sb_secret_synthetic_private_value' },
    ]) {
      expect(() => parseServerEnv({ ...profile, ...change })).toThrow(EnvironmentValidationError);
      expect(() => parseServerEnv({ ...readyProfile, ...change })).toThrow(
        EnvironmentValidationError,
      );
    }
  });

  it('rejects hosted readiness without a personal development profile', () => {
    expect(() => parseServerEnv({ THREADSIGNAL_HOSTED_KNOWLEDGE_READY: '1' })).toThrow(
      'THREADSIGNAL_HOSTED_KNOWLEDGE_READY',
    );
    expect(() => parseServerEnv({ THREADSIGNAL_HOSTED_KNOWLEDGE_READY: 'true' })).toThrow(
      'THREADSIGNAL_HOSTED_KNOWLEDGE_READY',
    );
  });

  it('never includes invalid input or nested issue details in errors', () => {
    try {
      parseServerEnv({ REDIS_URL: 'sensitive-test-value', AI_PROVIDER: 'sensitive-test-value' });
      expect.fail('Validation must fail');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      expect(String(error)).toContain('AI_PROVIDER, REDIS_URL');
      expect(String(error)).not.toContain('sensitive-test-value');
      expect(JSON.stringify(error)).not.toContain('sensitive-test-value');
    }
  });

  it.each([
    { WORKER_PORT: '0' },
    { REDIS_URL: 'https://example.com' },
    { AI_MAX_RETRIES: '100' },
    { REDDIT_COMMERCIAL_APPROVAL_CONFIRMED: 'yes' },
  ])('rejects invalid operational configuration: %j', (input) => {
    expect(() => parseServerEnv(input)).toThrow(EnvironmentValidationError);
  });
});
