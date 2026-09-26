import { describe, expect, it } from 'vitest';
import {
  isCleanroomSource,
  reportedOutsideTemporaryPath,
  withRestoredServices,
  validateCleanroomManifest,
  verifyCleanroomSourceHashes,
} from '../../scripts/cleanroom-source.mjs';
import {
  root,
  limaHomeFor,
  assertLimaSocketLength,
  colimaHomeFor,
  dockerSocketFor,
  projectSocketPaths,
  assertProjectSocketLengths,
} from '../../scripts/isolation.mjs';
describe('clean-room source and isolation policy', () => {
  it.each([
    'package.json',
    'CHANGELOG.md',
    'pnpm-lock.yaml',
    '.env.example',
    'apps/web/.env.example',
    'apps/worker/src/jobs/reddit.ts',
    'supabase/migrations/new.sql',
    'tests/integration/new.test.ts',
    'docs/new-review.md',
    '.github/workflows/ci.yml',
  ])('copies approved source: %s', (path) => {
    expect(isCleanroomSource(path)).toBe(true);
  });
  it.each([
    '.env.local',
    'apps/web/.env.production',
    'credentials.json',
    '.threadsignal/runtime.json',
    '.audit/package.json',
    '.lima/colima/ssh.config',
    '.colima/default/colima.yaml',
    'apps/web/node_modules/key',
    'apps/web/.next/server.js',
    'packages/database/dist/index.js',
    'apps/extension/dist-deployment/manifest.json',
    'apps/web/next-env.d.ts',
    'apps/web/public/threadsignal.js',
    '.git/config',
    '.codex/config.json',
    'docs/certificate.pem',
    '../outside',
    '/absolute/source',
    'apps\\web\\source.ts',
    'apps//web/source.ts',
  ])('rejects private or generated input: %s', (path) => {
    expect(isCleanroomSource(path)).toBe(false);
  });
  it('keeps the original Lima home and includes the full temporary socket suffix under macOS limits', () => {
    // The same test also runs inside the snapshot's complete unit suite.
    const originalRoot = root.endsWith('/.audit') ? root.slice(0, -7) : root;
    expect(limaHomeFor(originalRoot)).toBe(`${originalRoot}/.local/lima`);
    expect(limaHomeFor(`${originalRoot}/.audit`)).toBe(`${originalRoot}/.audit/.lima`);
    expect(
      Buffer.byteLength(`${originalRoot}/.audit/.local/lima/colima/ssh.sock.1234567890123456`),
    ).toBeGreaterThanOrEqual(104);
    expect(assertLimaSocketLength(`${originalRoot}/.audit`)).toBeLessThan(104);
    const tail = '/.audit/.lima/colima/ssh.sock.1234567890123456';
    const prefix = '/' + 'x'.repeat(104 - Buffer.byteLength(tail) - 1);
    expect(() => assertLimaSocketLength(`${prefix}/.audit`)).toThrow('shorter than 104');
    expect(assertLimaSocketLength(`${prefix.slice(0, -1)}/.audit`)).toBe(103);
  });
  it('preflights every generated Colima forward and Lima socket without changing original service paths', () => {
    const originalRoot = root.endsWith('/.audit') ? root.slice(0, -7) : root;
    const snapshot = `${originalRoot}/.audit`;
    expect(colimaHomeFor(originalRoot)).toBe(`${originalRoot}/.threadsignal/colima`);
    expect(dockerSocketFor(originalRoot)).toBe(
      `${originalRoot}/.threadsignal/colima/default/docker.sock`,
    );
    expect(colimaHomeFor(snapshot)).toBe(`${snapshot}/.colima`);
    expect(dockerSocketFor(snapshot)).toBe(`${snapshot}/.colima/default/docker.sock`);
    expect(
      Buffer.byteLength(`${snapshot}/.threadsignal/colima/default/containerd.sock`),
    ).toBeGreaterThanOrEqual(104);
    const paths = projectSocketPaths(snapshot);
    expect(paths).toHaveLength(9);
    for (const name of ['default/docker.sock', 'default/containerd.sock', 'docker.sock'])
      expect(paths).toContain(`${snapshot}/.colima/${name}`);
    expect(
      assertProjectSocketLengths(snapshot).every(({ bytes }: { bytes: number }) => bytes < 104),
    ).toBe(true);
    expect(
      assertProjectSocketLengths(originalRoot).every(({ bytes }: { bytes: number }) => bytes < 104),
    ).toBe(true);
    expect(() => assertProjectSocketLengths(`${'/x'.repeat(60)}/.audit`)).toThrow(
      'shorter than 104',
    );
  });
  const manifest = {
    version: 1,
    sourceRoot: root,
    snapshotRoot: `${root}/.audit`,
    files: ['package.json', 'scripts/local', 'supabase/config.toml'].map((path) => ({
      path,
      sha256: 'a'.repeat(64),
    })),
  };
  it('accepts only the owned source manifest and verifies every prior source hash before resume', () => {
    expect(validateCleanroomManifest(manifest, root, `${root}/.audit`)).toBe(manifest);
    expect(() => verifyCleanroomSourceHashes(manifest, () => 'a'.repeat(64))).not.toThrow();
    expect(() =>
      verifyCleanroomSourceHashes(manifest, (path: string) =>
        path === 'package.json' ? 'b'.repeat(64) : 'a'.repeat(64),
      ),
    ).toThrow('CLEANROOM_SNAPSHOT_SOURCE_CHANGED');
    expect(() => verifyCleanroomSourceHashes(manifest, () => undefined)).toThrow(
      'CLEANROOM_SNAPSHOT_SOURCE_CHANGED',
    );
  });
  it.each([
    { version: 2 },
    { sourceRoot: '/unowned' },
    { snapshotRoot: '/unowned' },
    { files: [] },
    { files: [{ path: '.env.local', sha256: 'a'.repeat(64) }] },
    { files: [...manifest.files, manifest.files[0]] },
    { files: manifest.files.map((file) => ({ ...file, sha256: 'invalid' })) },
  ])('rejects an unowned or malformed resume manifest: %j', (patch) => {
    expect(() =>
      validateCleanroomManifest({ ...manifest, ...patch }, root, `${root}/.audit`),
    ).toThrow('CLEANROOM_MANIFEST_INVALID');
  });
  it('recognizes reported outside temporary paths while allowing project temporary paths', () => {
    expect(reportedOutsideTemporaryPath('helper /tmp/threadsignal.sock')).toBe(true);
    expect(reportedOutsideTemporaryPath('helper "/private/var/folders/example/temp.sock"')).toBe(
      true,
    );
    expect(reportedOutsideTemporaryPath(`helper ${root}/.audit/.threadsignal/tmp/local.sock`)).toBe(
      false,
    );
  });
  it.each([
    'stopOriginal',
    'startSnapshot',
    'verify',
    'stopSnapshot',
    'restoreOriginal',
    'checkOriginal',
  ])('attempts restoration after %s fails', async (failing) => {
    const calls: string[] = [];
    const step = (name: string) => async () => {
      calls.push(name);
      if (name === failing) throw new Error(`fixture_${name}`);
    };
    await expect(
      withRestoredServices(
        {
          stopOriginal: step('stopOriginal'),
          startSnapshot: step('startSnapshot'),
          stopSnapshot: step('stopSnapshot'),
          restoreOriginal: step('restoreOriginal'),
          checkOriginal: step('checkOriginal'),
        },
        step('verify'),
      ),
    ).rejects.toThrow('CLEANROOM_VERIFICATION_FAILED');
    expect(calls).toContain('restoreOriginal');
    if (failing !== 'restoreOriginal') expect(calls.at(-1)).toBe('checkOriginal');
    if (failing !== 'stopOriginal') expect(calls).toContain('stopSnapshot');
  });
  it('stops the snapshot before restoring and checking the original', async () => {
    const calls: string[] = [];
    const step = (name: string) => async () => {
      calls.push(name);
    };
    await withRestoredServices(
      {
        stopOriginal: step('stop'),
        startSnapshot: step('start-new'),
        stopSnapshot: step('stop-new'),
        restoreOriginal: step('restore'),
        checkOriginal: step('health'),
      },
      step('verify'),
    );
    expect(calls).toEqual(['stop', 'start-new', 'verify', 'stop-new', 'restore', 'health']);
  });
});
