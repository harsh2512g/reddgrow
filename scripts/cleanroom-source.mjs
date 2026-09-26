import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertInside, localEnvironment, root, state } from './isolation.mjs';

const rootFiles = new Set([
  '.env.example',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  '.prettierignore',
  'AGENTS.md',
  'CHANGELOG.md',
  'DECISIONS.md',
  'IMPLEMENTATION_STATUS.md',
  'README.md',
  'SPEC_COMPLIANCE_MATRIX.md',
  'docker-compose.yml',
  'eslint.config.mjs',
  'package.json',
  'playwright.config.ts',
  'playwright.extension.config.ts',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'prettier.config.mjs',
  'threadsignal_astra_build_prompts.md',
  'threadsignal_master_build_spec.md',
  'tsconfig.base.json',
  'tsconfig.tooling.json',
  'turbo.json',
  'vitest.config.ts',
  'vitest.integration.config.ts',
]);
const sourceDirectories = new Set([
  '.github',
  'apps',
  'packages',
  'config',
  'docs',
  'fixtures',
  'scripts',
  'supabase',
  'tests',
]);
const generatedDirectories = new Set([
  'node_modules',
  '.pnpm-store',
  '.threadsignal',
  '.local',
  '.lima',
  '.colima',
  '.audit',
  '.git',
  '.next',
  '.next-hosted',
  '.next-deployment',
  'dist',
  'dist-deployment',
  'build',
  'out',
  '.turbo',
  'coverage',
  'playwright-report',
  'test-results',
  'tmp',
  'temp',
]);

export function isCleanroomSource(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\'))
    return false;
  const parts = path.split('/');
  if (
    parts.some((part) => !part || part === '.' || part === '..' || generatedDirectories.has(part))
  )
    return false;
  if (parts.some((part) => part.startsWith('.env') && part !== '.env.example')) return false;
  if (/\.(?:pem|key|p12|pfx|log|tsbuildinfo)$/i.test(path)) return false;
  if (path.endsWith('/next-env.d.ts') || path === 'apps/web/public/threadsignal.js') return false;
  return parts.length === 1 ? rootFiles.has(path) : sourceDirectories.has(parts[0]);
}

export function isolatedGit(args, cwd = root) {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd,
    env: {
      ...localEnvironment(),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_OPTIONAL_LOCKS: '0',
    },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('CLEANROOM_GIT_OPERATION_FAILED');
  return result.stdout;
}

export function validateCleanroomManifest(manifest, sourceRoot, snapshotRoot) {
  if (
    !manifest ||
    manifest.version !== 1 ||
    manifest.sourceRoot !== sourceRoot ||
    manifest.snapshotRoot !== snapshotRoot ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length
  )
    throw new Error('CLEANROOM_MANIFEST_INVALID');
  const paths = new Set();
  for (const file of manifest.files) {
    if (
      !file ||
      !isCleanroomSource(file.path) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      paths.has(file.path)
    )
      throw new Error('CLEANROOM_MANIFEST_INVALID');
    paths.add(file.path);
  }
  if (
    !paths.has('package.json') ||
    !paths.has('scripts/local') ||
    !paths.has('supabase/config.toml')
  )
    throw new Error('CLEANROOM_MANIFEST_INVALID');
  return manifest;
}

export function verifyCleanroomSourceHashes(manifest, readHash) {
  for (const file of manifest.files)
    if (readHash(file.path) !== file.sha256) throw new Error('CLEANROOM_SNAPSHOT_SOURCE_CHANGED');
}

/** Source-only working-tree snapshot: no ignored credentials, caches or symlinks.
 * Resume validates the exact owned snapshot before refreshing source. Public
 * dependency/browser caches stay in place; installation and all gates run again.
 */
