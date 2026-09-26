import { AsyncLocalStorage } from 'node:async_hooks';
import type { Sql } from 'postgres';
import { createAIProvider, type AIProvider, type AIUsage } from '@threadsignal/ai';
import { createCrawlerProvider } from '@threadsignal/crawler';
import { createEmailProvider } from '@threadsignal/email';
import { createRedditProvider } from '@threadsignal/reddit';
import { createLogger } from '@threadsignal/shared';
import type { WorkerConfig } from './config';

export type WorkerAIUsage = {
  provider: 'mock' | 'openai';
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
};
const usageContexts = new WeakMap<AIProvider, AsyncLocalStorage<AIUsage[]>>();

/** Local and the legacy Phase 2 profile cannot activate external providers. */
function settings(config: WorkerConfig) {
  if (config.mode !== 'deployment') {
    if (
      config.providers &&
      (config.providers.ai.mode !== 'mock' ||
        config.providers.reddit.mode !== 'mock' ||
        config.providers.email.mode !== 'console' ||
        config.providers.crawler !== 'fixture')
    )
      throw new Error('External worker providers require approved deployment configuration.');
    return undefined;
  }
  if (!config.providers) throw new Error('Deployment worker providers are not configured.');
  return config.providers;
}
export function createWorkerAI(config: WorkerConfig) {
  const provider = settings(config)?.ai;
  const usage = new AsyncLocalStorage<AIUsage[]>();
  const ai = createAIProvider(
    provider?.mode ?? 'mock',
    provider?.options
      ? {
          ...provider.options,
          onUsage(receipt) {
            usage.getStore()?.push(receipt);
            provider.options?.onUsage?.(receipt);
          },
        }
      : undefined,
  );
  usageContexts.set(ai, usage);
  return ai;
}

/** Each concurrent durable job gets its own receipts, including retrieval embedding requests. */
export function withWorkerAIUsage<T>(
  ai: AIProvider,
  operation: (read: () => WorkerAIUsage) => Promise<T>,
): Promise<T> {
  const receipts: AIUsage[] = [];
  const read = (): WorkerAIUsage => {
    if (ai.mode === 'mock')
      return {
        provider: 'mock',
        model: 'deterministic',
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
      };
    const models = [...new Set(receipts.map((receipt) => receipt.model))];
    return {
      provider: 'openai',
      model: models.length ? models.join(',').slice(0, 150) : 'unreported',
      input_tokens:
        receipts.length && receipts.every((receipt) => receipt.input_tokens !== null)
          ? receipts.reduce((sum, receipt) => sum + (receipt.input_tokens ?? 0), 0)
          : null,
      output_tokens:
        receipts.length && receipts.every((receipt) => receipt.output_tokens !== null)
          ? receipts.reduce((sum, receipt) => sum + (receipt.output_tokens ?? 0), 0)
          : null,
      estimated_cost_usd:
        receipts.length && receipts.every((receipt) => receipt.estimated_cost_usd !== null)
          ? receipts.reduce((sum, receipt) => sum + (receipt.estimated_cost_usd ?? 0), 0)
          : null,
    };
  };
  const context = usageContexts.get(ai);
  return context ? context.run(receipts, () => operation(read)) : operation(read);
}

/** Persist every admitted attempt with AI calls, including receipts preceding failure. */
export function withWorkerAIOperation<T>(
  sql: Sql,
  scope: {
    organizationId: string;
    brandId: string;
    operationId: string;
    task: 'knowledge.embed' | 'opportunity.evaluate';
  },
  ai: AIProvider,
  operation: (tracked: AIProvider) => Promise<T>,
): Promise<T> {
  return withWorkerAIUsage(ai, async (read) => {
    let called = false;
    const tracked: AIProvider = {
      mode: ai.mode,
      ...(ai.embeddingIdentity ? { embeddingIdentity: ai.embeddingIdentity } : {}),
      embed: (input) => {
        called = true;
        return ai.embed(input);
      },
      generateStructured: (input) => {
        called = true;
        return ai.generateStructured(input);
      },
    };
    try {
      return await operation(tracked);
    } finally {
      if (called)
        await sql`select private.record_ai_usage(${scope.organizationId}::uuid,${scope.brandId}::uuid,${scope.operationId}::uuid,${scope.task},${sql.json(read())}::jsonb)`;
    }
  });
}
export function createWorkerCrawler(config: WorkerConfig) {
  return createCrawlerProvider(settings(config)?.crawler ?? 'fixture');
}
export function createWorkerReddit(config: WorkerConfig) {
  const provider = settings(config)?.reddit;
  return createRedditProvider(provider?.mode ?? 'mock', provider?.options);
}
export function createWorkerEmail(
  config: WorkerConfig,
  logger = createLogger({ service: 'notifications' }),
) {
  const provider = settings(config)?.email;
  return createEmailProvider(provider?.mode ?? 'console', logger, provider?.options);
}
