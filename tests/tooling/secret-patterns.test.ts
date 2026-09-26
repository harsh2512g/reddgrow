import { describe, expect, it } from 'vitest';
import { secretFindings } from '../../scripts/secret-patterns.mjs';

// Construct inert examples at runtime: no real or secret-shaped token is stored in source.
const token = (prefix: string, length = 40) => prefix + 'a'.repeat(length);
const jwt = (role: string) =>
  [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ role, iss: 'synthetic-secret-scan-fixture' })).toString(
      'base64url',
    ),
    Buffer.from('synthetic-unverified-signature').toString('base64url'),
  ].join('.');

describe('repository secret scanner', () => {
  it.each([
    ['sb_secret_', 'supabase_secret'],
    ['sk_test_', 'stripe_secret'],
    ['rk_test_', 'stripe_secret'],
    ['sk_live_', 'stripe_secret'],
    ['rk_live_', 'stripe_secret'],
    ['whsec_', 'stripe_webhook'],
    ['re_', 'resend_secret'],
    ['sk-proj-', 'openai_secret'],
    ['ghp_', 'github_token'],
    ['github_pat_', 'github_token'],
  ])('rejects %s credentials without returning their values', (prefix, category) => {
    const value = token(prefix);
    const findings = secretFindings(`const credential = '${value}';`);
    expect(findings).toContain(category);
    expect(JSON.stringify(findings)).not.toContain(value);
  });

  it('rejects service-role JWTs embedded in text without trusting their signatures', () => {
    const value = jwt('service_role');
    expect(secretFindings(`Authorization: Bearer ${value}`)).toEqual(['supabase_service_role']);
    expect(secretFindings(`one=${value};two=${value}`)).toEqual(['supabase_service_role']);
  });

  it('preserves public anonymous, publishable and browser payment keys', () => {
    expect(
      secretFindings(
        [jwt('anon'), token('sb_publishable_'), token('pk_test_'), token('pk_live_')].join('\n'),
      ),
    ).toEqual([]);
  });

  it('does not exempt a secret because its surrounding text calls it a fixture', () => {
    expect(secretFindings(`// synthetic fixture\nkey='${token('sb_secret_')}'`)).toEqual([
      'supabase_secret',
    ]);
  });

  it('permits names-only examples and token construction without a stored credential', () => {
    expect(
      secretFindings('SUPABASE_SECRET_KEY=\nSTRIPE_WEBHOOK_SECRET=\nconst prefix="sb_secret_";'),
    ).toEqual([]);
    expect(secretFindings('eyJnot-json.not-json.signature')).toEqual([]);
  });

  it('retains private-key and access-key checks', () => {
    expect(secretFindings(['-----BEGIN ', 'ENCRYPTED PRIVATE KEY-----'].join(''))).toEqual([
      'private_key',
    ]);
    expect(secretFindings('AKIA' + 'A'.repeat(16))).toEqual(['aws_access_key']);
  });
});
