import { describe, expect, it } from 'vitest';
import { redditPolicySchema } from '../src/config';
import { redditPayload } from '../src/jobs/reddit';

describe('Reddit worker retention configuration', () => {
  it('defaults to bounded thirty-day content retention', () => {
    expect(redditPolicySchema.parse({})).toEqual({ maxAgeDays: 30, retentionDays: 30 });
  });
  it('rejects unbounded retention and evaluation past the retention horizon', () => {
    for (const input of [
      { retentionDays: 0 },
      { retentionDays: 31 },
      { retentionDays: 7, maxAgeDays: 8 },
      { maxAgeDays: NaN },
    ])
      expect(redditPolicySchema.safeParse(input).success).toBe(false);
    expect(redditPolicySchema.parse({ maxAgeDays: '7', retentionDays: '14' })).toEqual({
      maxAgeDays: 7,
      retentionDays: 14,
    });
  });
  it('queues identifiers only', () => {
    expect(
      redditPayload.safeParse({
        jobId: '0a31d8d9-67fd-49f8-a15f-0c3a6c0aaab1',
        credential: 'disallowed',
      }).success,
    ).toBe(false);
  });
});
