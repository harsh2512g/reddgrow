import { describe, expect, it } from 'vitest';
import { createHmac, createHash, pbkdf2Sync } from 'node:crypto';
import {
  parseHostedWorkerProfile,
  parseHostedStorageSecret,
  hostedWorkerEnvironment,
  scramVerifier,
} from '../../scripts/hosted-worker-profile.mjs';
const ref = 'abcdefghijklmnopqrst';
const profile = {
  version: 1,
  purpose: 'personal-development',
  projectRef: ref,
  host: 'aws-0-ap-northeast-1.pooler.supabase.com',
  port: 5432,
  username: `threadsignal_worker.${ref}`,
  password: 'a'.repeat(43),
};
describe('dedicated hosted worker credential boundary', () => {
  it('accepts only this project’s restricted worker identity', () => {
    expect(parseHostedWorkerProfile(profile, ref)).toEqual(profile);
    for (const change of [
      { username: `postgres.${ref}` },
      { username: 'service_role' },
      { projectRef: 'zyxwvutsrqponmlkjihg' },
      { host: 'unrelated.example.com' },
      { port: 6543 },
      { password: 'existing-admin-secret' },
      { extra: 'unexpected' },
    ])
      expect(() => parseHostedWorkerProfile({ ...profile, ...change }, ref)).toThrow(
        'Invalid hosted worker profile',
      );
  });
  it('selects only the explicitly supplied new Storage secret and rejects duplicates', () => {
    const key = 'sb_secret_synthetic_personal_test_only';
    expect(
      parseHostedStorageSecret(`SUPABASE_SECRET_KEY=${key}\nDATABASE_URL=unused\nOTHER=unused`),
    ).toBe(key);
    for (const source of [
      '',
      'SUPABASE_SECRET_KEY=sb_publishable_invalid',
      `SUPABASE_SECRET_KEY=${key}\nSUPABASE_SECRET_KEY=${key}`,
    ])
      expect(() => parseHostedStorageSecret(source)).toThrow('SUPABASE_SECRET_KEY');
  });
  it('constructs a fresh worker-only environment with separate mode and port', () => {
    const env = hostedWorkerEnvironment(
      profile,
      {
        purpose: 'personal-development',
        projectRef: ref,
        url: `https://${ref}.supabase.co`,
        publishableKey: 'sb_publishable_synthetic_personal_test_key',
      },
      'synthetic-ca',
      'synthetic-storage',
    );
    const url = new URL(env.DATABASE_URL);
    expect(decodeURIComponent(url.username)).toBe(`threadsignal_worker.${ref}`);
    expect(env).toMatchObject({
      WORKER_PORT: '3003',
      THREADSIGNAL_WORKER_MODE: 'personal-development',
      THREADSIGNAL_SUPABASE_MODE: 'personal-development',
      AI_PROVIDER: 'mock',
      CRAWLER_PROVIDER: 'fixture',
    });
    expect(env).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
  });
  it('stores a standards-compatible SCRAM verifier instead of plaintext in role SQL', () => {
    const salt = Buffer.from('0123456789abcdef');
    const verifier = scramVerifier(profile.password, salt);
    const salted = pbkdf2Sync(profile.password, salt, 4096, 32, 'sha256');
    const key = createHmac('sha256', salted).update('Client Key').digest();
    expect(verifier.split('$')[2]?.split(':')[0]).toBe(
      createHash('sha256').update(key).digest('base64'),
    );
    expect(verifier).not.toContain(profile.password);
    expect(() => scramVerifier('not-generated')).toThrow();
  });
});
