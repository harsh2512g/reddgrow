import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { root, assertInside, localEnvironment, limaHomeFor } from './isolation.mjs';
import { loadVerifiedServiceRuntime } from './service-utils.mjs';
import {
  prepareCleanroomSnapshot,
  reportedOutsideTemporaryPath,
  withRestoredServices,
} from './cleanroom-source.mjs';

if (process.env.THREADSIGNAL_LOCAL !== '1') throw new Error('Use the isolated local runner.');
const [mode, resumeFlag, ...extra] = process.argv.slice(2);
if (!['prepare', 'verify'].includes(mode)) throw new Error('Use cleanroom.mjs prepare or verify.');
if (extra.length || (resumeFlag && (mode !== 'verify' || resumeFlag !== '--resume')))
  throw new Error('Only verify supports --resume.');
if (root.endsWith('/.audit')) throw new Error('CLEANROOM_NESTING_REFUSED');
const snapshot = prepareCleanroomSnapshot({ resume: resumeFlag === '--resume' });
process.stdout.write(
  `Prepared ${snapshot.files} current source files inside .audit; generated artifacts and private configuration excluded.\n`,
);
if (mode === 'prepare') process.exit(0);
if (!loadVerifiedServiceRuntime()) throw new Error('CLEANROOM_REQUIRES_HEALTHY_ORIGINAL_SERVICES');

const results = [];
let sequence = 0,
  development,
  currentCommand,
  interrupted = false;
