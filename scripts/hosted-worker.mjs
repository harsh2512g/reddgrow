import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { assertInside, root, rejectAppEnvFiles } from './isolation.mjs';
import { verifyDocker, loadVerifiedServiceRuntime } from './service-utils.mjs';
import { readHostedProfile } from './hosted-profile.mjs';
import {
  readHostedDatabaseConfig,
  loadSupabaseCertificate,
  safeDatabaseError,
} from './hosted-database-config.mjs';
import { hostedMigrations } from './prepare-hosted-supabase.mjs';
import {
  reviewedSource,
  sourceObjects,
  schemaSnapshot,
  assertSnapshotsEqual,
  phase2Migration,
  readPhase2Reference,
} from './migrate-hosted-phase2.mjs';
import {
  readHostedWorkerProfile,
  createHostedWorkerProfile,
  readHostedStorageSecret,
  workerDatabaseConfig,
  hostedWorkerEnvironment,
  workerProfilePath,
  scramVerifier,
} from './hosted-worker-profile.mjs';
import {
  readWorkerOperation,
  workerPrivilegeSnapshot,
  assertWorkerConnection,
} from './hosted-worker-access.mjs';

const stripWorkerPolicies = (snapshot) => ({
  ...snapshot,
  policies: snapshot.policies.filter((policy) => !policy.roles.includes('threadsignal_worker')),
});

async function checkStorage(profile, key) {
  const response = await fetch(`${profile.url}/storage/v1/bucket/knowledge-private`, {
    headers: { apikey: key },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Hosted Storage access unavailable.');
  }
  const bucket = await response.json();
  if (
    bucket.id !== 'knowledge-private' ||
    bucket.public !== false ||
    Number(bucket.file_size_limit) !== 10485760
  )
    throw new Error('Hosted knowledge bucket configuration mismatch.');
}

export async function provisionHostedWorker(target) {
  verifyDocker();
  const runtime = loadVerifiedServiceRuntime();
  if (!runtime) throw new Error('Owned local services are required.');
  const operation = readWorkerOperation();
  const audit = operation.source.slice(
    operation.source.indexOf('-- Refuse unexpected inherited authority'),
  );
  const local = postgres(runtime.DATABASE_URL, { max: 1, onnotice: () => undefined });
  let remote;
  let restricted;
  try {
    if (target === 'local') {
      await local.begin(async (sql) => {
        await sql`select pg_catalog.pg_advisory_xact_lock(1414743635, 2)`;
        const [role] =
          await sql`select exists(select 1 from pg_catalog.pg_roles where rolname='threadsignal_worker') as present`;
        if (!role.present) await sql.unsafe(operation.source);
        await sql.unsafe(audit);
        await workerPrivilegeSnapshot(sql);
      });
      process.stdout.write(
        'Local restricted worker permissions prepared; no login or password enabled.\n',
      );
      return;
    }
    const profile = readHostedProfile();
    const key = readHostedStorageSecret();
    const config = readHostedDatabaseConfig(profile.projectRef);
    config.ssl.ca = await loadSupabaseCertificate();
    await checkStorage(profile, key);
    remote = postgres(config);
    const [existingRole] =
      await remote`select exists(select 1 from pg_catalog.pg_roles where rolname='threadsignal_worker') as present`;
    let workerProfile;
    try {
      lstatSync(assertInside(workerProfilePath));
      workerProfile = readHostedWorkerProfile(profile.projectRef);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (existingRole.present)
        throw new Error(
          'Existing hosted worker requires credential recovery; automatic rotation is disabled.',
        );
      workerProfile = createHostedWorkerProfile(profile.projectRef, config);
    }
    if (workerProfile.host !== config.host)
      throw new Error('Worker and administrator must use the same project endpoint.');
    const baselineObjects = sourceObjects(hostedMigrations.map(reviewedSource).join('\n'));
    const phase2Objects = sourceObjects(reviewedSource(phase2Migration));
    const reference = readPhase2Reference();
    const expected = {
      baseline: reference.baseline,
      phase2: reference.phase2Worker,
      worker: reference.worker,
    };
    await remote.begin(async (sql) => {
      await sql`set local search_path = ''`;
      await sql`set local lock_timeout = '5s'`;
      await sql`set local statement_timeout = '120s'`;
      await sql`select pg_catalog.pg_advisory_xact_lock(1414743635, 1)`;
      assertSnapshotsEqual(
        await schemaSnapshot(sql, baselineObjects),
        expected.baseline,
        'Phase 1 baseline',
      );
      assertSnapshotsEqual(
        stripWorkerPolicies(await schemaSnapshot(sql, phase2Objects, true, true)),
        stripWorkerPolicies(expected.phase2),
        'Existing Phase 2',
      );
      const [role] =
        await sql`select exists(select 1 from pg_catalog.pg_roles where rolname='threadsignal_worker') as present`;
      if (!role.present) {
        await sql.unsafe(operation.source);
        const verifier = scramVerifier(workerProfile.password);
        // Fixed role and a locally generated base64 SCRAM verifier; no plaintext password in SQL.
        if (
          !/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verifier)
        )
          throw new Error('Invalid verifier.');
        await sql.unsafe(`alter role threadsignal_worker login password '${verifier}'`);
      }
      await sql.unsafe(audit);
      assertSnapshotsEqual(
        await workerPrivilegeSnapshot(sql),
        expected.worker,
        'Worker privileges',
      );
      assertSnapshotsEqual(
        await schemaSnapshot(sql, phase2Objects, true, true),
        expected.phase2,
        'Migrated Phase 2',
      );
      assertSnapshotsEqual(
        await schemaSnapshot(sql, baselineObjects),
        expected.baseline,
        'Preserved Phase 1',
      );
    });
    restricted = postgres(workerDatabaseConfig(workerProfile, config.ssl.ca));
    await assertWorkerConnection(restricted);
    process.stdout.write(
      'Hosted worker role and restricted login verified; private Storage reachable. No administrator credential passed to the worker.\n',
    );
  } finally {
    await Promise.allSettled([
      local.end({ timeout: 2 }),
      remote?.end({ timeout: 2 }),
      restricted?.end({ timeout: 2 }),
    ]);
  }
}

export async function startHostedWorker() {
  verifyDocker();
  if (!loadVerifiedServiceRuntime()) throw new Error('Owned local Redis is required.');
  const profile = readHostedProfile();
  const workerProfile = readHostedWorkerProfile(profile.projectRef);
  const ca = await loadSupabaseCertificate();
  const key = readHostedStorageSecret();
  const sql = postgres(workerDatabaseConfig(workerProfile, ca));
  try {
    await assertWorkerConnection(sql);
    await checkStorage(profile, key);
  } finally {
    await sql.end({ timeout: 2 });
  }
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: join(root, 'apps/worker'),
    env: hostedWorkerEnvironment(workerProfile, profile, ca, key),
    stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.once('error', () => {
    process.stderr.write('Hosted worker could not start.\n');
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.THREADSIGNAL_LOCAL !== '1' || process.argv.length !== 3)
    throw new Error('Use isolated hosted worker commands.');
  rejectAppEnvFiles();
  try {
    if (process.argv[2] === 'prepare-local') await provisionHostedWorker('local');
    else if (process.argv[2] === 'provision') await provisionHostedWorker('hosted');
    else if (process.argv[2] === 'start') await startHostedWorker();
    else throw new Error('Unknown hosted worker operation.');
  } catch (error) {
    process.stderr.write(
      `Hosted worker setup failed: ${safeDatabaseError(error)}. No secret values logged.\n`,
    );
    process.exitCode = 1;
  }
}
