import { randomUUID } from 'node:crypto';
import pino, { type DestinationStream, type LevelWithSilent, type Logger } from 'pino';

const sensitiveKey =
  /(?:authorization|cookie|password|secret|token|key|dsn|url|body|content|recipient|email|prompt|headers|stack|payload|ipAddress|remoteAddress)/i;

function safeLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (value instanceof Error) return { type: 'Error', message: 'Operation failed' };
  if (typeof value === 'string') {
    // Defense in depth for accidentally supplied operational fields; log messages remain fixed copy.
    if (
      /Bearer\s+\S+|(?:https?|postgres(?:ql)?|rediss?):\/\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(
        value,
      )
    )
      return '[REDACTED]';
    return value.length > 2048 ? '[TRUNCATED]' : value;
  }
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => safeLogValue(item, depth + 1, seen));
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .map(([key, item]) => [
        key,
        sensitiveKey.test(key) ? '[REDACTED]' : safeLogValue(item, depth + 1, seen),
      ]),
  );
}

/** Pino resets binding formatters for children; sanitize before bindings are serialized. */
function protectBindings(logger: Logger): Logger {
  return new Proxy(logger, {
    get(target, property, receiver) {
      if (property === 'child') {
        return (bindings: pino.Bindings, options?: pino.ChildLoggerOptions) =>
          protectBindings(target.child(safeLogValue(bindings) as pino.Bindings, options));
      }
      if (property === 'setBindings') {
        return (bindings: pino.Bindings) =>
          target.setBindings(safeLogValue(bindings) as pino.Bindings);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

/** Structured operational metadata only; never pass raw environment objects or content in messages. */
export function createLogger(options: {
  service: string;
  level?: LevelWithSilent;
  destination?: DestinationStream;
}): Logger {
  const config: pino.LoggerOptions = {
    name: options.service,
    level: options.level ?? 'info',
    base: { service: options.service },
    formatters: {
      bindings(bindings) {
        return safeLogValue(bindings) as Record<string, unknown>;
      },
    },
    hooks: {
      logMethod(args, method) {
        // Pino supports interpolation arguments too; sanitize every supplied value.
        for (let index = 0; index < args.length; index++) {
          args[index] = safeLogValue(args[index]);
        }
        method.apply(this, args);
      },
    },
  };
  return protectBindings(options.destination ? pino(config, options.destination) : pino(config));
}

/** Reject arbitrary header text so request IDs cannot inject logs or disclose credentials. */
export function safeRequestId(input?: string | null): string {
  return input &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)
    ? input
    : randomUUID();
}
