import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { AIProvider, AIUsage } from '@threadsignal/ai';
import { getServerEnv } from './server';
import { enforceMutationRateLimit } from '../mutation-rate-limit';
import { requireActiveProviderPlan } from '../provider-plan';

const contexts = new AsyncLocalStorage<AIUsage[]>();
export function captureWebAIUsage(receipt: AIUsage) {
  contexts.getStore()?.push(receipt);
}
export type WebAITask =
  'knowledge.search' | 'keyword.suggest' | 'subreddit.suggest' | 'brand.extract';
/** Receipts are scoped to one verified request; prompts, documents and replies are never stored here. */
export async function withWebAIUsage<T>(
  scope: { organizationId: string; brandId: string; userId: string },
  task: WebAITask,
  provider: AIProvider,
  operation: () => Promise<T>,
): Promise<T> {
  // The explicitly frozen hosted Phase 2 profile does not have later accounting migrations.
  if (getServerEnv().THREADSIGNAL_SUPABASE_MODE === 'personal-development') return operation();
  // Search is a GET/read flow, but its embedding request still consumes provider capacity.
  // Other callers already pass the authenticated mutation budget before invoking this helper.
  if (task === 'knowledge.search')
    await enforceMutationRateLimit('knowledge', scope.organizationId);
  await requireActiveProviderPlan(scope.organizationId);
  return contexts.run([], async () => {
    const operationId = randomUUID();
    try {
      return await operation();
    } finally {
      const receipts = contexts.getStore() ?? [];
      const metadata =
        provider.mode === 'mock'
          ? {
              provider: 'mock',
              model: 'deterministic',
              input_tokens: 0,
              output_tokens: 0,
              estimated_cost_usd: 0,
            }
          : {
              provider: 'openai',
              model:
                [...new Set(receipts.map((r) => r.model))].join(',').slice(0, 150) || 'unreported',
              input_tokens:
                receipts.length && receipts.every((r) => r.input_tokens !== null)
                  ? receipts.reduce((n, r) => n + (r.input_tokens ?? 0), 0)
                  : null,
              output_tokens:
                receipts.length && receipts.every((r) => r.output_tokens !== null)
                  ? receipts.reduce((n, r) => n + (r.output_tokens ?? 0), 0)
                  : null,
              estimated_cost_usd:
                receipts.length && receipts.every((r) => r.estimated_cost_usd !== null)
                  ? receipts.reduce((n, r) => n + (r.estimated_cost_usd ?? 0), 0)
                  : null,
            };
      const { billingDatabase } = await import('../phase7/database');
      await billingDatabase(
        'recordAIUsage',
        [scope.organizationId, scope.brandId, operationId, task, JSON.stringify(metadata)],
        scope.userId,
      );
    }
  });
}
