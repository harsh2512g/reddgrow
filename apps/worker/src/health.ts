import { HEARTBEAT_MAX_AGE_MS } from './jobs/heartbeat';

export type HealthCheck = 'up' | 'down';
export type WorkerReadiness = {
  status: 'ready' | 'not_ready';
  checks: { database: HealthCheck; redis: HealthCheck; heartbeat: HealthCheck };
};

export async function getWorkerReadiness(input: {
  database: () => Promise<unknown>;
  redis: () => Promise<unknown>;
  lastHeartbeatAt: number | null;
  now: number;
}): Promise<WorkerReadiness> {
  const results = await Promise.allSettled([input.database(), input.redis()]);
  const age = input.lastHeartbeatAt === null ? null : input.now - input.lastHeartbeatAt;
  const checks = {
    database: results[0].status === 'fulfilled' ? ('up' as const) : ('down' as const),
    redis: results[1].status === 'fulfilled' ? ('up' as const) : ('down' as const),
    heartbeat:
      age !== null && age >= 0 && age <= HEARTBEAT_MAX_AGE_MS ? ('up' as const) : ('down' as const),
  };
  return {
    status: Object.values(checks).every((check) => check === 'up') ? 'ready' : 'not_ready',
    checks,
  };
}
