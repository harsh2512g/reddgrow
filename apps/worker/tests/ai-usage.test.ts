import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAIProvider } from '@threadsignal/ai';
import { parseWorkerConfig } from '../src/config';
import { createWorkerAI, withWorkerAIUsage, withWorkerAIOperation } from '../src/providers';

const options = {
  apiKey: 'synthetic-api-value',
  fastModel: 'configured-fast',
  smartModel: 'configured-smart',
  embeddingModel: 'configured-embedding',
  maxRetries: 0,
};
function provider(transport: typeof fetch) {
  const config = parseWorkerConfig({
    DATABASE_URL: 'postgresql://postgres:synthetic-password@127.0.0.1:54322/postgres',
  });
  // No startup or connection occurs: use an injected, independently tested adapter.
  config.mode = 'deployment';
  config.providers = {
    ai: { mode: 'openai', options: { ...options, transport } },
    reddit: { mode: 'mock' },
    email: { mode: 'console' },
    crawler: 'fixture',
  };
  return createWorkerAI(config);
}
const generate = (ai: ReturnType<typeof createWorkerAI>, input: string) =>
  ai.generateStructured({
    task: 'draft.generate',
    input,
    schema: z.object({ answer: z.string() }),
  });
const completion = (tokens?: number) =>
  Response.json({
    choices: [
      {
        message: { content: JSON.stringify({ answer: 'Synthetic response' }) },
        finish_reason: 'stop',
      },
    ],
    ...(tokens === undefined ? {} : { usage: { prompt_tokens: tokens, completion_tokens: 3 } }),
  });

describe('honest per-job AI usage', () => {
  it('keeps deterministic mock usage zero without implying a paid request', async () => {
    const receipt = await withWorkerAIUsage(createAIProvider(), async (read) => read());
    expect(receipt).toEqual({
      provider: 'mock',
      model: 'deterministic',
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
    });
  });
  it('records reported model and token totals while leaving unknown prices null', async () => {
    const ai = provider(async () => completion(12));
    const receipt = await withWorkerAIUsage(ai, async (read) => {
      await generate(ai, 'first');
      await generate(ai, 'second');
      return read();
    });
    expect(receipt).toEqual({
      provider: 'openai',
      model: 'configured-smart',
      input_tokens: 24,
      output_tokens: 6,
      estimated_cost_usd: null,
    });
  });
  it('represents missing upstream usage as unknown rather than zero', async () => {
    const ai = provider(async () => completion());
    expect(
      await withWorkerAIUsage(ai, async (read) => {
        await generate(ai, 'first');
        return read();
      }),
    ).toEqual({
      provider: 'openai',
      model: 'configured-smart',
      input_tokens: null,
      output_tokens: null,
      estimated_cost_usd: null,
    });
  });
  it('keeps concurrent job receipts independent on one shared provider', async () => {
    const ai = provider(async (_url, init) => {
      const isFirst = String(init?.body).includes('first');
      await new Promise((resolve) => setTimeout(resolve, isFirst ? 5 : 1));
      return completion(isFirst ? 11 : 29);
    });
    const [first, second] = await Promise.all(
      ['first', 'second'].map((input) =>
        withWorkerAIUsage(ai, async (read) => {
          await generate(ai, input);
          return read();
        }),
      ),
    );
    expect(first?.input_tokens).toBe(11);
    expect(second?.input_tokens).toBe(29);
  });
  it('does not label partial known usage as complete totals when another call omits usage', async () => {
    let calls = 0;
    const ai = provider(async () => completion(++calls === 1 ? 12 : undefined));
    const receipt = await withWorkerAIUsage(ai, async (read) => {
      await generate(ai, 'first');
      await generate(ai, 'second');
      return read();
    });
    expect(receipt).toMatchObject({
      model: 'configured-smart',
      input_tokens: null,
      output_tokens: null,
      estimated_cost_usd: null,
    });
  });
});

describe('general worker task receipt publication', () => {
  const scope = () => ({
    organizationId: randomUUID(),
    brandId: randomUUID(),
    operationId: randomUUID(),
    task: 'opportunity.evaluate' as const,
  });
  function database() {
    const query = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      void parts;
      void values;
      return [];
    });
    // This fixture implements only the tagged statement/json boundary under test.
    const sql = Object.assign(query, { json: (value: unknown) => value }) as unknown as Sql;
    return { sql, query };
  }
  it('persists scoped actual receipts once for a successful attempt', async () => {
    const { sql, query } = database();
    const operation = scope();
    const ai = provider(async () => completion(19));
    await withWorkerAIOperation(sql, operation, ai, (tracked) => generate(tracked, 'first'));
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.slice(1)).toEqual([
      operation.organizationId,
      operation.brandId,
      operation.operationId,
      operation.task,
      {
        provider: 'openai',
        model: 'configured-smart',
        input_tokens: 19,
        output_tokens: 3,
        estimated_cost_usd: null,
      },
    ]);
  });
  it('preserves reported usage when downstream processing fails', async () => {
    const { sql, query } = database();
    const ai = provider(async () => completion(17));
    const failure = new Error('synthetic downstream failure');
    await expect(
      withWorkerAIOperation(sql, scope(), ai, async (tracked) => {
        await generate(tracked, 'first');
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.at(-1)).toMatchObject({
      input_tokens: 17,
      output_tokens: 3,
      estimated_cost_usd: null,
    });
  });
  it('records unknown totals when an attempted real request fails without a receipt', async () => {
    const { sql, query } = database();
    const ai = provider(async () => {
      throw new Error('synthetic unavailable transport');
    });
    await expect(
      withWorkerAIOperation(sql, scope(), ai, (tracked) => generate(tracked, 'first')),
    ).rejects.toThrow();
    expect(query.mock.calls[0]?.at(-1)).toMatchObject({
      input_tokens: null,
      output_tokens: null,
      estimated_cost_usd: null,
    });
  });
  it('does not invent a request or usage row for cached/filtered operations', async () => {
    const { sql, query } = database();
    const ai = provider(async () => completion(99));
    expect(await withWorkerAIOperation(sql, scope(), ai, async () => 'cached')).toBe('cached');
    expect(query).not.toHaveBeenCalled();
  });
});
