import { z } from 'zod';
import { processMetrics, type MetricRecorder } from './metrics.js';

const contextSchema = z.object({
  requestId: z.uuid().optional(),
  jobId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,128}$/)
    .optional(),
  organizationId: z.uuid().optional(),
});

export type SafeContext = z.infer<typeof contextSchema>;

/** A Sentry adapter can supply captureException without configuring a transport here. */
export interface ErrorReporter {
  captureException(error: Error, context: { tags: SafeContext }): unknown;
}

/** Structural subset of an OpenTelemetry span; no global tracer or exporter is installed. */
export interface TraceSpan {
  setAttribute(key: string, value: string | boolean | number): unknown;
  recordException(error: Error): unknown;
  end(): void;
}

export interface Tracer {
  startSpan(name: string, options: { attributes: SafeContext }): TraceSpan;
}

/** Hooks are optional and must never make an otherwise healthy operation fail. */
export function createObservability(
  options: { errorReporter?: ErrorReporter; tracer?: Tracer; metrics?: MetricRecorder } = {},
) {
  const safely = (callback: () => unknown): void => {
    try {
      // Adapters may return promises; observe rejection without waiting on telemetry.
      void Promise.resolve(callback()).catch(() => undefined);
    } catch {
      /* Observability must not change application outcomes. */
    }
  };
  return {
    async run<T>(name: string, context: SafeContext, operation: () => Promise<T>): Promise<T> {
      const nameResult = z
        .string()
        .regex(/^[a-z][a-z0-9_.-]{0,63}$/)
        .safeParse(name);
      const safeName = nameResult.success ? nameResult.data : 'operation.unknown';
      const contextResult = contextSchema.safeParse(context);
      const safeContext = contextResult.success ? contextResult.data : {};
      const started = performance.now();
      let success = false;
      let span: TraceSpan | undefined;
      safely(() => {
        span = options.tracer?.startSpan(safeName, { attributes: safeContext });
      });
      try {
        const result = await operation();
        success = true;
        safely(() => span?.setAttribute('operation.success', true));
        return result;
      } catch (error) {
        const safeError = new Error('Operation failed');
        safely(() => span?.setAttribute('operation.success', false));
        safely(() => span?.recordException(safeError));
        safely(() => options.errorReporter?.captureException(safeError, { tags: safeContext }));
        throw error;
      } finally {
        const durationMs = Math.max(0, performance.now() - started);
        const measurement = { operation: safeName, durationMs, success };
        safely(() => processMetrics.record(measurement));
        safely(() => options.metrics?.record(measurement));
        safely(() => span?.setAttribute('operation.duration_ms', durationMs));
        safely(() => span?.end());
      }
    },
  };
}
