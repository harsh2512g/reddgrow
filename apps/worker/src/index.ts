import { createLogger } from '@threadsignal/shared';
import { parseWorkerConfig, WORKER_ENVIRONMENT_KEYS } from './config';
import { startWorker } from './runtime';

const logger = createLogger({ service: 'worker' });

try {
  if (
    process.env.THREADSIGNAL_WORKER_MODE !== 'deployment' &&
    process.env.THREADSIGNAL_LOCAL !== '1'
  ) {
    throw new Error('The isolated ThreadSignal runner is required.');
  }
  const input = Object.fromEntries(WORKER_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
  const worker = await startWorker(parseWorkerConfig(input));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      logger.error({ event: 'shutdown_timeout' }, 'Worker shutdown exceeded its deadline.');
      process.exit(1);
    }, 10_000);
    deadline.unref();
    void worker.stop().then(
      () => clearTimeout(deadline),
      () => {
        logger.error({ event: 'shutdown_failed' }, 'Worker shutdown failed.');
        process.exitCode = 1;
      },
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch {
  logger.error(
    { event: 'worker_start_failed' },
    'Worker startup failed; check the explicitly selected runtime profile and service configuration.',
  );
  process.exitCode = 1;
}
