import { afterEach, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  hostedMigrations,
  prepareHostedArtifacts,
} from '../../scripts/prepare-hosted-supabase.mjs';
import { assertInside, root } from '../../scripts/isolation.mjs';

const fixtures: string[] = [];

function migrationFixture() {
  const parent = assertInside(join(root, '.threadsignal/tmp'));
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'hosted-migrations-'));
  fixtures.push(directory);
  for (const migration of hostedMigrations) {
    copyFileSync(
      join(root, 'supabase/migrations', migration.file),
      join(directory, migration.file),
    );
  }
  return directory;
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('offline hosted Supabase bootstrap', () => {
  it('excludes the explicitly local-only Phase 2 migration from hosted setup', () => {
    const { setup } = prepareHostedArtifacts();
    expect(setup).not.toContain('create table public.brands');
    expect(setup).not.toContain('20260916000000_brand_knowledge.sql');
  });
  it('reproducibly embeds the reviewed migrations verbatim and in order, without local seeds', () => {
    const first = prepareHostedArtifacts();
    expect(prepareHostedArtifacts()).toEqual(first);
    let previousOffset = -1;
    for (const migration of hostedMigrations) {
      const source = readFileSync(join(root, 'supabase/migrations', migration.file), 'utf8');
      const offset = first.setup.indexOf(source);
      expect(offset).toBeGreaterThan(previousOffset);
      expect(first.setup.indexOf(source, offset + source.length)).toBe(-1);
      previousOffset = offset;
    }
    expect(first.setup).not.toContain(readFileSync(join(root, 'supabase/seed.sql'), 'utf8'));
    expect(first.setup).not.toMatch(/(?:insert\s+into|update|delete\s+from)\s+auth\.users\b/i);
    expect(first.setup).not.toMatch(/supabase\.co|sb_publishable_|sb_secret_/);
  });

  it('requires a fresh project before the first schema mutation and keeps the setup transactional', () => {
    const { setup, verify } = prepareHostedArtifacts();
    expect(setup.indexOf('begin;')).toBeLessThan(setup.indexOf('pg_advisory_xact_lock'));
    expect(setup.indexOf('$threadsignal_preflight$;')).toBeLessThan(
      setup.indexOf('create extension'),
    );
    expect(setup.trimEnd().endsWith('commit;')).toBe(true);
    expect(verify).toContain('begin read only;');
    expect(verify).not.toMatch(/from\s+auth\.users\b|select\s+\*/i);
    expect(verify.trimEnd().endsWith('rollback;')).toBe(true);
  });

  it('rejects newly added migrations rather than silently applying a later phase', () => {
    const directory = migrationFixture();
    writeFileSync(
      join(directory, '20260916000000_later_phase.sql'),
      'create table public.future(id int);',
    );
    expect(() => prepareHostedArtifacts(directory)).toThrow('exactly the reviewed');
  });

  it('rejects a copied seed file in the migration directory', () => {
    const directory = migrationFixture();
    copyFileSync(join(root, 'supabase/seed.sql'), join(directory, 'seed.sql'));
    expect(() => prepareHostedArtifacts(directory)).toThrow('exactly the reviewed');
  });

  it('rejects a missing foundation migration', () => {
    const directory = migrationFixture();
    rmSync(join(directory, hostedMigrations[0]!.file));
    expect(() => prepareHostedArtifacts(directory)).toThrow('exactly the reviewed');
  });

  it('rejects SQL changed after review, including injected user seed data', () => {
    const directory = migrationFixture();
    const path = join(directory, hostedMigrations[0]!.file);
    writeFileSync(
      path,
      `${readFileSync(path, 'utf8')}\ninsert into auth.users(id) values (gen_random_uuid());\n`,
    );
    expect(() => prepareHostedArtifacts(directory)).toThrow(
      'changed since hosted bootstrap review',
    );
  });

  it('rejects migration symlinks without reading their target', () => {
    const directory = migrationFixture();
    const path = join(directory, hostedMigrations[0]!.file);
    rmSync(path);
    symlinkSync(join(root, '..', 'unaccessed-migration-fixture.sql'), path);
    expect(() => prepareHostedArtifacts(directory)).toThrow('Symlinks');
  });

  it('rejects non-file entries even when their name matches a migration', () => {
    const directory = migrationFixture();
    const path = join(directory, hostedMigrations[0]!.file);
    rmSync(path);
    mkdirSync(path);
    expect(() => prepareHostedArtifacts(directory)).toThrow('regular reviewed migration files');
  });

  it('refuses an outside-repository source before reading the directory', () => {
    expect(() => prepareHostedArtifacts(join(root, '..', 'unaccessed-migrations'))).toThrow(
      'inside this repository',
    );
  });
});
