import { Queue, Worker } from 'bullmq';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { createLogger } from '@threadsignal/shared';
import type { WorkerConfig } from '../config';
export const EXTENSION_CLEANUP_QUEUE = 'cleanup-expired-extension-sessions';
export async function startExtensionCleanup(sql: Sql, config: WorkerConfig) {
  if (config.mode !== 'local') throw new Error('Extension cleanup requires local development.');
  const logger = createLogger({ service: 'extension-cleanup', level: config.logLevel });
  const connection = { ...config.redis, maxRetriesPerRequest: null, connectTimeout: 2000 };
  const queue = new Queue(EXTENSION_CLEANUP_QUEUE, {
    connection,
    prefix: config.queuePrefix,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 3600, count: 24 },
      removeOnFail: { age: 86400, count: 24 },
    },
  });
  const worker = new Worker(
    EXTENSION_CLEANUP_QUEUE,
    async (job) => {
      z.object({}).strict().parse(job.data);
      if (job.name !== 'cleanup') throw new Error('Unknown cleanup operation.');
      const [row] = await sql`select private.cleanup_expired_extension_sessions() as result`;
      const counts = z
        .object({
          codes_deleted: z.number().int().nonnegative(),
          sessions_deleted: z.number().int().nonnegative(),
        })
        .parse(row?.result);
      logger.info(
        { event: 'extension_cleanup_completed', ...counts },
        'Expired extension credentials removed.',
      );
      return counts;
    },
    { connection, prefix: config.queuePrefix, concurrency: 1 },
  );
  const reportError = () =>
    logger.warn({ event: 'extension_cleanup_error' }, 'Extension cleanup is unavailable.');
  queue.on('error', reportError);
  worker.on('error', reportError);
  worker.on('failed', () =>
    logger.warn(
      { event: 'extension_cleanup_failed' },
      'Extension cleanup failed; bounded retries apply.',
    ),
  );
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = async (force = false) => {
    if (timer) clearInterval(timer);
    await worker.close(force);
    await queue.close();
  };
  try {
    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
    const enqueue = () =>
      queue.add('cleanup', {}, { jobId: `hour-${Math.floor(Date.now() / 3600000)}` });
    await enqueue();
    timer = setInterval(() => {
      void enqueue().catch(() =>
        logger.warn(
          { event: 'extension_cleanup_enqueue_failed' },
          'Extension cleanup could not be queued.',
        ),
      );
    }, 3600000);
    return { stop };
  } catch (error) {
    await stop(true);
    throw error;
  }
}
