import { describe, expect, it, vi } from 'vitest';
import {
  applyHostedProfile,
  checkHostedConnection,
  parseHostedProfile,
} from '../../scripts/hosted-profile.mjs';
import { localEnvironment } from '../../scripts/isolation.mjs';

const profile = {
  purpose: 'personal-development',
  projectRef: 'abcdefghijklmnopqrst',
  url: 'https://abcdefghijklmnopqrst.supabase.co',
  publishableKey: 'sb_publishable_synthetic_personal_test_key',
};

describe('personal development Supabase profile', () => {
  it('requires explicit personal purpose, matching project URL, and only public fields', () => {
    expect(parseHostedProfile(profile)).toEqual(profile);
    for (const change of [
      { purpose: 'production' },
      { url: 'https://anotherprojectaaaaaa.supabase.co' },
      { url: profile.url + '/' },
      { url: profile.url + '.example.test' },
      { url: 'http://127.0.0.1:54321' },
      { publishableKey: 'sb_secret_' + 'synthetic_rejected_key' },
      { publishableKey: 'a.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.b' },
      { databasePassword: 'synthetic-do-not-echo' },
    ])
      expect(() => parseHostedProfile({ ...profile, ...change })).toThrow(
        'public configuration only',
      );
  });

  it('does not mutate local configuration or forward local database/admin configuration', () => {
    const local = {
      ...localEnvironment(),
      DATABASE_URL: 'postgresql://synthetic',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local',
      SUPABASE_SECRET_KEY: 'synthetic',
    };
    const before = { ...local };
    const env = applyHostedProfile(local, profile, true);
    expect(local).toEqual(before);
    expect(env).toMatchObject({
      THREADSIGNAL_LOCAL: '1',
      THREADSIGNAL_SUPABASE_MODE: 'personal-development',
      THREADSIGNAL_SERVICES_READY: '1',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3002',
      NEXT_PUBLIC_SUPABASE_URL: profile.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: profile.publishableKey,
      REDDIT_PROVIDER: 'mock',
      AI_PROVIDER: 'mock',
      EMAIL_PROVIDER: 'console',
      BILLING_PROVIDER: 'mock',
      CRAWLER_PROVIDER: 'fixture',
      GOOGLE_AUTH_ENABLED: 'false',
    });
    for (const name of ['DATABASE_URL', 'SUPABASE_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
      expect(env).not.toHaveProperty(name);
    }
    expect(applyHostedProfile(local, profile, false).THREADSIGNAL_SERVICES_READY).toBe('0');
  });

  it('checks only fixed read-only endpoints and never treats anonymous denial as schema verification', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));
    expect(await checkHostedConnection(profile, request)).toEqual({
      authStatus: 200,
      auth: 'reachable',
      schemaStatus: 401,
      schema: 'requires-authenticated-verification',
    });
    expect(request).toHaveBeenCalledTimes(2);
    for (const [url, init] of request.mock.calls) {
      expect(url.origin).toBe(profile.url);
      expect(init).toMatchObject({
        method: 'GET',
        redirect: 'error',
        headers: { apikey: profile.publishableKey },
      });
      expect(init.headers).not.toHaveProperty('Authorization');
    }
  });

  it('distinguishes an absent schema and stops after invalid-key/network failures', async () => {
    const absent = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }));
    expect((await checkHostedConnection(profile, absent)).schema).toBe('missing-or-not-exposed');
    const rejected = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    expect((await checkHostedConnection(profile, rejected)).auth).toBe('unavailable');
    expect(rejected).toHaveBeenCalledTimes(1);
    const offline = vi.fn().mockRejectedValue(new Error('private response must not propagate'));
    expect((await checkHostedConnection(profile, offline)).authStatus).toBeNull();
    expect(offline).toHaveBeenCalledTimes(1);
    const unused = vi.fn();
    await expect(
      checkHostedConnection({ ...profile, url: 'https://unrelated.example.test' }, unused),
    ).rejects.toThrow('public configuration only');
    expect(unused).not.toHaveBeenCalled();
  });
});
