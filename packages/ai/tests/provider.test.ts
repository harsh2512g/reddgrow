import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAIProvider, MockAIProvider } from '../src/index.js';

describe('deterministic AI foundation', () => {
  it("validates structured fixture responses with the caller's schema", async () => {
    const provider = createAIProvider();
    const request = {
      task: 'health',
      input: 'check',
      schema: z.object({ status: z.literal('ready'), provider: z.literal('mock') }),
    };
    expect(await provider.generateStructured(request)).toEqual(
      await provider.generateStructured(request),
    );
    await expect(
      provider.generateStructured({ ...request, schema: z.object({ unsupported: z.string() }) }),
    ).rejects.toThrow();
  });

  it('does not fabricate output for an unregistered task', async () => {
    await expect(
      new MockAIProvider().generateStructured({
        task: 'unknown',
        input: 'check',
        schema: z.unknown(),
      }),
    ).rejects.toThrow('No synthetic fixture');
  });

  it('creates deterministic, normalized mock vectors and rejects invalid dimensions', async () => {
    const provider = createAIProvider();
    const vectors = await provider.embed({
      texts: ['first fixture', 'different fixture'],
      dimensions: 8,
    });
    expect(vectors).toEqual(
      await provider.embed({ texts: ['first fixture', 'different fixture'], dimensions: 8 }),
    );
    expect(vectors[0]).not.toEqual(vectors[1]);
    expect(Math.hypot(...(vectors[0] ?? []))).toBeCloseTo(1);
    await expect(provider.embed({ texts: ['fixture'], dimensions: 0 })).rejects.toThrow();
  });

  it('refuses an external provider instead of silently substituting a mock', () => {
    expect(() => createAIProvider('openai')).toThrow('configuration is incomplete or unsafe');
  });

  it('ranks matching words above unrelated content in the local searchable vectors', async () => {
    const vectors = await createAIProvider().embed({
      texts: [
        'private image storage',
        'Images use private storage and expire after twenty-four hours.',
        'Monthly pricing costs nineteen dollars and includes credits.',
      ],
      dimensions: 512,
    });
    const similarity = (left: number[], right: number[]) =>
      left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
    expect(similarity(vectors[0]!, vectors[1]!)).toBeGreaterThan(
      similarity(vectors[0]!, vectors[2]!),
    );
  });
});
