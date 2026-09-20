import { describe, expect, it, vi } from 'vitest';
import { getOperationMetrics, measuredProviderRequest } from '../src/index.js';

describe('provider transport telemetry', () => {
  it('measures each request and preserves the exact unread response', async () => {
    const response = new Response('private provider body');
    const record = vi.fn();
    const request = vi.fn().mockResolvedValue(response);
    const observed = await measuredProviderRequest('ai', request, { record });
    expect(observed).toBe(response);
    expect(response.bodyUsed).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith({
      operation: 'provider.ai.headers',
      durationMs: expect.any(Number),
      success: true,
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain('private');
  });
  it('counts HTTP and transport failures while preserving outcomes for existing retry logic', async () => {
    const record = vi.fn();
    const response = new Response('private', { status: 429 });
    expect(await measuredProviderRequest('reddit', async () => response, { record })).toBe(
      response,
    );
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ success: false }));
    const original = new Error('private provider exception');
    await expect(
      measuredProviderRequest(
        'stripe',
        async () => {
          throw original;
        },
        { record },
      ),
    ).rejects.toBe(original);
    expect(record).toHaveBeenLastCalledWith(
      expect.objectContaining({ operation: 'provider.stripe.headers', success: false }),
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain('private');
  });
  it('absorbs broken sync/async sinks and records a safe default process snapshot', async () => {
    const response = new Response('ok');
    for (const record of [
      () => {
        throw new Error('sink');
      },
      async () => {
        throw new Error('sink');
      },
    ]) {
      expect(await measuredProviderRequest('resend', async () => response, { record })).toBe(
        response,
      );
    }
    await measuredProviderRequest('resend', async () => response);
    expect(getOperationMetrics()).toContainEqual(
      expect.objectContaining({ operation: 'provider.resend.headers', count: 1, failed: 0 }),
    );
  });
});
