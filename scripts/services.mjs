import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { root, state, assertInside, colimaHomeFor } from './isolation.mjs';
import {
  execute,
  prepareSupabase,
  supabase,
  verifyDocker,
  colimaEnvironment,
  initializeDockerConfiguration,
  loadVerifiedServiceRuntime,
  recordServiceRuntime,
  stopServicesSafely,
} from './service-utils.mjs';
import { startRedis, stopRedis, healthRedis } from './redis.mjs';
import { prepareLimaConfiguration } from './lima.mjs';

if (process.env.THREADSIGNAL_LOCAL !== '1') throw new Error('Use the isolated local runner.');
const [operation] = process.argv.slice(2);

if (operation === 'start') {
  rmSync(assertInside(join(state, 'runtime.json')), { force: true });
  initializeDockerConfiguration();
  const env = colimaEnvironment();
  prepareLimaConfiguration(env.LIMA_HOME);
  execute(
    'colima',
    [
      'start',
      '--runtime',
      'docker',
      '--cpus',
      '4',
      '--memory',
      '8',
      '--disk',
      '40',
      '--mount',
      'none',
      '--ssh-config=false',
      '--ssh-agent=false',
      '--template=false',
      '--hostname',
      'threadsignal-local',
    ],
    { env },
  );
  initializeDockerConfiguration();
  verifyDocker();
  await startRedis(execute);
  prepareSupabase();
  supabase(['start']);
  recordServiceRuntime();
  process.stdout.write(
    'ThreadSignal Colima, Supabase, and Redis started. Local credentials were not printed.\n',
  );
} else if (operation === 'health') {
  if (!loadVerifiedServiceRuntime()) throw new Error('Project service ownership is not current.');
  healthRedis(execute);
  supabase(['status', '--output', 'json']);
  process.stdout.write(
    'Docker context: colima (project-local socket); Redis: PONG; Supabase: running.\n',
  );
} else if (operation === 'stop') {
  // Retained credentials must not make a stopped or incomplete stack look current.
  rmSync(assertInside(join(state, 'runtime.json')), { force: true });
  if (!existsSync(assertInside(join(colimaHomeFor(root), 'default')))) {
    process.stdout.write('No project-local Colima profile exists.\n');
  } else {
    const failures = stopServicesSafely({
      verifyDocker,
      stopSupabase: () => supabase(['stop']),
      stopCompose: () => stopRedis(execute),
      stopColima: () => execute('colima', ['stop'], { env: colimaEnvironment() }),
    });
    if (failures.length) {
      process.stderr.write('Some project services could not be stopped cleanly.\n');
      process.exitCode = 1;
    } else process.stdout.write('ThreadSignal services stopped; local data retained.\n');
  }
} else if (operation === 'record') {
  recordServiceRuntime();
  process.stdout.write(
    'Running project service ownership recorded. Local credentials were not printed.\n',
  );
} else throw new Error('Use start, health, stop, or record.');