export function prepareCleanroomSnapshot({ resume = false } = {}) {
  const destination = assertInside(join(root, '.audit'));
  const metadata = assertInside(join(destination, '.threadsignal'));
  const evidenceRoot = assertInside(join(state, 'cleanroom'));
  let previous;
  let evidence = evidenceRoot;
  if (resume) {
    if (!existsSync(destination)) throw new Error('CLEANROOM_RESUME_REQUIRES_SNAPSHOT');
    const stored = readFileSync(assertInside(join(metadata, 'cleanroom-source.json')), 'utf8');
    if (stored !== readFileSync(assertInside(join(evidenceRoot, 'source-manifest.json')), 'utf8'))
      throw new Error('CLEANROOM_MANIFEST_MISMATCH');
    previous = validateCleanroomManifest(JSON.parse(stored), root, destination);
    verifyCleanroomSourceHashes(previous, (path) => {
      const file = assertInside(join(destination, path));
      if (!lstatSync(file).isFile()) throw new Error('CLEANROOM_SOURCE_NOT_REGULAR');
      return createHash('sha256').update(readFileSync(file)).digest('hex');
    });
    const known = new Set(previous.files.map((file) => file.path));
    const sourceNames = isolatedGit(
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      destination,
    )
      .split('\0')
      .filter(Boolean);
    if (sourceNames.some((path) => isCleanroomSource(path) && !known.has(path)))
      throw new Error('CLEANROOM_SNAPSHOT_UNOWNED_SOURCE');
    let attempt = 2;
    while (
      existsSync(assertInside(join(evidenceRoot, `attempt-${String(attempt).padStart(2, '0')}`)))
    )
      attempt++;
    evidence = assertInside(join(evidenceRoot, `attempt-${String(attempt).padStart(2, '0')}`));
    mkdirSync(evidence);
    writeFileSync(assertInside(join(evidence, 'previous-source-manifest.json')), stored, {
      flag: 'wx',
    });
  } else if (existsSync(destination)) throw new Error('CLEANROOM_SNAPSHOT_ALREADY_EXISTS');
  const candidates = [
    ...new Set(
      isolatedGit(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
        .split('\0')
        .filter(Boolean),
    ),
  ];
  const paths = candidates
    .filter(isCleanroomSource)
    .filter((path) => existsSync(assertInside(join(root, path))))
    .sort();
  if (
    !paths.includes('package.json') ||
    !paths.includes('scripts/local') ||
    !paths.includes('supabase/config.toml')
  )
    throw new Error('CLEANROOM_SOURCE_INCOMPLETE');
  // Validate every source first, before creating a partial snapshot.
  for (const path of paths) {
    const source = assertInside(join(root, path));
    if (!lstatSync(source).isFile()) throw new Error('CLEANROOM_SOURCE_NOT_REGULAR');
  }
  if (!resume) mkdirSync(destination);
  if (previous) {
    const current = new Set(paths);
    for (const file of previous.files)
      if (!current.has(file.path)) unlinkSync(assertInside(join(destination, file.path)));
  }
  const files = [];
  for (const path of paths) {
    const source = assertInside(join(root, path));
    const target = assertInside(join(destination, path));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    files.push({ path, sha256: createHash('sha256').update(readFileSync(target)).digest('hex') });
  }
  const template = assertInside(join(metadata, 'empty-git-template'));
  mkdirSync(template, { recursive: true });
  isolatedGit(
    [
      '-c',
      `init.templateDir=${template}`,
      '-c',
      `core.hooksPath=${template}`,
      'init',
      '--initial-branch=main',
    ],
    destination,
  );
  isolatedGit(['-c', `core.hooksPath=${template}`, 'add', '--all'], destination);
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceRoot: root,
    snapshotRoot: destination,
    files,
  };
  writeFileSync(
    assertInside(join(metadata, 'cleanroom-source.json')),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  mkdirSync(evidence, { recursive: true });
  writeFileSync(
    assertInside(join(evidence, 'source-manifest.json')),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  if (resume)
    writeFileSync(
      assertInside(join(evidenceRoot, 'source-manifest.json')),
      JSON.stringify(manifest, null, 2) + '\n',
    );
  return { destination, evidence, files: files.length };
}

export function reportedOutsideTemporaryPath(output) {
  // Remove this repository prefix before checking explicitly reported outside paths.
  const sanitized = output.split(root).join('[repository]');
  return /(?:^|[\s"'(])\/(?:private\/)?(?:tmp|var\/folders)\//m.test(sanitized);
}

/** Every attempted service transition has a compensating action, even on start failure. */
export async function withRestoredServices(steps, verify) {
  const errors = [];
  let originalTouched = false,
    snapshotTouched = false;
  try {
    originalTouched = true;
    await steps.stopOriginal();
    snapshotTouched = true;
    await steps.startSnapshot();
    await verify();
  } catch (error) {
    errors.push(error);
  } finally {
    if (snapshotTouched) {
      try {
        await steps.stopSnapshot();
      } catch (error) {
        errors.push(error);
      }
    }
    if (originalTouched) {
      try {
        await steps.restoreOriginal();
        await steps.checkOriginal();
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length) throw new AggregateError(errors, 'CLEANROOM_VERIFICATION_FAILED');
}
