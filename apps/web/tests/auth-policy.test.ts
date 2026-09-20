import type { User } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { parseAuthConfiguration } from '../src/lib/auth/config-policy';
import { AuthActionError, safeAuthError } from '../src/lib/auth/errors';
import {
  callbackInputSchema,
  hasTrustedOrigin,
  isSessionCookie,
  magicLinkInputSchema,
  safeNextPath,
  sessionCookieOptions,
} from '../src/lib/auth/policy';
import { verifiedUser } from '../src/lib/auth/session';

describe('authentication redirect and request boundaries', () => {
  it.each([
    '/app',
    '/app/onboarding',
    '/internal/admin',
    '/internal/admin/jobs?status=failed',
    '/app/settings/team?tab=members',
    '/app/invitations?token=fixture',
  ])('retains an internal app destination %s', (path) => {
    expect(safeNextPath(path)).toBe(path);
  });
  it.each([
    'https://example.com',
    '//example.com/app',
    'https://threadsignal.invalid/app',
    '/\\example.com',
    '/app/../../login',
    '/app/%2e%2e/login',
    '/app/%0aheader',
    '/application',
    '/internal',
    '/internal/administer',
    '/internal/admin/../../login',
    '/internal/admin/%2e%2e/settings',
    '/internal/admin%2fjobs',
    '/login',
    'app/settings',
    'javascript:alert(1)',
    '%2f%2fexample.com',
    '/app/%zz',
  ])('rejects unsafe or unrelated destination %s', (path) => {
    expect(safeNextPath(path)).toBe('/app');
  });
  it('requires the exact configured origin and rejects cross-site fetches', () => {
    const origin = 'http://127.0.0.1:3000';
    expect(hasTrustedOrigin(new Headers({ origin }), origin)).toBe(true);
    for (const other of [
      'null',
      'http://localhost:3000',
      'http://127.0.0.1:3001',
      'https://example.com',
      origin + '/',
    ]) {
      expect(hasTrustedOrigin(new Headers({ origin: other }), origin)).toBe(false);
    }
    expect(hasTrustedOrigin(new Headers(), origin)).toBe(false);
    expect(hasTrustedOrigin(new Headers({ origin, 'sec-fetch-site': 'cross-site' }), origin)).toBe(
      false,
    );
  });
  it('normalizes emails and rejects unwanted payload fields', () => {
    expect(magicLinkInputSchema.parse({ email: ' Person@Example.com ' })).toEqual({
      email: 'person@example.com',
    });
    expect(magicLinkInputSchema.safeParse({ email: 'invalid' }).success).toBe(false);
    expect(
      magicLinkInputSchema.safeParse({ email: 'person@example.com', role: 'owner' }).success,
    ).toBe(false);
  });
  it('accepts exactly one code or supported email token hash', () => {
    const token_hash = 'a'.repeat(64);
    expect(callbackInputSchema.safeParse({ code: 'fixture-code' }).success).toBe(true);
    expect(
      callbackInputSchema.safeParse({ code: 'fixture-code', sb_flow_id: 'fixtureFlow123' }).success,
    ).toBe(true);
    expect(callbackInputSchema.safeParse({ token_hash, type: 'invite' }).success).toBe(true);
    for (const input of [
      {},
      { token_hash },
      { code: 'fixture-code', token_hash, type: 'email' },
      { token_hash, type: 'recovery' },
      { token_hash, type: 'email', sb_flow_id: 'fixtureFlow123' },
      { code: 'fixture-code', sb_flow_id: '../../unsafe' },
    ]) {
      expect(callbackInputSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe('authentication isolation and cookies', () => {
  const local = {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: [btoa('{}'), btoa('{"role":"anon"}'), 'synthetic']
      .map((part) => part.replace(/=+$/, ''))
      .join('.'),
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
    NODE_ENV: 'production' as const,
  };
  it('requires ownership verification and exact local endpoints', () => {
    expect(() => parseAuthConfiguration(local, { local: true, servicesReady: false })).toThrow(
      AuthActionError,
    );
    expect(() =>
      parseAuthConfiguration(
        { ...local, NEXT_PUBLIC_SUPABASE_URL: 'https://unrelated.example' },
        { local: true, servicesReady: true },
      ),
    ).toThrow(AuthActionError);
    expect(() =>
      parseAuthConfiguration(
        { ...local, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321/path' },
        { local: true, servicesReady: true },
      ),
    ).toThrow(AuthActionError);
    expect(
      parseAuthConfiguration(local, { local: true, servicesReady: true }).verifiedLocalHttp,
    ).toBe(true);
  });
  it('supports explicit future HTTPS configuration without making a request', () => {
    const configured = {
      ...local,
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.example',
      NEXT_PUBLIC_APP_URL: 'https://app.threadsignal.example',
    };
    expect(
      parseAuthConfiguration(configured, { local: false, servicesReady: false }).verifiedLocalHttp,
    ).toBe(false);
    expect(() => parseAuthConfiguration(local, { local: false, servicesReady: false })).toThrow(
      AuthActionError,
    );
    expect(() =>
      parseAuthConfiguration(
        { ...configured, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined },
        { local: false, servicesReady: false },
      ),
    ).toThrow(AuthActionError);
  });
  it('protects production cookies and confines the HTTP exception to verified local mode', () => {
    expect(sessionCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(sessionCookieOptions(true, true).secure).toBe(false);
    expect(isSessionCookie('sb-threadsignal-auth-token.0')).toBe(true);
    expect(isSessionCookie('sb-threadsignal-auth-token-code-verifier')).toBe(true);
    expect(isSessionCookie('sb-threadsignal-auth-token-flow-fixtureFlow123-code-verifier')).toBe(
      true,
    );
    expect(isSessionCookie('sb-threadsignal-auth-token-flows-code-verifier')).toBe(true);
    expect(isSessionCookie('sb-otherproject-auth-token')).toBe(false);
    expect(isSessionCookie('unrelated-session')).toBe(false);
  });

  it('allows the selected personal project only through its dedicated local profile', () => {
    const hosted = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'synthetic_fixture'.repeat(2),
      NEXT_PUBLIC_APP_URL: 'http://localhost:3002',
      THREADSIGNAL_SUPABASE_MODE: 'personal-development' as const,
      THREADSIGNAL_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
      NODE_ENV: 'development' as const,
    };
    expect(parseAuthConfiguration(hosted, { local: true, servicesReady: true })).toMatchObject({
      url: hosted.NEXT_PUBLIC_SUPABASE_URL,
      key: hosted.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      appUrl: 'http://localhost:3002',
      verifiedLocalHttp: true,
    });
    for (const boundary of [
      { local: false, servicesReady: true },
      { local: true, servicesReady: false },
    ]) {
      expect(() => parseAuthConfiguration(hosted, boundary)).toThrow(AuthActionError);
    }
    for (const change of [
      { THREADSIGNAL_SUPABASE_MODE: 'local' as const },
      { THREADSIGNAL_SUPABASE_PROJECT_REF: 'bcdefghijklmnopqrstuva' },
      { THREADSIGNAL_SUPABASE_PROJECT_REF: undefined },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co.attacker.test' },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co/rest/v1' },
      { NEXT_PUBLIC_SUPABASE_URL: 'http://abcdefghijklmnopqrst.supabase.co' },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://user:password@abcdefghijklmnopqrst.supabase.co' },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co?query=1' },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co#fragment' },
      { NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3002' },
      { NEXT_PUBLIC_APP_URL: 'http://localhost:3000' },
      { NEXT_PUBLIC_APP_URL: 'http://localhost:3002/path' },
      { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic_fixture_value' },
      {
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: local.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      },
      { NODE_ENV: 'test' as const },
    ]) {
      expect(() =>
        parseAuthConfiguration({ ...hosted, ...change }, { local: true, servicesReady: true }),
      ).toThrow(AuthActionError);
    }
  });

  it('uses public publishable keys in explicit HTTPS production configuration', () => {
    const configured = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.example',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'synthetic_fixture'.repeat(2),
      NEXT_PUBLIC_APP_URL: 'https://app.threadsignal.example',
      NODE_ENV: 'production' as const,
    };
    expect(parseAuthConfiguration(configured, { local: false, servicesReady: false }).key).toBe(
      configured.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
    expect(() =>
      parseAuthConfiguration(
        {
          ...configured,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic_fixture_value',
        },
        { local: false, servicesReady: false },
      ),
    ).toThrow(AuthActionError);
  });
  it('does not put a provider failure or its input in public errors', () => {
    const error = safeAuthError(new Error('synthetic-sensitive-value'));
    expect(String(error)).not.toContain('synthetic-sensitive-value');
    expect(error.cause).toBeUndefined();
  });
});

describe('server-verified identity boundary', () => {
  const user: User = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'fixture@example.com',
    email_confirmed_at: '2026-09-15T00:00:00Z',
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-09-15T00:00:00Z',
  };
  it('accepts only a confirmed, non-anonymous user from a successful getUser result', () => {
    expect(verifiedUser({ data: { user }, error: null })).toBe(user);
    expect(verifiedUser({ data: { user }, error: new Error('revoked') })).toBeNull();
    expect(
      verifiedUser({ data: { user: { ...user, is_anonymous: true } }, error: null }),
    ).toBeNull();
    expect(verifiedUser({ data: { user: { ...user, id: 'invalid' } }, error: null })).toBeNull();
    expect(
      verifiedUser({ data: { user: { ...user, email_confirmed_at: '' } }, error: null }),
    ).toBeNull();
    expect(verifiedUser({ data: { user: null }, error: null })).toBeNull();
  });
});
