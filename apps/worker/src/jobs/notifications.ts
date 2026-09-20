import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { createLogger, createObservability } from '@threadsignal/shared';
import { createEmailProvider, renderNotification, type EmailProvider } from '@threadsignal/email';
import type { WorkerConfig } from '../config';

const payloadSchema = z.object({
  count: z.number().int().nonnegative().optional(),
  score: z.number().min(0).max(100).optional(),
  opportunity_id: z.uuid().optional(),
  source_id: z.uuid().optional(),
  plan_key: z.enum(['trial', 'solo', 'growth']).optional(),
  metric: z.string().max(60).optional(),
});
const deliverySchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  user_id: z.uuid(),
  type: z.enum([
    'welcome',
    'invitation',
    'ingestion_complete',
    'ingestion_failed',
    'daily_digest',
    'high_score_alert',
    'trial_ending',
    'usage_limit',
    'payment_failed',
    'subscription_changed',
  ]),
  recipient: z.email(),
  organization_name: z.string().min(1).max(120),
  payload: payloadSchema,
  attempt: z.number().int().min(1).max(3),
});

/** SQL owns eligibility, leases, and retries. Queue data contains only a durable delivery ID. */
export async function processNotification(sql: Sql, id: string, provider: EmailProvider) {
  z.uuid().parse(id);
  const lease = randomUUID();
  const [row] = await sql`select private.claim_notification(${id}::uuid,${lease}::uuid) as value`;
  if (!row?.value) return { processed: false };
  try {
    const delivery = deliverySchema.parse(row.value);
    const template = renderNotification({
      category: delivery.type,
      organizationName: delivery.organization_name,
      appUrl: 'http://127.0.0.1:3000',
      ...(delivery.payload.count !== undefined ? { count: delivery.payload.count } : {}),
      ...(delivery.payload.score !== undefined ? { score: delivery.payload.score } : {}),
      actionPath:
        delivery.type === 'daily_digest' || delivery.type === 'high_score_alert'
          ? '/app/opportunities'
          : delivery.type.startsWith('ingestion_')
            ? '/app/knowledge'
            : ['trial_ending', 'usage_limit', 'payment_failed', 'subscription_changed'].includes(
                  delivery.type,
                )
              ? '/app/settings/billing'
              : delivery.type === 'invitation'
                ? '/app/settings/team'
                : '/app',
    });
    const receipt = await provider.send({
      to: delivery.recipient,
      ...template,
      idempotencyKey: `notification_${id}`,
    });
    const [result] = await sql`select private.finish_notification(${id}::uuid,${lease}::uuid,
      ${receipt.delivery === 'suppressed' ? 'suppressed' : 'sent'},${provider.mode},${receipt.id},null) as value`;
    if (result?.value !== true) throw new Error('NOTIFICATION_LEASE_LOST');
    return { processed: true, delivery: receipt.delivery };
  } catch {
    // No upstream error or payload is retained: it may contain recipients or message contents.
    await sql`select private.finish_notification(${id}::uuid,${lease}::uuid,'retry',${provider.mode},null,'NOTIFICATION_DELIVERY_FAILED')`;
    return { processed: false, retry: true };
  }
}

export async function startNotificationWorker(sql: Sql, config: WorkerConfig) {
  if (config.mode !== 'local') throw new Error('Verified Supabase development runtime required.');
  const logger = createLogger({ service: 'notifications', level: config.logLevel });
  const observability = createObservability({});
  const provider = createEmailProvider('console', logger);
  const connection = { ...config.redis, maxRetriesPerRequest: null, connectTimeout: 2000 };
  const queue = new Queue('notifications', {
    connection,
    prefix: config.queuePrefix,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 3600, count: 100 },
      removeOnFail: { age: 86400, count: 100 },
    },
  });
  let healthy = false,
    dispatching = false,
    stopped = false;
  const worker = new Worker(
    'notifications',
    async (job) => {
      if (job.name !== 'deliver') throw new Error('Invalid notification job.');
      const { id } = z.object({ id: z.uuid() }).strict().parse(job.data);
      return observability.run(
        'worker.notification',
        { jobId: job.id ?? 'unassigned' },
        async () => {
          const result = await processNotification(sql, id, provider);
          logger.info(
            { event: 'notification_processed', jobId: job.id, ...result },
            'Notification delivery attempt completed.',
          );
          return result;
        },
      );
    },
    { connection, prefix: config.queuePrefix, concurrency: 2 },
  );
  const queueError = () => {
    healthy = false;
    logger.warn({ event: 'notification_queue_error' }, 'Notification queue is unavailable.');
  };
  queue.on('error', queueError);
  worker.on('error', queueError);
  worker.on('failed', (job) =>
    logger.warn(
      { event: 'notification_job_failed', jobId: job?.id, attempt: job?.attemptsMade },
      'Notification job failed; bounded retries apply.',
    ),
  );
  const dispatch = async () => {
    if (dispatching || stopped) return;
    dispatching = true;
    try {
      await sql`select private.maintain_billing_periods(100)`;
      await sql`select private.schedule_notifications(100)`;
      const rows = z
        .array(
          z.object({
            id: z.uuid(),
            attempts: z.number().int().min(0).max(3),
            available_at: z.coerce.date(),
          }),
        )
        .parse(
          await sql`select id,attempts,available_at from public.notification_deliveries where status='queued' and available_at<=now() order by available_at,id limit 100`,
        );
      for (const row of rows)
        await queue.add(
          'deliver',
          { id: row.id },
          { jobId: `${row.id}-${row.attempts}-${row.available_at.getTime()}` },
        );
      healthy = true;
    } finally {
      dispatching = false;
    }
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = async (force = false) => {
    stopped = true;
    if (timer) clearInterval(timer);
    await worker.close(force);
    await queue.close();
  };
  try {
    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
    await dispatch();
    timer = setInterval(
      () =>
        void dispatch().catch(() => {
          healthy = false;
          logger.warn(
            { event: 'notification_dispatch_failed' },
            'Notification scheduling is unavailable.',
          );
        }),
      10000,
    );
    return { stop, isReady: () => healthy };
  } catch (error) {
    await stop(true);
    throw error;
  }
}
