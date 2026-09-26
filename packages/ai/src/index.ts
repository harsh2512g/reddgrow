import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AIProviderError, OpenAICompatibleProvider, type OpenAIProviderOptions } from './openai.js';
export * from './openai.js';
export * from './identity.js';
import {
  mockOpportunityAssessment,
  mockKeywordSuggestions,
  mockSubredditSuggestions,
} from './opportunity.js';
export * from './opportunity.js';

const generationInputSchema = z.object({
  task: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
  input: z.string().max(100_000),
});

export interface AIProvider {
  readonly mode: 'mock' | 'openai';
  readonly embeddingIdentity?: string;
  generateStructured<T>(input: {
    task: string;
    input: string;
    schema: z.ZodType<T>;
  }): Promise<{ value: T; provider: string }>;
  embed(input: { texts: string[]; dimensions: number }): Promise<number[][]>;
}

/** Deterministic local fixture generation and lexical feature-hash embeddings. */
export class MockAIProvider implements AIProvider {
  readonly mode = 'mock';
  readonly embeddingIdentity = 'mock:deterministic:512:v1';
  constructor(
    private readonly fixtures: Readonly<Record<string, unknown>> = {
      health: { status: 'ready', provider: 'mock' },
    },
  ) {}

  async generateStructured<T>(input: {
    task: string;
    input: string;
    schema: z.ZodType<T>;
  }): Promise<{ value: T; provider: string }> {
    const request = generationInputSchema.parse(input);
    let value: unknown;
    if (Object.hasOwn(this.fixtures, request.task))
      value = structuredClone(this.fixtures[request.task]);
    else if (request.task === 'opportunity.evaluate')
      value = mockOpportunityAssessment(JSON.parse(request.input));
    else if (request.task === 'keyword.suggest')
      value = mockKeywordSuggestions(JSON.parse(request.input));
    else if (request.task === 'subreddit.suggest')
      value = mockSubredditSuggestions(JSON.parse(request.input));
    else throw new Error('No synthetic fixture is registered for this AI task.');
    return {
      value: input.schema.parse(value),
      provider: this.mode,
    };
  }

  async embed(input: { texts: string[]; dimensions: number }): Promise<number[][]> {
    const request = z
      .object({
        texts: z.array(z.string().min(1).max(100_000)).min(1).max(100),
        dimensions: z.number().int().min(2).max(3072),
      })
      .parse(input);
    return request.texts.map((text) => mockEmbedding(text, request.dimensions));
  }
}

const stopWords = new Set(
  'a an the and or to of in on for from with is are be as by it its this that can your our'.split(
    ' ',
  ),
);
/** This is lexical similarity for an honest offline demo, not a language-model embedding. */
export function mockEmbedding(text: string, dimensions = 512): number[] {
  z.number().int().min(2).max(3072).parse(dimensions);
  const words =
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const counts = new Map<string, number>();
  for (const word of words) {
    if (stopWords.has(word)) continue;
    const stem = word.length > 5 ? word.replace(/(?:ing|ers|ed|es|s)$/, '') : word;
    counts.set(stem, (counts.get(stem) ?? 0) + 1);
  }
  if (!counts.size) counts.set('_empty_', 1);
  const values = Array.from({ length: dimensions }, () => 0);
  for (const [term, count] of counts) {
    const hash = createHash('sha256').update(term).digest();
    // Two independent signed features reduce accidental collisions in short demo queries.
    for (const offset of [0, 8]) {
      const index = hash.readUInt32BE(offset) % dimensions;
      values[index] =
        (values[index] ?? 0) + ((hash[offset + 4] ?? 0) & 1 ? 1 : -1) * (1 + Math.log(count));
    }
  }
  const magnitude = Math.hypot(...values);
  return magnitude
    ? values.map((value) => value / magnitude)
    : values.map((_, index) => (index === 0 ? 1 : 0));
}

export function createAIProvider(
  mode: 'mock' | 'openai' = 'mock',
  options?: OpenAIProviderOptions,
): AIProvider {
  if (mode === 'mock') return new MockAIProvider();
  if (!options) throw new AIProviderError('CONFIGURATION');
  return new OpenAICompatibleProvider(options);
}
