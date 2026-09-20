import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import postgres from 'postgres';
import { assertInside, localEnvironment, rejectAppEnvFiles, root, state } from './isolation.mjs';
import { loadVerifiedServiceRuntime } from './service-utils.mjs';
import {
  applyHostedProfile,
  checkHostedConnection,
  hostedAppOrigin,
  readHostedProfile,
} from './hosted-profile.mjs';
import { readHostedWorkerProfile, workerDatabaseConfig } from './hosted-worker-profile.mjs';
import { loadSupabaseCertificate } from './hosted-database-config.mjs';
import { assertWorkerConnection, checkHostedWorkerHealth } from './hosted-worker-access.mjs';

async function hostedKnowledgeReady(profile) {
  let sql;
  try {
    const workerProfile = readHostedWorkerProfile(profile.projectRef);
    if (!(await checkHostedWorkerHealth(profile.projectRef))) return false;
    sql = postgres(workerDatabaseConfig(workerProfile, await loadSupabaseCertificate()));
    await assertWorkerConnection(sql);
    return true;
  } catch {
    return false;
  } finally {
    await sql?.end({ timeout: 2 });
  }
}

const [command, ...extra] = process.argv.slice(2);
if (!['check', 'dev', 'build'].includes(command) || extra.length) {
  throw new Error('Use hosted-supabase.mjs check, dev, or build.');
}
rejectAppEnvFiles();
const profile = readHostedProfile();

if (command === 'check') {
  const result = await checkHostedConnection(profile);
  process.stdout.write(
    `Personal Supabase Auth: ${result.auth} (HTTP ${result.authStatus ?? 'network unavailable'}).\n`,
  );
  process.stdout.write(
    `Application schema: ${result.schema} (HTTP ${result.schemaStatus ?? 'not checked'}).\n`,
  );
  process.stdout.write('Read-only check; no login, email, schema change, or user data read.\n');
  if (result.auth !== 'reachable') process.exitCode = 1;
} else {
  const env = applyHostedProfile(
    localEnvironment(),
    profile,
    Boolean(loadVerifiedServiceRuntime()),
  );
  if (command === 'dev') {
    const ready = await hostedKnowledgeReady(profile);
    env.THREADSIGNAL_HOSTED_KNOWLEDGE_READY = ready ? '1' : '0';
    process.stdout.write(
      ready
        ? 'Hosted knowledge worker verified; brand and knowledge workflows enabled.\n'
        : 'Hosted knowledge processing unavailable; authentication remains available.\n',
    );
  }
  if (command === 'dev' && env.THREADSIGNAL_SERVICES_READY !== '1') {
    throw new Error(
      'Start and verify the project Colima services first: ./scripts/local pnpm services:start',
    );
  }
  const cli = assertInside(join(state, 'pnpm-bootstrap/package/bin/pnpm.mjs'));
  const run = (args) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      env,
      stdio: 'inherit',
    });
    if (result.error) throw new Error('Could not start the personal Supabase web process.');
    return result.status ?? 1;
  };
  // Only shared packages and web run here. Local worker/database commands retain their local profile.
  const packages = run(['exec', 'turbo', 'run', 'build', '--filter=./packages/*']);
  if (packages !== 0) process.exitCode = packages;
  else {
    if (command === 'dev')
      process.stdout.write(`ThreadSignal with personal Supabase: ${hostedAppOrigin}\n`);
    process.exitCode = run([
      '--filter',
      '@threadsignal/web',
      'exec',
      'next',
      ...(command === 'dev' ? ['dev', '--hostname', '127.0.0.1', '--port', '3002'] : ['build']),
    ]);
  }
}
