import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { draftPolicySchema, parseWorkerConfig, WORKER_ENVIRONMENT_KEYS } from '../src/config';

describe('draft context budget configuration', () => {
  it('accepts the repository policy and defaults to the same bounded budgets', () => {
    const repositoryPolicy: unknown = JSON.parse(
      readFileSync(new URL('../../../config/drafts-development.json', import.meta.url), 'utf8'),
    );
    expect(draftPolicySchema.parse(repositoryPolicy)).toEqual(draftPolicySchema.parse({}));
    expect(draftPolicySchema.parse({})).toEqual({
      maxSourceCharacters: 24_000,
      maxContextCharacters: 80_000,
    });
  });

  it('rejects excessive, fractional, empty and inconsistent budgets', () => {
    for (const policy of [
      { maxSourceCharacters: 999 },
      { maxSourceCharacters: 24_001 },
      { maxContextCharacters: 80_001 },
      { maxContextCharacters: 19_999 },
      { maxSourceCharacters: 1200.5 },
      { maxSourceCharacters: '' },
      { maxContextCharacters: 'Infinity' },
      { maxSourceCharacters: 24_000, maxContextCharacters: 20_000 },
      { unrelated_setting: true },
    ])
      expect(draftPolicySchema.safeParse(policy).success).toBe(false);
  });

  it('parses only the named local worker budget settings', () => {
    const config = parseWorkerConfig({
      DATABASE_URL: 'postgresql://postgres:fixture-password@127.0.0.1:54322/postgres',
      DRAFT_MAX_SOURCE_CHARACTERS: '12000',
      DRAFT_MAX_CONTEXT_CHARACTERS: '40000',
    });
    expect(config.draftPolicy).toEqual({
      maxSourceCharacters: 12_000,
      maxContextCharacters: 40_000,
    });
    expect(WORKER_ENVIRONMENT_KEYS).toContain('DRAFT_MAX_SOURCE_CHARACTERS');
    expect(WORKER_ENVIRONMENT_KEYS).toContain('DRAFT_MAX_CONTEXT_CHARACTERS');
  });
});
