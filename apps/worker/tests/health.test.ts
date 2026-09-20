import { describe, expect, it } from 'vitest';
import { getWorkerReadiness } from '../src/health';

const healthy = () => Promise.resolve('ok');

describe('worker readiness', () => {
  it('requires a working database, Redis and recently processed queue heartbeat', async () => {
    expect(
      await getWorkerReadiness({
        database: healthy,
        redis: healthy,
        lastHeartbeatAt: 1_000,
        now: 2_000,
      }),
    ).toEqual({
      status: 'ready',
      checks: { database: 'up', redis: 'up', heartbeat: 'up' },
    });
  });

  it.each([null, 0, 100_001])(
    'rejects missing, stale or future heartbeats: %s',
    async (lastHeartbeatAt) => {
      const result = await getWorkerReadiness({
        database: healthy,
        redis: healthy,
        lastHeartbeatAt,
        now: 100_000,
      });
      expect(result.status).toBe('not_ready');
      expect(result.checks.heartbeat).toBe('down');
    },
  );

  it('degrades readiness when a dependency fails without exposing its error', async () => {
    const result = await getWorkerReadiness({
      database: () => Promise.reject(new Error('sensitive connection detail')),
      redis: healthy,
      lastHeartbeatAt: 1_000,
      now: 2_000,
    });
    expect(result).toEqual({
      status: 'not_ready',
      checks: { database: 'down', redis: 'up', heartbeat: 'up' },
    });
    expect(JSON.stringify(result)).not.toContain('sensitive');
  });
});
