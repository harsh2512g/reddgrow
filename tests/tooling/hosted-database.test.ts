import { describe, expect, it, vi } from 'vitest';
import {
  parseHostedDatabaseConfig,
  safeDatabaseError,
  loadSupabaseCertificate,
} from '../../scripts/hosted-database-config.mjs';
import {
  reviewedSource,
  phase2Migration,
  sourceObjects,
  assertSnapshotsEqual,
} from '../../scripts/migrate-hosted-phase2.mjs';

const project = 'abcdefghijklmnopqrst';
const uri = `postgresql://postgres.${project}:synthetic-password@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`;
describe('explicit personal hosted migration credentials', () => {
  it('accepts only the matching administrative session pooler and requires verified TLS', () => {
    expect(
      parseHostedDatabaseConfig(`DATABASE_URL="${uri}"\nUNRELATED=unused`, project),
    ).toMatchObject({
      username: `postgres.${project}`,
      password: 'synthetic-password',
      port: 5432,
      database: 'postgres',
      ssl: { rejectUnauthorized: true },
      max: 1,
    });
  });
  it('decodes valid escapes once and preserves unescaped literal percent signs in memory', () => {
    for (const [encoded, decoded] of [
      ['a%25b%40c', 'a%b@c'],
      ['a%oops', 'a%oops'],
      ['a%2525', 'a%25'],
    ]) {
      expect(
        parseHostedDatabaseConfig(
          `DATABASE_URL=${uri.replace('synthetic-password', encoded!)}`,
          project,
        ).password,
      ).toBe(decoded);
    }
  });
  it('rejects foreign projects, arbitrary hosts, unsafe options, malformed passwords, and ambiguous entries', () => {
    for (const input of [
      uri.replace(project, 'zyxwvutsrqponmlkjihg'),
      uri.replace('pooler.supabase.com', 'example.com'),
      uri.replace('5432', '6543'),
      uri + '?sslmode=disable',
      uri + '?sslrootcert=/outside/file',
      uri + '#fragment',
      uri.replace('/postgres', '/other'),
      uri.replace('synthetic-password', '[YOUR-PASSWORD]'),
      uri.replace('synthetic-password', '%FF'),
    ])
      expect(() => parseHostedDatabaseConfig(`DATABASE_URL="${input}"`, project)).toThrow(
        'Invalid DATABASE_URL',
      );
    expect(() =>
      parseHostedDatabaseConfig(`DATABASE_URL=${uri}\nDATABASE_URL=${uri}`, project),
    ).toThrow();
    expect(() => parseHostedDatabaseConfig('UNRELATED=synthetic', project)).toThrow();
  });
  it('never prints raw connection errors or their parameters', () => {
    expect(safeDatabaseError({ code: '28P01', message: uri })).toBe('28P01');
    expect(safeDatabaseError({ code: uri, message: uri })).toBe('HOSTED_DATABASE_CHECK_FAILED');
  });
  it('refuses CA download redirects, failed downloads and oversized response bodies', async () => {
    const request = vi.fn().mockResolvedValue(new Response('', { status: 302 }));
    await expect(loadSupabaseCertificate(request)).rejects.toThrow();
    expect(request.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
    await expect(
      loadSupabaseCertificate(vi.fn().mockResolvedValue(new Response('x'.repeat(10001)))),
    ).rejects.toThrow();
  });
});

describe('reviewed hosted Phase 2 delta', () => {
  it('applies exactly the reviewed eight-table migration, with no authentication seed or bootstrap replay', () => {
    const source = reviewedSource(phase2Migration);
    const objects = sourceObjects(source);
    expect(objects.tables).toHaveLength(8);
    expect(objects.functions).toHaveLength(14);
    expect(source).not.toMatch(/(?:insert into|delete from|update) auth\.users/i);
    expect(source).not.toContain('create table public.organizations');
    expect(() => reviewedSource({ ...phase2Migration, sha256: 'unreviewed' })).toThrow('checksum');
  });
  it('detects structural or privilege drift without including database contents in the error', () => {
    const expected = {
      tables: [{ relname: 'brands', relrowsecurity: true }],
      grants: [{ allowed: false }],
    };
    expect(() =>
      assertSnapshotsEqual(structuredClone(expected), expected, 'Phase 1 baseline'),
    ).not.toThrow();
    expect(() =>
      assertSnapshotsEqual(
        { ...expected, grants: [{ allowed: true }] },
        expected,
        'Phase 1 baseline',
      ),
    ).toThrow('Phase 1 baseline mismatch: grants.');
  });
});
