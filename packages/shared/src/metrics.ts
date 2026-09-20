/** Bounded process-local samples. These are observations, never durable billing counters. */
export interface OperationMetric {
  operation: string;
  count: number;
  failed: number;
  durationTotalMs: number;
  durationMaxMs: number;
  lastObservedAt: string;
}
export interface MetricRecorder {
  record(input: { operation: string; durationMs: number; success: boolean }): unknown;
}
const samples = new Map<string, OperationMetric>();
const MAX_OPERATIONS = 64;
export const processMetrics: MetricRecorder = {
  record({ operation, durationMs, success }) {
    if (
      !/^[a-z][a-z0-9_.-]{0,63}$/.test(operation) ||
      !Number.isFinite(durationMs) ||
      durationMs < 0
    )
      return;
    if (!samples.has(operation) && samples.size >= MAX_OPERATIONS) return;
    const prior = samples.get(operation);
    samples.set(operation, {
      operation,
      count: (prior?.count ?? 0) + 1,
      failed: (prior?.failed ?? 0) + (success ? 0 : 1),
      durationTotalMs: (prior?.durationTotalMs ?? 0) + durationMs,
      durationMaxMs: Math.max(prior?.durationMaxMs ?? 0, durationMs),
      lastObservedAt: new Date().toISOString(),
    });
  },
};
/** No organization IDs, job IDs, URLs, content or credentials are metric labels. */
export function getOperationMetrics(): OperationMetric[] {
  return [...samples.values()]
    .map((sample) => ({ ...sample }))
    .sort((a, b) => a.operation.localeCompare(b.operation));
}

/** Measures time to response headers per HTTP attempt, without reading/changing the body. */
export async function measuredProviderRequest(
  provider: 'ai' | 'reddit' | 'stripe' | 'resend',
  request: () => Promise<Response>,
  recorder: MetricRecorder = processMetrics,
): Promise<Response> {
  const started = performance.now();
  let success = false;
  try {
    const response = await request();
    success = response.ok;
    return response;
  } finally {
    if (['ai', 'reddit', 'stripe', 'resend'].includes(provider)) {
      try {
        void Promise.resolve(
          recorder.record({
            operation: `provider.${provider}.headers`,
            durationMs: Math.max(0, performance.now() - started),
            success,
          }),
        ).catch(() => undefined);
      } catch {
        // Observability must not change the response, retry policy, or original exception.
      }
    }
  }
}
