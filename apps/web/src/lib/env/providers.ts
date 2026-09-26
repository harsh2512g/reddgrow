import 'server-only';
import { createHash } from 'node:crypto';
import { createAIProvider, type AIProvider } from '@threadsignal/ai';
import { createRedditProvider, type RedditProvider } from '@threadsignal/reddit';
import { captureWebAIUsage } from './ai-usage';
import { getServerEnv } from './server';
import { deploymentRuntime } from './runtime';

let aiCache: { signature: string; provider: AIProvider } | undefined;
let redditCache: { signature: string; provider: RedditProvider } | undefined;
const signature = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function configuredAIProvider() {
  const env = getServerEnv();
  if (env.AI_PROVIDER === 'mock') return createAIProvider('mock');
  if (!deploymentRuntime(env)) throw new Error('Real AI requires an approved deployment profile.');
  const options = {
    apiKey: env.OPENAI_API_KEY!,
    fastModel: env.AI_FAST_MODEL!,
    smartModel: env.AI_SMART_MODEL!,
    embeddingModel: env.AI_EMBEDDING_MODEL!,
    ...(env.AI_MODEL_COSTS_JSON ? { modelCosts: env.AI_MODEL_COSTS_JSON } : {}),
    maxRetries: Math.min(env.AI_MAX_RETRIES, 2),
    allowNetwork: true,
    onUsage: captureWebAIUsage,
  };
  const key = signature([env.THREADSIGNAL_SUPABASE_PROJECT_REF, options]);
  if (aiCache?.signature !== key)
    aiCache = { signature: key, provider: createAIProvider('openai', options) };
  return aiCache.provider;
}
export function configuredRedditProvider() {
  const env = getServerEnv();
  if (env.REDDIT_PROVIDER === 'mock') return createRedditProvider('mock');
  if (!deploymentRuntime(env))
    throw new Error('Real Reddit requires an approved deployment profile.');
  const options = {
    clientId: env.REDDIT_CLIENT_ID!,
    clientSecret: env.REDDIT_CLIENT_SECRET!,
    userAgent: env.REDDIT_USER_AGENT!,
    commercialApprovalConfirmed: env.REDDIT_COMMERCIAL_APPROVAL_CONFIRMED,
  };
  const key = signature([env.THREADSIGNAL_SUPABASE_PROJECT_REF, options]);
  if (redditCache?.signature !== key)
    redditCache = { signature: key, provider: createRedditProvider('oauth', options) };
  return redditCache.provider;
}
