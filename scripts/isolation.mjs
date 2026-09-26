import { mkdirSync, lstatSync } from 'node:fs';
import { dirname, resolve, join, delimiter, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const state = join(root, '.threadsignal');
export const registry = 'https://registry.npmjs.org/';
// Lima adds a temporary suffix to its SSH control socket on macOS. Snapshot
// roots need a shorter directory; the original project's state stays unchanged.
export function limaHomeFor(projectRoot) {
  return join(projectRoot, projectRoot.endsWith('/.audit') ? '.lima' : '.local/lima');
}
export function colimaHomeFor(projectRoot) {
  return join(projectRoot, projectRoot.endsWith('/.audit') ? '.colima' : '.threadsignal/colima');
}
export function dockerSocketFor(projectRoot) {
  return join(colimaHomeFor(projectRoot), 'default/docker.sock');
}
export function projectSocketPaths(projectRoot) {
  return [
    ...[
      'colima/ssh.sock.1234567890123456',
      'colima/ha.sock',
      'colima/ga.sock',
      'colima/qmp.sock',
      'colima/serial.sock',
      'colima/vz.sock',
    ].map((name) => join(limaHomeFor(projectRoot), name)),
    ...['default/docker.sock', 'default/containerd.sock', 'docker.sock'].map((name) =>
      join(colimaHomeFor(projectRoot), name),
    ),
  ];
}
export function assertProjectSocketLengths(projectRoot) {
  const paths = projectSocketPaths(projectRoot);
  if (paths.some((path) => Buffer.byteLength(path) >= 104))
    throw new Error('Every project Lima/Colima socket path must be shorter than 104 bytes.');
  return paths.map((path) => ({ path, bytes: Buffer.byteLength(path) }));
}
export function assertLimaSocketLength(projectRoot) {
  const bytes = Buffer.byteLength(
    join(limaHomeFor(projectRoot), 'colima/ssh.sock.1234567890123456'),
  );
  if (bytes >= 104)
    throw new Error('Project Lima temporary SSH socket path must be shorter than 104 bytes.');
  return bytes;
}

export function assertInside(path) {
  const target = resolve(path);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('Path must stay inside this repository.');
  // Check each in-repository directory entry before descending. realpath/existsSync
  // can follow an escaping link, and existsSync misses dangling links entirely.
  // Managed configuration deliberately does not support symlinks, even internal ones.
  let current = root;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment);
    let entry;
    try {
      entry = lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw new Error('Cannot validate project configuration path.');
    }
    if (entry.isSymbolicLink()) {
      throw new Error('Symlinks are not allowed in managed project configuration.');
    }
  }
  return target;
}

export function localEnvironment() {
  assertProjectSocketLengths(root);
  const directories = [
    'tmp',
    'npm-cache',
    'pnpm-cache',
    'pnpm-state',
    'pnpm',
    'xdg/config',
    'xdg/cache',
    'xdg/data',
    'xdg/state',
    'docker',
    'colima',
    'lima',
    'playwright',
    'corepack',
  ];
  for (const directory of directories)
    mkdirSync(assertInside(join(state, directory)), { recursive: true });
  mkdirSync(assertInside(limaHomeFor(root)), { recursive: true });
  mkdirSync(assertInside(colimaHomeFor(root)), { recursive: true });
  // An explicit allowlist prevents inheriting shell credentials, proxies, cloud profiles,
  // NODE_OPTIONS, package auth, Docker hosts, and monitoring destinations.
  return {
    PATH: [
      join(root, 'scripts/bin'),
      join(root, 'node_modules/.bin'),
      join(state, 'pnpm-bootstrap/package'),
      dirname(process.execPath),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
    ].join(delimiter),
    LANG: 'en_US.UTF-8',
    TZ: 'UTC',
    TERM: 'dumb',
    CI: 'true',
    TMPDIR: join(state, 'tmp'),
    TMP: join(state, 'tmp'),
    TEMP: join(state, 'tmp'),
    XDG_CONFIG_HOME: join(state, 'xdg/config'),
    XDG_CACHE_HOME: join(state, 'xdg/cache'),
    XDG_DATA_HOME: join(state, 'xdg/data'),
    XDG_STATE_HOME: join(state, 'xdg/state'),
    NPM_CONFIG_USERCONFIG: join(root, '.npmrc'),
    NPM_CONFIG_GLOBALCONFIG: join(root, 'config/npm-global.npmrc'),
    NPM_CONFIG_REGISTRY: registry,
    NPM_CONFIG_CACHE: join(state, 'npm-cache'),
    npm_config_registry: registry,
    npm_config_userconfig: join(root, '.npmrc'),
    npm_config_globalconfig: join(root, 'config/npm-global.npmrc'),
    npm_config_cache: join(state, 'npm-cache'),
    PNPM_HOME: join(state, 'pnpm'),
    COREPACK_HOME: join(state, 'corepack'),
    COREPACK_ENABLE_PROJECT_SPEC: '0',
    DOCKER_CONFIG: join(state, 'docker'),
    COLIMA_HOME: colimaHomeFor(root),
    LIMA_HOME: limaHomeFor(root),
    PLAYWRIGHT_BROWSERS_PATH: join(state, 'playwright'),
    NEXT_TELEMETRY_DISABLED: '1',
    TURBO_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
    THREADSIGNAL_LOCAL: '1',
    REDDIT_PROVIDER: 'mock',
    AI_PROVIDER: 'mock',
    EMAIL_PROVIDER: 'console',
    BILLING_PROVIDER: 'mock',
    CRAWLER_PROVIDER: 'fixture',
    REDDIT_COMMERCIAL_APPROVAL_CONFIRMED: 'false',
    REDIS_URL: 'redis://127.0.0.1:56379/0',
    WORKER_PORT: '3001',
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  };
}

export function rejectAppEnvFiles() {
  for (const app of ['web', 'worker', 'extension']) {
    for (const name of [
      '.env',
      '.env.local',
      '.env.development',
      '.env.development.local',
      '.env.production',
      '.env.production.local',
      '.env.test',
      '.env.test.local',
    ]) {
      const candidate = join(assertInside(join(root, 'apps', app)), name);
      let present = false;
      try {
        lstatSync(candidate);
        present = true;
      } catch (error) {
        if (error.code !== 'ENOENT')
          throw new Error('Cannot validate application environment files.');
      }
      if (present) {
        throw new Error(
          `Refusing to auto-load apps/${app}/${name}. Local configuration comes from the isolated runner.`,
        );
      }
    }
  }
}
