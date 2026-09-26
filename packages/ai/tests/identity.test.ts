import { describe, expect, it } from 'vitest';
import { createAIProvider, embeddingIdentity, providerEmbeddingIdentity } from '../src/index.js';

describe('embedding vector-space identity', () => {
  it('identifies provider, configured model, dimensions and preprocessing version', () => {
    expect(providerEmbeddingIdentity(createAIProvider())).toBe('mock:deterministic:512:v1');
    expect(embeddingIdentity('openai', 'configured-model-v2')).toBe(
      'openai:configured-model-v2:512:v1',
    );
    expect(embeddingIdentity('openai', 'configured-model-v1')).not.toBe(
      embeddingIdentity('openai', 'configured-model-v2'),
    );
  });
  it.each([undefined, '', 'has whitespace', 'bad\nmodel', 'x'.repeat(151)])(
    'rejects an absent or malformed configured model (%#)',
    (model) => {
      expect(() => embeddingIdentity('openai', model)).toThrow('Invalid embedding identity');
    },
  );
  it('fails closed when a real custom adapter has no identity or a mismatched provider', () => {
    expect(() => providerEmbeddingIdentity({ mode: 'openai' })).toThrow();
    expect(() =>
      providerEmbeddingIdentity({ mode: 'openai', embeddingIdentity: 'mock:deterministic:512:v1' }),
    ).toThrow();
  });
});
