import { Queue, Worker } from 'bullmq';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { createLogger } from '@threadsignal/shared';
import type { WorkerConfig } from '../config';
const interval = 60_000;
export async function startAnalyticsWorker(sql: Sql, config: WorkerConfig) {
  if (config.mode !== 'local' && config.mode !== 'deployment')
    throw new Error('Verified Supabase development runtime required.');
  const logger = createLogger({ service: 'aggregate-analytics', level: config.logLevel });
  const connection = { ...config.redis, maxRetriesPerRequest: null, connectTimeout: 2000 };
  const queue = new Queue('aggregate-analytics', {
    connection,
    prefix: config.queuePrefix,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 3600, count: 60 },
      removeOnFail: { age: 86400, count: 100 },
    },
  });
  let healthy = false;
  const worker = new Worker(
    'aggregate-analytics',
    async (job) => {
      z.object({}).strict().parse(job.data);
      if (job.name !== 'aggregate') throw new Error('Invalid analytics job.');
      const [row] = await sql`select private.refresh_attribution_analytics(5) as count`;
      const count = z.number().int().min(0).max(5).parse(row?.count);
      healthy = true;
      logger.info(
        { event: 'analytics_aggregated', jobId: job.id, organizations: count },
        'Supabase analytics aggregates refreshed.',
      );
      return { organizations: count };
    },
    { connection, prefix: config.queuePrefix, concurrency: 1 },
  );
  queue.on('error', () => {
    healthy = false;
    logger.warn({ event: 'analytics_queue_error' }, 'Analytics queue is unavailable.');
  });
  worker.on('error', () => {
    healthy = false;
    logger.warn({ event: 'analytics_worker_error' }, 'Analytics worker is unavailable.');
  });
  worker.on('failed', (job) => {
    healthy = false;
    logger.warn(
      { event: 'analytics_job_failed', jobId: job?.id, attempt: job?.attemptsMade },
      'Analytics aggregation failed; bounded retries apply.',
    );
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = async (force = false) => {
    if (timer) clearInterval(timer);
    await worker.close(force);
    await queue.close();
  };
  try {
    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
    const enqueue = () =>
      queue.add('aggregate', {}, { jobId: `minute-${Math.floor(Date.now() / interval)}` });
    await enqueue();
    healthy = true;
    timer = setInterval(
      () =>
        void enqueue().catch(() => {
          healthy = false;
          logger.warn(
            { event: 'analytics_enqueue_failed' },
            'Analytics refresh could not be scheduled.',
          );
        }),
      interval,
    );
    return { stop, isReady: () => healthy };
  } catch (error) {
    await stop(true);
    throw error;
  }
}
