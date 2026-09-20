import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  root,
  state,
  registry,
  localEnvironment,
  rejectAppEnvFiles,
  assertInside,
} from './isolation.mjs';
import { loadVerifiedServiceRuntime } from './service-utils.mjs';

const [command, ...args] = process.argv.slice(2);
const env = localEnvironment();
rejectAppEnvFiles();
const runtime = loadVerifiedServiceRuntime();
env.THREADSIGNAL_SERVICES_READY = runtime ? '1' : '0';
if (runtime) {
  env.DATABASE_URL = runtime.DATABASE_URL;
  if (runtime.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY = runtime.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  }
}
function run(binary, argv) {
  const result = spawnSync(binary, argv, { cwd: root, env, stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`Unable to start ${binary}: ${result.error.code ?? 'error'}\n`);
    return 1;
  }
  return result.status ?? 1;
}
if (command === 'doctor') {
  process.stdout.write(`Node ${process.version}; project-local tool configuration\n`);
  process.exitCode = run('colima', ['version']) || run('docker', ['--version']);
} else if (command === 'registry') {
  for (const name of args) {
    const split = name.lastIndexOf('@');
    const packageName = split > 0 ? name.slice(0, split) : name;
    const major = split > 0 ? name.slice(split + 1) : null;
    const response = await fetch(
      new URL(encodeURIComponent(packageName) + (major ? '' : '/latest'), registry),
    );
    if (!response.ok) throw new Error(`Public npm metadata failed for ${name}: ${response.status}`);
    const metadata = await response.json();
    const version = major
      ? Object.keys(metadata.versions)
          .filter((v) => v.startsWith(major + '.') && !v.includes('-'))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .at(-1)
      : null;
    if (major && !version) throw new Error(`No stable ${major} release found for ${packageName}`);
    const value = version ? metadata.versions[version] : metadata;
    process.stdout.write(
      JSON.stringify({
        name: value.name,
        version: value.version,
        engines: value.engines ?? {},
        peerDependencies: value.peerDependencies,
        optionalDependencies: value.optionalDependencies,
        dependencies: value.dependencies,
        scripts: value.scripts,
      }) + '\n',
    );
  }
} else if (command === 'bootstrap') {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    .packageManager.split('@')
    .at(-1);
  const destination = join(state, 'pnpm-bootstrap');
  mkdirSync(assertInside(destination), { recursive: true });
  const metadataResponse = await fetch(`${registry}pnpm/${version}`);
  if (!metadataResponse.ok) throw new Error('Unable to verify public pnpm metadata.');
  const metadata = await metadataResponse.json();
  const response = await fetch(`${registry}pnpm/-/pnpm-${version}.tgz`);
  if (!response.ok) throw new Error(`Public pnpm download failed: ${response.status}`);
  const archive = assertInside(join(destination, 'pnpm.tgz'));
  const bytes = Buffer.from(await response.arrayBuffer());
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  if (metadata.dist.integrity !== integrity)
    throw new Error('pnpm archive integrity check failed.');
  writeFileSync(archive, bytes);
  process.exitCode = run('tar', ['-xzf', archive, '-C', destination]);
} else if (command === 'pnpm') {
  const cli = assertInside(join(state, 'pnpm-bootstrap/package/bin/pnpm.mjs'));
  if (!existsSync(cli)) throw new Error('Run node scripts/run-local.mjs bootstrap first.');
  process.exitCode = run(process.execPath, [cli, ...args]);
} else if (command === 'colima' || command === 'docker') {
  // These entry points only expose non-mutating local tool help/version inspection.
  if (
    !args.every((arg) => ['--help', 'help', 'version', '--version', 'start'].includes(arg)) ||
    (args.includes('start') && !args.includes('--help'))
  )
    throw new Error('Use services scripts for container operations.');
  process.exitCode = run(command, args);
} else {
  throw new Error('Use doctor, registry, bootstrap, pnpm, or tool help.');
}
