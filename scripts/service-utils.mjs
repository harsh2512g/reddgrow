import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { root, state, localEnvironment, assertInside, dockerSocketFor } from './isolation.mjs';
import {
  ownershipInspectFormat,
  recordServiceOwnership,
  verifyServiceOwnership,
} from './service-ownership.mjs';

export const workdir = join(state, 'services');
export const socket = dockerSocketFor(root);
export function dockerClientConfiguration() {
  return { auths: {}, credsStore: 'threadsignal', currentContext: 'colima' };
}
export function initializeDockerConfiguration() {
  const directory = assertInside(join(state, 'docker'));
  mkdirSync(directory, { recursive: true });
  // Never retain auto-selected platform credential stores or inherited auth entries.
  writeFileSync(
    assertInside(join(directory, 'config.json')),
    JSON.stringify(dockerClientConfiguration()),
    { mode: 0o600 },
  );
}
export function dockerArguments(args) {
  return ['--config', assertInside(join(state, 'docker')), '--context', 'colima', ...args];
}
export function serviceEnvironment() {
  const env = localEnvironment();
  return { ...env, DOCKER_HOST: `unix://${socket}`, DOCKER_CONTEXT: 'colima' };
}
export function colimaEnvironment() {
  // Lima requires the real home path during initialization. Do not redirect HOME;
  // all actual configuration/cache/state paths are explicitly project-local, and
  // host mounts, SSH-agent forwarding, public-key loading, and SSH config writes
  // are disabled by services.mjs.
  return { ...localEnvironment(), HOME: homedir() };
}
export function execute(
  binary,
  args,
  {
    input,
    quiet = false,
    allowFailure = false,
    env = serviceEnvironment(),
    cwd = root,
    timeout,
  } = {},
) {
  if (binary === 'docker' || binary === 'supabase' || binary === 'colima') {
    initializeDockerConfiguration();
  }
  const result = spawnSync(binary, binary === 'docker' ? dockerArguments(args) : args, {
    cwd,
    env,
    input,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout,
  });
  if (result.error) throw new Error(`Cannot execute ${binary}: ${result.error.code ?? 'error'}`);
  if (result.status !== 0 && !allowFailure) {
    // Supabase output may include local keys. Never propagate raw CLI output.
    const safe = (value) =>
      (value ?? '')
        .split('\n')
        .map((line) =>
          /(?:secret|password|token|jwt|(?:anon|service.role|publishable).*key|postgres(?:ql)?:\/\/)/i.test(
            line,
          )
            ? '[Sensitive local configuration output suppressed]'
            : line.replace(/(https?:\/\/[^\s?]+)\?[^\s]+/g, '$1?[query withheld]'),
        )
        .join('\n');
    process.stderr.write(safe(result.stderr));
    process.stderr.write(safe(result.stdout));
    throw new Error(`${binary} ${args[0] ?? ''} failed with exit ${result.status}.`);
  }
  if (!quiet && binary !== 'supabase') process.stdout.write(result.stdout ?? '');
  return result;
}
export function prepareSupabase() {
  mkdirSync(assertInside(join(workdir, 'supabase')), { recursive: true });
  for (const name of ['config.toml', 'seed.sql', 'migrations'])
    cpSync(
      assertInside(join(root, 'supabase', name)),
      assertInside(join(workdir, 'supabase', name)),
      { recursive: true },
    );
}
export function supabase(args, options = {}) {
  return execute('supabase', [...args, '--workdir', workdir], {
    ...options,
    cwd: workdir,
    quiet: true,
  });
}
export function verifyDocker({ silent = false } = {}) {
  const metadata = (args) => {
    const result = execute('docker', args, { quiet: true, allowFailure: silent, timeout: 5_000 });
    if (result.status !== 0) throw new Error('Project Docker metadata is unavailable.');
    return result.stdout.trim();
  };
  const context = metadata(['context', 'show']);
  if (context !== 'colima') throw new Error('Docker context must be project-local colima.');
  const inspect = metadata([
    'context',
    'inspect',
    'colima',
    '--format',
    '{{.Endpoints.docker.Host}}',
  ]);
  if (inspect !== `unix://${socket}`)
    throw new Error('Docker context does not point to the project-local Colima socket.');
  metadata(['info', '--format', '{{.ServerVersion}}']);
}
export function localDatabaseUrl() {
  const runtime = loadVerifiedServiceRuntime();
  if (!runtime) throw new Error('Start and verify project services before database commands.');
  return runtime.DATABASE_URL;
}

