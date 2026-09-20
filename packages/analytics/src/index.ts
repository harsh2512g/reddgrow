import { z } from 'zod';

const providerMetricSchema = z.object({
  provider: z.enum(['reddit', 'ai', 'crawler', 'email', 'billing']),
  operation: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
  outcome: z.enum(['success', 'failure']),
  durationMs: z.number().finite().nonnegative(),
});

export type ProviderMetric = z.infer<typeof providerMetricSchema>;
export interface MetricSink {
  record(metric: ProviderMetric): void;
}

/** Operational metrics only; no product-event collection or external analytics destination. */
export function createMetrics(sink?: MetricSink) {
  return {
    recordProvider(input: unknown): void {
      const metric = providerMetricSchema.parse(input);
      if (sink) {
        try {
          sink.record(metric);
        } catch {
          /* Optional metrics cannot fail the observed operation. */
        }
      }
    },
  };
}

export * from './attribution.js';
