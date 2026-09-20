import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createAIProvider,
  OpenAICompatibleProvider,
  AIProviderError,
  type OpenAIProviderOptions,
  type AIUsage,
} from '../src/index.js';
const structured = z.object({ answer: z.string() });
const request = { task: 'draft.generate', input: 'Untrusted fixture context.', schema: structured };
const success = (value: unknown = { answer: 'Useful answer.' }) =>
  new Response(
    JSON.stringify({
      choices: [
        { message: { content: JSON.stringify(value), refusal: null }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
    { status: 200 },
  );
const options = (
  transport: typeof fetch,
  patch: Partial<OpenAIProviderOptions> = {},
): OpenAIProviderOptions => ({
  apiKey: 'synthetic-adapter-fixture',
  fastModel: 'configured-fast',
  smartModel: 'configured-smart',
  embeddingModel: 'configured-embedding',
  transport,
  sleep: async () => {},
  ...patch,
});

describe('explicit OpenAI-compatible adapter with intercepted transport', () => {
  it('keeps the default mock and never reads environment credentials or enables implicit network', () => {
    expect(createAIProvider().mode).toBe('mock');
    expect(
      () =>
        new OpenAICompatibleProvider({
          apiKey: 'synthetic-fixture',
          fastModel: 'a',
          smartModel: 'b',
          embeddingModel: 'c',
        }),
    ).toThrow('configuration');
  });
  it('sends configured model, strict schema, bounded tokens and separate trusted instructions; returns schema-validated output with actual usage', async () => {
    const usage: AIUsage[] = [];
    let captured: RequestInit | undefined;
    const transport: typeof fetch = async (_url, init) => {
      captured = init;
      return success();
    };
    const provider = createAIProvider(
      'openai',
      options(transport, {
        onUsage: (item) => usage.push(item),
        modelCosts: { 'configured-smart': { inputPerMillion: 2, outputPerMillion: 4 } },
      }),
    );
    expect(await provider.generateStructured(request)).toEqual({
      value: { answer: 'Useful answer.' },
      provider: 'openai:configured-smart',
    });
    const payload = JSON.parse(String(captured?.body)) as {
      model: string;
      store: boolean;
      max_completion_tokens: number;
      messages: { role: string; content: string }[];
      response_format: {
        json_schema: { strict: boolean; schema: { additionalProperties: boolean } };
      };
    };
    expect(payload.model).toBe('configured-smart');
    expect(payload.store).toBe(false);
    expect(payload.max_completion_tokens).toBe(6000);
    expect(payload.messages[0]?.content).toContain('untrusted');
    expect(payload.messages[0]?.content).not.toContain(request.input);
    expect(payload.messages[1]?.content).toContain(request.input);
    expect(payload.response_format.json_schema.strict).toBe(true);
    expect(payload.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(captured?.redirect).toBe('error');
    expect(usage[0]).toMatchObject({
      task: 'draft.generate',
      model: 'configured-smart',
      input_tokens: 100,
      output_tokens: 50,
      estimated_cost_usd: 0.0004,
    });
  });
  it('translates optional output keys into strict nullable wire fields while retaining required nullable data', async () => {
    let wire: unknown;
    const transport: typeof fetch = async (_url, init) => {
      wire = JSON.parse(String(init?.body));
      return success({ answer: 'safe', detail: null, source: null });
    };
    const ai = new OpenAICompatibleProvider(options(transport));
    const result = await ai.generateStructured({
      ...request,
      schema: z.object({
        answer: z.string(),
        detail: z.string().optional(),
        source: z.string().nullable(),
      }),
    });
    expect(result.value).toEqual({ answer: 'safe', source: null });
    expect(wire).toMatchObject({
      response_format: {
        json_schema: {
          schema: {
            required: ['answer', 'detail', 'source'],
            properties: { detail: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
          },
        },
      },
    });
  });
  it('uses fast classification and independently scoped verification/compliance prompts', async () => {
    const models: string[] = [];
    const prompts: string[] = [];
    const transport: typeof fetch = async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        model: string;
        messages: { content: string }[];
      };
      models.push(payload.model);
      prompts.push(payload.messages[0]!.content);
      return success();
    };
    const ai = new OpenAICompatibleProvider(options(transport));
    for (const task of ['draft.extract', 'draft.verify', 'draft.compliance'])
      await ai.generateStructured({ ...request, task });
    expect(models).toEqual(['configured-fast', 'configured-smart', 'configured-fast']);
    expect(new Set(prompts).size).toBe(3);
  });
  it('retries transient responses at most twice and opens the circuit after repeated failed tasks', async () => {
    let calls = 0;
    let now = 0;
    const ai = new OpenAICompatibleProvider(
      options(
        async () => {
          calls++;
          return new Response('private-provider-error', { status: 503 });
        },
        { now: () => now, circuitThreshold: 2, circuitCooldownMs: 1000 },
      ),
    );
    await expect(ai.generateStructured(request)).rejects.toThrow('temporarily unavailable');
    expect(calls).toBe(3);
    await expect(ai.generateStructured(request)).rejects.toThrow('temporarily unavailable');
    expect(calls).toBe(6);
    await expect(ai.generateStructured(request)).rejects.toThrow('paused');
    expect(calls).toBe(6);
    now = 1001;
    await expect(ai.generateStructured(request)).rejects.toThrow('temporarily unavailable');
    expect(calls).toBe(9);
  });
  it('does not retry authentication errors or leak provider bodies and credential text', async () => {
    const transport = vi.fn<typeof fetch>(
      async () => new Response('secret-and-provider-stack', { status: 401 }),
    );
    const ai = new OpenAICompatibleProvider(options(transport));
    let caught: unknown;
    try {
      await ai.generateStructured(request);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AIProviderError);
    expect(String(caught)).not.toMatch(/secret-and-provider-stack|synthetic-adapter-fixture/);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('persists Retry-After and refuses another request until the deadline without runaway sleeping', async () => {
    let now = 0;
    let calls = 0;
    const ai = new OpenAICompatibleProvider(
      options(
        async () => {
          calls++;
          return calls === 1
            ? new Response('rate limit', { status: 429, headers: { 'Retry-After': '15' } })
            : success();
        },
        { now: () => now },
      ),
    );
    await expect(ai.generateStructured(request)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterMs: 15000,
    });
    await expect(ai.generateStructured(request)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(calls).toBe(1);
    now = 15001;
    await expect(ai.generateStructured(request)).resolves.toMatchObject({
      value: { answer: 'Useful answer.' },
    });
    expect(calls).toBe(2);
  });
  it('honors exhausted rate-limit response headers on a successful request', async () => {
    let now = 0;
    let calls = 0;
    const transport: typeof fetch = async () => {
      calls++;
      const response = success();
      response.headers.set('x-ratelimit-remaining-requests', '0');
      response.headers.set('x-ratelimit-reset-requests', '2s');
      return response;
    };
    const ai = new OpenAICompatibleProvider(options(transport, { now: () => now }));
    await ai.generateStructured(request);
    await expect(ai.generateStructured(request)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterMs: 2000,
    });
    expect(calls).toBe(1);
    now = 2001;
    await ai.generateStructured(request);
    expect(calls).toBe(2);
  });
  it('opens the circuit when successful HTTP responses repeatedly violate the output schema', async () => {
    const transport = vi.fn<typeof fetch>(async () => success({ invalid: true }));
    const ai = new OpenAICompatibleProvider(options(transport, { circuitThreshold: 2 }));
    await expect(ai.generateStructured(request)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(ai.generateStructured(request)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(ai.generateStructured(request)).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('aborts a request on timeout and exposes only a safe error', async () => {
    const transport: typeof fetch = async (_url, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('private network trace'))),
      );
    const ai = new OpenAICompatibleProvider(options(transport, { timeoutMs: 10, maxRetries: 0 }));
    await expect(ai.generateStructured(request)).rejects.toThrow('temporarily unavailable');
  });
  it.each([
    () => new Response('not-json'),
    () => success({ invalid: true }),
    () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{}', refusal: null }, finish_reason: 'length' }],
        }),
      ),
    () => new Response('small', { headers: { 'content-length': '3000000' } }),
    () => new Response('x'.repeat(2_000_001)),
  ])('refuses malformed, truncated or oversized responses', async (response) => {
    await expect(
      new OpenAICompatibleProvider(options(async () => response())).generateStructured(request),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('handles an explicit model refusal without treating it as structured content', async () => {
    const transport: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: null, refusal: 'cannot comply' }, finish_reason: 'stop' },
          ],
        }),
      );
    await expect(
      new OpenAICompatibleProvider(options(transport)).generateStructured(request),
    ).rejects.toMatchObject({ code: 'REFUSED' });
  });
  it('supports a configured one-time fallback without multiplying a retry budget', async () => {
    const models: string[] = [];
    const transport: typeof fetch = async (_url, init) => {
      models.push((JSON.parse(String(init?.body)) as { model: string }).model);
      return models.length === 1 ? new Response('unavailable', { status: 503 }) : success();
    };
    const ai = new OpenAICompatibleProvider(
      options(transport, { fallbackModel: 'configured-fallback', maxRetries: 0 }),
    );
    expect((await ai.generateStructured(request)).provider).toBe('openai:configured-fallback');
    expect(models).toEqual(['configured-smart', 'configured-fallback']);
  });
  it('validates dimensions, numeric vectors and input-index identities for stored 512-dimensional embeddings', async () => {
    let body: unknown;
    const transport: typeof fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: Array.from({ length: 512 }, () => 0.2) },
            { index: 0, embedding: Array.from({ length: 512 }, () => 0.1) },
          ],
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
      );
    };
    const ai = new OpenAICompatibleProvider(options(transport));
    const vectors = await ai.embed({ texts: ['one fixture', 'another fixture'], dimensions: 512 });
    expect(vectors[0]?.[0]).toBe(0.1);
    expect(vectors[1]?.[0]).toBe(0.2);
    expect(body).toMatchObject({
      model: 'configured-embedding',
      dimensions: 512,
      encoding_format: 'float',
    });
    await expect(ai.embed({ texts: ['fixture'], dimensions: 1536 })).rejects.toMatchObject({
      code: 'CONFIGURATION',
    });
    const wrong = new OpenAICompatibleProvider(
      options(async () => new Response(JSON.stringify({ data: [{ index: 1, embedding: [0.1] }] }))),
    );
    await expect(wrong.embed({ texts: ['fixture'], dimensions: 512 })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it.each([
    'http://api.example.com/v1',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://api.local/v1',
    'https://user:password@api.example.com/v1',
    'https://api.example.com/v1?token=secret',
  ])('rejects unsafe configured endpoints: %s', (baseURL) => {
    expect(() => new OpenAICompatibleProvider(options(async () => success(), { baseURL }))).toThrow(
      'configuration',
    );
  });
  it('does not turn telemetry failure into a second paid request', async () => {
    const transport = vi.fn<typeof fetch>(async () => success());
    const ai = new OpenAICompatibleProvider(
      options(transport, {
        onUsage: () => {
          throw new Error('telemetry unavailable');
        },
      }),
    );
    await expect(ai.generateStructured(request)).resolves.toBeDefined();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
