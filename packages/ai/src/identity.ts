import { z } from 'zod';

export const MOCK_EMBEDDING_IDENTITY = 'mock:deterministic:512:v1';
const identitySchema = z
  .string()
  .regex(/^(?:mock:deterministic|openai:[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}):512:v1$/u);
/** Provider, configured model, dimensions and normalization version define a vector space. */
export function embeddingIdentity(mode: 'mock' | 'openai', model?: string): string {
  const value = mode === 'mock' ? MOCK_EMBEDDING_IDENTITY : `openai:${model ?? ''}:512:v1`;
  if (!identitySchema.safeParse(value).success) throw new Error('Invalid embedding identity.');
  return value;
}
export function providerEmbeddingIdentity(provider: {
  mode: 'mock' | 'openai';
  embeddingIdentity?: string;
}): string {
  const value =
    provider.embeddingIdentity ?? (provider.mode === 'mock' ? MOCK_EMBEDDING_IDENTITY : '');
  if (!identitySchema.safeParse(value).success || !value.startsWith(`${provider.mode}:`))
    throw new Error('Embedding identity is required for this provider.');
  return value;
}
