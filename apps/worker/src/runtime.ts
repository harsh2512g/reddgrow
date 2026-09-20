import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createLogger, createObservability } from '@threadsignal/shared';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import type { WorkerConfig } from './config';
import { startKnowledgeWorker } from './jobs/knowledge';
import { startRedditWorker } from './jobs/reddit';
import { startDraftWorker } from './jobs/drafts';
import { startExtensionCleanup } from './jobs/extension-cleanup';
import { startAnalyticsWorker } from './jobs/analytics';
import { startNotificationWorker } from './jobs/notifications';
import { startPrivacyWorker } from './jobs/privacy';
import { getWorkerReadiness } from './health';
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_QUEUE,
  makeHeartbeat,
  processHeartbeat,
  type HeartbeatPayload,
  type HeartbeatResult,
} from './jobs/heartbeat';

export async function startWorker(config: WorkerConfig) {
  const logger = createLogger({ service: 'worker', level: config.logLevel });
  const observability = createObservability({});
  const redis = new Redis({
    ...config.redis,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    commandTimeout: 2_000,
    retryStrategy: (attempt) => (attempt <= 3 ? Math.min(attempt * 250, 1_000) : null),
  });
  const sql = postgres({
    ...config.database,
    max: 4,
    connect_timeout: config.mode === 'local' ? 2 : 10,
    idle_timeout: 5,
    connection: {
      statement_timeout: 10_000,
      application_name: `threadsignal-${config.mode}-worker`,
    },
    onnotice: () => undefined,
  });
  redis.on('error', () =>
    logger.warn({ event: 'redis_error' }, 'Local Redis connection unavailable.'),
  );

  let queue: Queue<HeartbeatPayload, HeartbeatResult, 'heartbeat'> | undefined;
  let worker: Worker<HeartbeatPayload, HeartbeatResult, 'heartbeat'> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastHeartbeatAt: number | null = null;
  let stopping: Promise<void> | undefined;
  let knowledge: Awaited<ReturnType<typeof startKnowledgeWorker>> | undefined;
  let reddit: Awaited<ReturnType<typeof startRedditWorker>> | undefined;
  let drafts: Awaited<ReturnType<typeof startDraftWorker>> | undefined;
  let analytics: Awaited<ReturnType<typeof startAnalyticsWorker>> | undefined;
  let notifications: Awaited<ReturnType<typeof startNotificationWorker>> | undefined;
  let privacy: Awaited<ReturnType<typeof startPrivacyWorker>> | undefined;
  let extensionCleanup: Awaited<ReturnType<typeof startExtensionCleanup>> | undefined;

  const server = createServer((request, response) => {
    const requestId = randomUUID();
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Request-Id', requestId);
    if (request.method !== 'GET') {
      response
        .writeHead(405, { Allow: 'GET' })
        .end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }
    if (request.url === '/api/health') {
      response.writeHead(200).end(JSON.stringify({ status: 'ok', service: 'worker' }));
      return;
    }
    if (request.url !== '/api/health/ready') {
      response.writeHead(404).end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    void readiness().then(
      (health) => {
        response.writeHead(health.status === 'ready' ? 200 : 503).end(JSON.stringify(health));
      },
      () => {
        logger.error({ event: 'health_check_failed', requestId }, 'Worker readiness check failed.');
        response.writeHead(503).end(JSON.stringify({ status: 'not_ready' }));
      },
    );
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;

  const readiness = async () => {
    const health = await getWorkerReadiness({
      database: () => sql`select 1 as healthy`,
      redis: () => redis.ping(),
      lastHeartbeatAt,
      now: Date.now(),
    });
    if (config.storage.mode === 'personal-development') {
      const knowledgeReady = knowledge?.isReady() ?? false;
      return {
        ...health,
        status:
          health.status === 'ready' && knowledgeReady ? ('ready' as const) : ('not_ready' as const),
        checks: {
          ...health.checks,
          knowledge: knowledgeReady ? ('up' as const) : ('down' as const),
        },
        mode: config.mode,
        projectRef: config.storage.projectRef,
        queuePrefix: config.queuePrefix,
      };
    }
    const knowledgeReady = knowledge?.isReady() ?? false;
    const privacyReady = privacy?.isReady() ?? false;
    const redditReady = reddit?.isReady() ?? false;
    const draftsReady = drafts?.isReady() ?? false;
    const analyticsReady = analytics?.isReady() ?? false;
    const notificationsReady = notifications?.isReady() ?? false;
    return {
      ...health,
      status:
        health.status === 'ready' &&
        knowledgeReady &&
        privacyReady &&
        redditReady &&
        draftsReady &&
        analyticsReady &&
        notificationsReady
          ? ('ready' as const)
          : ('not_ready' as const),
      checks: {
        ...health.checks,
        knowledge: knowledgeReady ? ('up' as const) : ('down' as const),
        privacy: privacyReady ? ('up' as const) : ('down' as const),
        opportunities: redditReady ? ('up' as const) : ('down' as const),
        drafts: draftsReady ? ('up' as const) : ('down' as const),
        analytics: analyticsReady ? ('up' as const) : ('down' as const),
        notifications: notificationsReady ? ('up' as const) : ('down' as const),
      },
    };
  };

  const stop = (force = false) => {
    if (stopping) return stopping;
    stopping = (async () => {
      if (timer) clearInterval(timer);
      if (server.listening) {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeIdleConnections();
        });
      }
      redis.disconnect();
      await knowledge?.stop(force);
      await reddit?.stop(force);
      await drafts?.stop(force);
      await extensionCleanup?.stop(force);
      await analytics?.stop(force);
      await notifications?.stop(force);
      await privacy?.stop(force);
      const stopped = await Promise.allSettled([
        worker?.close(force),
        queue?.close(),
        sql.end({ timeout: 3 }),
      ]);
      if (stopped.some((result) => result.status === 'rejected')) {
        logger.warn({ event: 'worker_cleanup_failed' }, 'A worker resource did not close cleanly.');
        throw new Error('Worker cleanup failed.');
      }
      logger.info({ event: 'worker_stopped' }, 'ThreadSignal worker stopped.');
    })();
    return stopping;
  };

  try {
    await redis.connect();
    await sql`select 1 as healthy`;
    knowledge = await startKnowledgeWorker(sql, config);
    if (config.mode === 'local') reddit = await startRedditWorker(sql, config);
    if (config.mode === 'local') drafts = await startDraftWorker(sql, config);
    if (config.mode === 'local') extensionCleanup = await startExtensionCleanup(sql, config);
    if (config.mode === 'local') analytics = await startAnalyticsWorker(sql, config);
    if (config.mode === 'local') notifications = await startNotificationWorker(sql, config);
    if (config.mode === 'local') privacy = await startPrivacyWorker(sql, config);
    const connection = { ...config.redis, maxRetriesPerRequest: null, connectTimeout: 2_000 };
    queue = new Queue<HeartbeatPayload, HeartbeatResult, 'heartbeat'>(HEARTBEAT_QUEUE, {
      connection,
      prefix: config.queuePrefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { age: 60, count: 100 },
        removeOnFail: { age: 86_400, count: 100 },
      },
    });
    worker = new Worker<HeartbeatPayload, HeartbeatResult, 'heartbeat'>(
      HEARTBEAT_QUEUE,
      async (job) =>
        observability.run('worker.heartbeat', { jobId: job.id ?? 'unassigned' }, async () => {
          const result = processHeartbeat(job.name, job.data);
          lastHeartbeatAt = Date.now();
          logger.debug(
            { event: 'job_completed', jobId: job.id },
            'Foundation heartbeat processed.',
          );
          return result;
        }),
      { connection, prefix: config.queuePrefix, concurrency: 1 },
    );
    queue.on('error', () => logger.error({ event: 'queue_error' }, 'Heartbeat queue unavailable.'));
    worker.on('error', () =>
      logger.error({ event: 'worker_error' }, 'Heartbeat processor unavailable.'),
    );
    worker.on('failed', (job) => {
      logger.warn(
        { event: 'job_failed', jobId: job?.id, attempt: job?.attemptsMade },
        'Foundation heartbeat failed; bounded retries apply.',
      );
    });
    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
    const enqueue = async () => {
      const heartbeat = makeHeartbeat(Math.floor(Date.now() / 1_000));
      await queue?.add('heartbeat', heartbeat.data, { jobId: heartbeat.id });
    };
    await enqueue();
    timer = setInterval(() => {
      void enqueue().catch(() => {
        logger.warn({ event: 'heartbeat_enqueue_failed' }, 'Could not enqueue the next heartbeat.');
      });
    }, HEARTBEAT_INTERVAL_MS);

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', () =>
      logger.error({ event: 'health_server_error' }, 'Worker health server failed.'),
    );
    logger.info({ event: 'worker_started', port: config.port }, 'ThreadSignal worker started.');
    return { stop, readiness };
  } catch (error) {
    await stop(true);
    throw error;
  }
}