function interruptOwnedCommands() {
  interrupted = true;
  if (currentCommand?.child.pid) {
    try {
      process.kill(-currentCommand.child.pid, 'SIGTERM');
    } catch {
      /* Only the subprocess created by this harness is signaled. */
    }
  }
  if (development?.child.pid) {
    try {
      process.kill(-development.child.pid, 'SIGTERM');
    } catch {
      /* It may already have exited. */
    }
  }
}
process.once('SIGINT', interruptOwnedCommands);
process.once('SIGTERM', interruptOwnedCommands);
const childEnvironment = localEnvironment();
function launch(cwd, args, label) {
  const path = assertInside(
    join(snapshot.evidence, `${String(++sequence).padStart(2, '0')}-${label}.log`),
  );
  const output = createWriteStream(path, { flags: 'wx', mode: 0o600 });
  const started = Date.now();
  const child = spawn(join(cwd, 'scripts/local'), args, {
    cwd,
    env: childEnvironment,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  const completed = new Promise((resolve, reject) => {
    child.on('error', () => {
      output.end();
      reject(new Error(`CLEANROOM_COMMAND_UNAVAILABLE_${label}`));
    });
    child.on('close', (code, signal) => {
      output.end(() => resolve({ code, signal, durationMs: Date.now() - started }));
    });
  });
  return { child, completed, path, args, label };
}
async function command(cwd, args, label, { allowFailure = false } = {}) {
  if (
    interrupted &&
    !['snapshot-services-stop', 'original-services-restore', 'original-health-restored'].includes(
      label,
    )
  )
    throw new Error('CLEANROOM_INTERRUPTED');
  process.stdout.write(`Clean-room: ${label}.\n`);
  const launched = launch(cwd, args, label);
  currentCommand = launched;
  const result = await launched.completed;
  currentCommand = undefined;
  results.push({
    label,
    command: ['./scripts/local', ...args],
    scope: cwd === root ? 'original' : 'snapshot',
    ...result,
    log: launched.path,
  });
  writeReport();
  if (!allowFailure && result.code !== 0) throw new Error(`CLEANROOM_COMMAND_FAILED_${label}`);
  if (label === 'snapshot-services-start') {
    // Successful Colima stderr is suppressed by the shared service launcher.
    // Inspect only this fresh VM's own repository-local host-agent logs as well.
    const logs = [
      launched.path,
      join(limaHomeFor(snapshot.destination), 'colima/ha.stderr.log'),
      join(limaHomeFor(snapshot.destination), 'colima/ha.stdout.log'),
    ];
    for (const log of logs) {
      const local = assertInside(log);
      if (existsSync(local) && reportedOutsideTemporaryPath(readFileSync(local, 'utf8')))
        throw new Error('CLEANROOM_OUTSIDE_TEMPORARY_PATH_REPORTED');
    }
  }
  return result;
}
function writeReport() {
  writeFileSync(
    assertInside(join(snapshot.evidence, 'results.json')),
    JSON.stringify({ snapshot: snapshot.destination, results }, null, 2) + '\n',
  );
}
async function health(url, timeout = 5000) {
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeout) });
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
}
async function waitForDevelopment() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error('CLEANROOM_INTERRUPTED');
    if (development?.child.exitCode !== null || development?.child.signalCode !== null)
      throw new Error('CLEANROOM_DEV_EXITED');
    const statuses = await Promise.all(
      [
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3000/api/health/ready',
        'http://127.0.0.1:3001/api/health/ready',
      ].map((url) => health(url)),
    );
    if (statuses.every((status) => status === 200)) {
      results.push({ label: 'development-health', statuses });
      writeReport();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('CLEANROOM_DEV_HEALTH_TIMEOUT');
}
async function stopDevelopment() {
  if (!development) return;
  if (development.child.exitCode === null) {
    try {
      process.kill(-development.child.pid, 'SIGTERM');
    } catch {
      // The process may have exited after the preceding status check.
    }
    await Promise.race([
      development.completed,
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (development.child.exitCode === null) {
      try {
        process.kill(-development.child.pid, 'SIGKILL');
      } catch {
        // The process group may already be gone after SIGTERM.
      }
    }
  }
  await development.completed;
  development = undefined;
}

let failure;
try {
  if (
    (await health('http://127.0.0.1:3000')) !== null ||
    (await health('http://127.0.0.1:3001/api/health')) !== null
  )
    throw new Error('CLEANROOM_STOP_ORIGINAL_WEB_AND_WORKER_FIRST');
  // Dependency installation is verified before interrupting the original service stack.
  await command(snapshot.destination, ['bootstrap'], 'bootstrap');
  await command(snapshot.destination, ['pnpm', 'install', '--frozen-lockfile'], 'install');
  await command(
    snapshot.destination,
    ['pnpm', 'exec', 'playwright', 'install', 'chromium'],
    'browser-install',
  );
  await withRestoredServices(
    {
      stopOriginal: () => command(root, ['pnpm', 'services:stop'], 'original-services-stop'),
      startSnapshot: () =>
        command(snapshot.destination, ['pnpm', 'services:start'], 'snapshot-services-start'),
      stopSnapshot: async () => {
        try {
          await stopDevelopment();
        } finally {
          await command(snapshot.destination, ['pnpm', 'services:stop'], 'snapshot-services-stop');
        }
      },
      restoreOriginal: () => command(root, ['pnpm', 'services:start'], 'original-services-restore'),
      checkOriginal: () => command(root, ['pnpm', 'services:health'], 'original-health-restored'),
    },
    async () => {
      await command(snapshot.destination, ['pnpm', 'services:health'], 'snapshot-services-health');
      await command(snapshot.destination, ['pnpm', 'db:reset'], 'database-reset');
      await command(snapshot.destination, ['pnpm', 'seed'], 'database-seed');
      await command(snapshot.destination, ['pnpm', 'db:lint'], 'database-lint');
      for (const task of [
        'lint',
        'format:check',
        'typecheck',
        'test',
        'build',
        'extension:build',
        'secrets:check',
        'test:integration',
      ])
        await command(snapshot.destination, ['pnpm', task], task.replaceAll(':', '-'));
      development = launch(snapshot.destination, ['pnpm', 'dev'], 'development');
      await waitForDevelopment();
      await stopDevelopment();
      // Dev/build share Next output, so produce a fresh production artifact for browser tests.
      await command(snapshot.destination, ['pnpm', 'build'], 'build-after-dev');
      await command(snapshot.destination, ['pnpm', 'test:e2e'], 'e2e-and-demo-journeys');
      await command(snapshot.destination, ['pnpm', 'test:extension'], 'extension-browser');
      await command(snapshot.destination, ['pnpm', 'services:health'], 'final-snapshot-health');
    },
  );
} catch (error) {
  failure = error;
} finally {
  writeReport();
}
if (failure) {
  const errors = failure instanceof AggregateError ? failure.errors : [failure];
  for (const error of errors)
    process.stderr.write(`${error instanceof Error ? error.message : 'CLEANROOM_FAILED'}.\n`);
  process.stderr.write(
    `${failure instanceof Error ? failure.message : 'CLEANROOM_FAILED'}. Exact results: ${snapshot.evidence}/results.json.\n`,
  );
  process.exitCode = 1;
} else
  process.stdout.write(
    `Clean-room verification passed; original services restored. Evidence: ${snapshot.evidence}/results.json.\n`,
  );
