import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_MAX_AGE_MS = 30_000;
export const HEARTBEAT_QUEUE = 'foundation-heartbeat';
export const QUEUE_PREFIX = 'threadsignal-foundation';

const heartbeatSchema = z
  .object({ version: z.literal(1), tick: z.number().int().nonnegative() })
  .strict();
export type HeartbeatPayload = z.infer<typeof heartbeatSchema>;
export type HeartbeatResult = HeartbeatPayload;

export function makeHeartbeat(tick: number): { id: string; data: HeartbeatPayload } {
  const data = heartbeatSchema.parse({ version: 1, tick });
  return { id: `heartbeat-${data.tick}`, data };
}

export function processHeartbeat(name: string, payload: unknown): HeartbeatResult {
  const parsed = heartbeatSchema.safeParse(payload);
  if (name !== 'heartbeat' || !parsed.success) {
    // Reject malformed jobs permanently; retries cannot repair an invalid payload.
    throw new UnrecoverableError('Invalid foundation heartbeat job.');
  }
  // Repeated delivery has the same result and does not mutate customer data.
  return parsed.data;
}
