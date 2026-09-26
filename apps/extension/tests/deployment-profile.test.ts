import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  chromeIdForPublicKey,
  readPublicExtensionProfile,
  validateExtensionProfile,
} from '../scripts/profile.mjs';
import development from '../../../config/extension-development.json';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
// The package path is apps/extension/tests -> repository is three parent directories.
const profile = { ...development, apiOrigin: 'https://threadsignal.example.com' };
let directory: string;
beforeAll(async () => {
  await mkdir(join(repository, '.threadsignal'), { recursive: true });
  directory = await mkdtemp(join(repository, '.threadsignal/extension-public-profile-'));
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe('explicit extension deployment profiles', () => {
  it('preserves the exact development ID and API while deriving Chrome IDs from the public SPKI key', () => {
    expect(chromeIdForPublicKey(development.manifestKey)).toBe(development.extensionId);
    expect(validateExtensionProfile(development)).toEqual(development);
    expect(validateExtensionProfile(profile, true)).toEqual(profile);
    expect(() =>
      validateExtensionProfile({ ...profile, extensionId: 'a'.repeat(32) }, true),
    ).toThrow(/does not match/);
    expect(() =>
      validateExtensionProfile({ ...profile, manifestKey: 'bm90IGEga2V5' }, true),
    ).toThrow(/public SPKI/);
  });
  it.each([
    'http://threadsignal.example.com',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://service.internal',
    'https://app.test',
    'https://app.example',
    'https://user:password@app.example.com',
    'https://app.example.com:8443',
    'https://app.example.com/path',
    'https://app.example.com/',
    'https://app.example.com?query=1',
    'https://app.example.com#fragment',
  ])('rejects an unsafe or noncanonical deployment origin %s', (apiOrigin) => {
    expect(() => validateExtensionProfile({ ...profile, apiOrigin }, true)).toThrow();
  });
  it('rejects credential fields, unknown fields and development-origin overrides', () => {
    expect(() => validateExtensionProfile({ ...profile, token: 'not-a-real-token' }, true)).toThrow(
      /only public/,
    );
    expect(() => validateExtensionProfile(profile)).toThrow(/fixed local/);
  });
  it('rejects absolute/traversal/environment and symlink paths before reading a profile', async () => {
    for (const path of [
      '/outside.json',
      '../outside.json',
      'config/../outside.json',
      '.env.local',
      '.env.json',
      'config\\outside.json',
    ])
      await expect(readPublicExtensionProfile(repository, path, true)).rejects.toThrow();
    await writeFile(join(directory, 'profile.json'), JSON.stringify(profile));
    await symlink(join(directory, 'profile.json'), join(directory, 'linked.json'));
    await expect(
      readPublicExtensionProfile(
        repository,
        relative(repository, join(directory, 'linked.json')),
        true,
      ),
    ).rejects.toThrow(/symlink/);
    await symlink(directory, join(directory, 'linked-directory'));
    await expect(
      readPublicExtensionProfile(
        repository,
        relative(repository, join(directory, 'linked-directory/profile.json')),
        true,
      ),
    ).rejects.toThrow(/symlink/);
    expect(
      await readPublicExtensionProfile(
        repository,
        relative(repository, join(directory, 'profile.json')),
        true,
      ),
    ).toEqual(profile);
  });
  it('packages one HTTPS API origin without loopback code or additional extension powers', async () => {
    const path = join(directory, 'artifact.json');
    await writeFile(path, JSON.stringify(profile));
    execFileSync(
      process.execPath,
      ['apps/extension/scripts/build.mjs', '--deployment', '--profile', relative(repository, path)],
      { cwd: repository, stdio: 'pipe', timeout: 30_000 },
    );
    const output = join(repository, 'apps/extension/dist-deployment');
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')) as {
      permissions: string[];
      host_permissions: string[];
      key: string;
      content_security_policy: { extension_pages: string };
    };
    expect(manifest.permissions).toEqual(['sidePanel', 'storage', 'activeTab', 'scripting']);
    expect(manifest.host_permissions).toEqual([`${profile.apiOrigin}/*`]);
    expect(manifest.key).toBe(profile.manifestKey);
    expect(manifest.content_security_policy.extension_pages).toContain(
      `connect-src ${profile.apiOrigin};`,
    );
    expect(manifest).not.toHaveProperty('content_scripts');
    expect(manifest).not.toHaveProperty('optional_host_permissions');
    const panel = await readFile(join(output, 'sidepanel/index.html'), 'utf8');
    expect(panel).toContain(`${profile.apiOrigin}/app/settings/integrations`);
    for (const content of [
      panel,
      await readFile(join(output, 'background/index.js'), 'utf8'),
      await readFile(join(output, 'sidepanel/index.js'), 'utf8'),
    ]) {
      expect(content.includes('127.0.0.1')).toBe(false);
      expect(content.includes('localhost')).toBe(false);
    }
  });
});
