import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { z } from 'zod';
import { localEnvironment, root, assertInside } from '../../scripts/isolation.mjs';
import { join } from 'node:path';

describe('project tool isolation', () => {
  const fixtures: string[] = [];
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
  });
  it('uses a fresh environment with no inherited credentials or host destinations', () => {
    const env = localEnvironment();
    expect(
      Object.keys(env).some((key) =>
        /TOKEN|PASSWORD|SECRET|API_KEY|SSH_AUTH|AWS_|AZURE_|GOOGLE_|PROXY|NODE_OPTIONS/.test(key),
      ),
    ).toBe(false);
    expect(env.NPM_CONFIG_REGISTRY).toBe('https://registry.npmjs.org/');
    expect(env.DOCKER_CONFIG.startsWith(root)).toBe(true);
    expect(env.COLIMA_HOME.startsWith(root)).toBe(true);
    expect(env.TMPDIR.startsWith(root)).toBe(true);
    expect(env).not.toHaveProperty('HOME');
  });
  it('forces all five local providers', () => {
    expect(localEnvironment()).toMatchObject({
      REDDIT_PROVIDER: 'mock',
      AI_PROVIDER: 'mock',
      EMAIL_PROVIDER: 'console',
      BILLING_PROVIDER: 'mock',
      CRAWLER_PROVIDER: 'fixture',
    });
  });
  it('preserves repository-local tool directories through Turbo task environments', () => {
    const turbo = z
      .object({ globalPassThroughEnv: z.array(z.string()) })
      .parse(JSON.parse(readFileSync(join(root, 'turbo.json'), 'utf8')));
    for (const [key, value] of Object.entries(localEnvironment())) {
      // Turbo constructs PATH for each task; other tool locations must survive filtering.
      if (key !== 'PATH' && value.startsWith(root)) {
        expect(turbo.globalPassThroughEnv, key).toContain(key);
      }
    }
    expect(turbo.globalPassThroughEnv).toContain('NPM_CONFIG_REGISTRY');
    expect(turbo.globalPassThroughEnv).toContain('npm_config_registry');
  });
  it('rejects paths outside the repository', () => {
    expect(() => assertInside(join(root, '..', 'another-project'))).toThrow('inside');
    expect(assertInside(join(root, 'packages/config'))).toBe(join(root, 'packages/config'));
  });
  it('rejects a dangling outside symlink before descending or writing through it', () => {
    const fixture = mkdtempSync(join(root, '.threadsignal/tmp/isolation-test-'));
    fixtures.push(fixture);
    const link = join(fixture, 'runtime.json');
    // Creating a link writes only its repository directory entry; its target is never accessed.
    symlinkSync(join(root, '..', 'unaccessed-threadsignal-fixture'), link);
    expect(() => assertInside(link)).toThrow('Symlinks');
    expect(() => assertInside(join(link, 'nested/config.json'))).toThrow('Symlinks');
  });
  it('keeps managed configuration free of internal symlinks as well', () => {
    const fixture = mkdtempSync(join(root, '.threadsignal/tmp/isolation-test-'));
    fixtures.push(fixture);
    mkdirSync(join(fixture, 'real'));
    symlinkSync(join(fixture, 'real'), join(fixture, 'link'));
    expect(() => assertInside(join(fixture, 'link/config.json'))).toThrow('Symlinks');
    expect(assertInside(join(fixture, 'new/config.json'))).toBe(join(fixture, 'new/config.json'));
  });
});
