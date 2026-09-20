import { describe, expect, it, vi } from 'vitest';
import { createMetrics } from '../src/index.js';

describe('operational metric boundary', () => {
  const metric = {
    provider: 'reddit',
    operation: 'list_posts',
    outcome: 'success',
    durationMs: 12,
  };
  it('records only the allowlisted operational dimensions', () => {
    const record = vi.fn();
    createMetrics({ record }).recordProvider({
      ...metric,
      body: 'private fixture',
      email: 'fixture@example.com',
    });
    expect(record).toHaveBeenCalledWith(metric);
  });
  it('requires no sink and rejects invalid measurements', () => {
    expect(() => createMetrics().recordProvider(metric)).not.toThrow();
    expect(() => createMetrics().recordProvider({ ...metric, durationMs: -1 })).toThrow();
  });
  it('does not propagate sink outages', () => {
    expect(() =>
      createMetrics({
        record() {
          throw new Error('offline');
        },
      }).recordProvider(metric),
    ).not.toThrow();
  });
});