function serviceOwnershipAdapter() {
  return {
    verifyDocker: () => verifyDocker({ silent: true }),
    inspectContainer: (reference) => {
      const result = execute(
        'docker',
        ['container', 'inspect', '--format', ownershipInspectFormat, reference],
        {
          quiet: true,
          allowFailure: true,
          timeout: 5_000,
        },
      );
      if (result.status !== 0) throw new Error('Project container metadata is unavailable.');
      return result.stdout;
    },
  };
}

export function loadVerifiedServiceRuntime() {
  try {
    const path = assertInside(join(state, 'runtime.json'));
    if (!existsSync(path)) return undefined;
    const runtime = parseRuntimeConfiguration(readFileSync(path, 'utf8'));
    return verifyServiceOwnership(runtime.SERVICE_OWNERSHIP, serviceOwnershipAdapter())
      ? runtime
      : undefined;
  } catch {
    // A stopped, replaced, malformed or unreachable stack keeps the app in degraded mode.
    return undefined;
  }
}

/** Refresh local ownership after startup without restarting the VM or containers. */
export function recordServiceRuntime() {
  verifyDocker();
  const runtime = parseSupabaseStatus(supabase(['status', '--output', 'json']).stdout);
  const recorded = {
    ...runtime,
    SERVICE_OWNERSHIP: recordServiceOwnership(serviceOwnershipAdapter()),
  };
  writeFileSync(assertInside(join(state, 'runtime.json')), JSON.stringify(recorded), {
    mode: 0o600,
  });
}

function normalizeDatabaseUrl(value, acceptSupabaseAliases = false) {
  if (typeof value !== 'string') throw new Error('Missing local database URL.');
  const url = new URL(value);
  const protocols = acceptSupabaseAliases ? ['postgres:', 'postgresql:'] : ['postgresql:'];
  const hosts = acceptSupabaseAliases ? ['localhost', '127.0.0.1'] : ['127.0.0.1'];
  if (
    !protocols.includes(url.protocol) ||
    !hosts.includes(url.hostname) ||
    url.port !== '54322' ||
    url.pathname !== '/postgres' ||
    url.search ||
    url.hash ||
    !url.username ||
    !url.password
  ) {
    throw new Error('Invalid local database endpoint.');
  }
  url.protocol = 'postgresql:';
  url.hostname = '127.0.0.1';
  return url.toString();
}

export function parseRuntimeConfiguration(raw) {
  try {
    const data = JSON.parse(raw);
    return {
      DATABASE_URL: normalizeDatabaseUrl(data.DATABASE_URL),
      ...publicAuthConfiguration(data.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      ...(data.SERVICE_OWNERSHIP === undefined
        ? {}
        : { SERVICE_OWNERSHIP: data.SERVICE_OWNERSHIP }),
    };
  } catch {
    // Do not retain a cause: URL errors expose .input, and JSON errors may quote input.
    throw new Error('Invalid generated local configuration.');
  }
}

export function parseSupabaseStatus(raw) {
  try {
    const data = JSON.parse(raw);
    return {
      DATABASE_URL: normalizeDatabaseUrl(data.DB_URL ?? data.DATABASE_URL, true),
      ...publicAuthConfiguration(data.ANON_KEY),
    };
  } catch {
    throw new Error('Supabase returned invalid local configuration.');
  }
}

function publicAuthConfiguration(key) {
  if (key === undefined) return {};
  if (typeof key !== 'string' || key.length > 4096)
    throw new Error('Invalid public auth configuration.');
  const parts = key.split('.');
  if (parts.length !== 3 || !parts[1]) throw new Error('Invalid public auth configuration.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (claims.role !== 'anon') throw new Error('Invalid public auth configuration.');
  return { NEXT_PUBLIC_SUPABASE_ANON_KEY: key };
}

/** Each callback targets only this project. Verification gates all Docker mutations. */
export function stopServicesSafely(steps) {
  const failures = [];
  try {
    let verified = false;
    try {
      steps.verifyDocker();
      verified = true;
    } catch {
      failures.push('docker_verification');
    }
    if (verified) {
      for (const name of ['stopSupabase', 'stopCompose']) {
        try {
          steps[name]();
        } catch {
          failures.push(name);
        }
      }
    }
  } finally {
    try {
      steps.stopColima();
    } catch {
      failures.push('stopColima');
    }
  }
  return failures;
}
