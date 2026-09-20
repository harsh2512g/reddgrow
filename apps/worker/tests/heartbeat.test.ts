import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { makeHeartbeat, processHeartbeat } from '../src/jobs/heartbeat';

describe('foundation heartbeat', () => {
  it('uses a stable deduplication key and produces the same result on repeated delivery', () => {
    const first = makeHeartbeat(1_789_200_000);
    const second = makeHeartbeat(1_789_200_000);
    expect(first).toEqual(second);
    expect(first.id).not.toContain(':');
    expect(processHeartbeat('heartbeat', first.data)).toEqual(
      processHeartbeat('heartbeat', second.data),
    );
    expect(makeHeartbeat(1_789_200_001).id).not.toEqual(first.id);
  });

  it.each([
    ['send-message', { version: 1, tick: 10 }],
    ['heartbeat', { version: 1, tick: -1 }],
    ['heartbeat', { version: 2, tick: 10 }],
    ['heartbeat', { version: 1, tick: 1.2 }],
    ['heartbeat', { version: 1, tick: 10, token: 'unexpected' }],
  ])('rejects invalid work permanently: %s %j', (name, payload) => {
    expect(() => processHeartbeat(String(name), payload)).toThrow(UnrecoverableError);
  });
});
