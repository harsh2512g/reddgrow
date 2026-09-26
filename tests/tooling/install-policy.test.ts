import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { root } from '../../scripts/isolation.mjs';

function check(env: Record<string, string>) {
  // Explicit fixtures only; no inherited credentials or real installation/network calls.
  return spawnSync(process.execPath, ['scripts/check-install.mjs'], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 5000,
  });
}

describe('install environment boundary', () => {
  const unapprovedEnvironments: Record<string, string>[] = [
    {},
    { CI: '1' },
    { VERCEL: '1' },
    { VERCEL: '1', CI: '1' },
    { VERCEL: '1', VERCEL_ENV: 'production' },
    { VERCEL: '1', CI: '1', VERCEL_ENV: 'development' },
  ];
  it.each(unapprovedEnvironments)(
    'rejects unwrapped local or incomplete hosted environments: %j',
    (env) => {
      const result = check(env);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Use ./scripts/local pnpm install locally');
    },
  );

  it('preserves the isolated local and wrapped CI install path', () => {
    const result = check({
      THREADSIGNAL_LOCAL: '1',
      CI: '1',
      NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
      npm_config_registry: 'https://registry.npmjs.org/',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it.each(['preview', 'production'])('accepts a Vercel %s install without local mode', (mode) => {
    const result = check({
      VERCEL: '1',
      CI: '1',
      VERCEL_ENV: mode,
      npm_config_registry: 'https://registry.npmjs.org/',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it.each(['', '0', '1'])('refuses mixing Vercel with THREADSIGNAL_LOCAL=%j', (value) => {
    const result = check({
      VERCEL: '1',
      CI: '1',
      VERCEL_ENV: 'production',
      THREADSIGNAL_LOCAL: value,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Remove THREADSIGNAL_LOCAL');
  });

  it.each(['npm_config_registry', 'NPM_CONFIG_REGISTRY'])(
    'rejects a private %s without leaking its URL',
    (name) => {
      const registry = 'https://fixture-user:fixture-password@packages.example.invalid/';
      const result = check({
        VERCEL: '1',
        CI: '1',
        VERCEL_ENV: 'preview',
        [name]: registry,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('public npm registry');
      expect(result.stderr).not.toContain(registry);
      expect(result.stderr).not.toContain('fixture-password');
    },
  );

  it('does not allow conflicting registry casing to hide a private override', () => {
    const result = check({
      THREADSIGNAL_LOCAL: '1',
      npm_config_registry: 'https://registry.npmjs.org/',
      NPM_CONFIG_REGISTRY: 'https://packages.example.invalid/',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('public npm registry');
  });
});
