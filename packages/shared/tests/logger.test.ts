import { describe, expect, it, vi } from 'vitest';
import { createLogger, createObservability, safeRequestId } from '../src/index.js';

describe('operational logging', () => {
  it('redacts nested credentials, content, and error messages while keeping safe IDs', () => {
    let output = '';
    const logger = createLogger({
      service: 'test',
      destination: {
        write(value) {
          output += value;
        },
      },
    });
    logger.info(
      {
        jobId: 'job-123',
        config: {
          DATABASE_URL: 'sensitive-test-value',
          nested: [{ accessToken: 'sensitive-test-value' }],
          api_key: 'sensitive-test-value',
          SUPABASE_SERVICE_ROLE_KEY: 'sensitive-test-value',
          prompt: 'sensitive-test-value',
        },
        err: new Error('sensitive-test-value'),
      },
      'Worker checked',
    );
    expect(output).toContain('job-123');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('sensitive-test-value');
  });

  it('handles cyclic structured data without dropping the log', () => {
    let output = '';
    const logger = createLogger({
      service: 'test',
      destination: {
        write(value) {
          output += value;
        },
      },
    });
    const circular: { again?: unknown } = {};
    circular.again = circular;
    expect(() => logger.info(circular, 'Checked')).not.toThrow();
    expect(output).toContain('[CIRCULAR]');
  });

  it('also redacts credentials bound to child loggers', () => {
    let output = '';
    const logger = createLogger({
      service: 'test',
      destination: {
        write(value) {
          output += value;
        },
      },
    });
    const child = logger.child({ token: 'sensitive-test-value', jobId: 'job-123' });
    child.setBindings({ credentials: { secret: 'sensitive-test-value' } });
    child.child({ password: 'sensitive-test-value' }).info('Checked');
    expect(output).not.toContain('sensitive-test-value');
    expect(output).toContain('job-123');
  });

  it('preserves valid UUID request IDs and replaces arbitrary header text', () => {
    const uuid = '00000000-0000-4000-8000-000000000001';
    expect(safeRequestId(uuid)).toBe(uuid);
    expect(safeRequestId('injected\nvalue')).toMatch(/^[0-9a-f-]{36}$/);
    expect(safeRequestId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('optional observability', () => {
  it('has no required exporter or error destination', async () => {
    await expect(createObservability().run('worker.check', {}, async () => 'ready')).resolves.toBe(
      'ready',
    );
  });

  it('closes spans and reports safe errors while preserving the original failure', async () => {
    const captureException = vi.fn();
    const span = { setAttribute: vi.fn(), recordException: vi.fn(), end: vi.fn() };
    const observability = createObservability({
      errorReporter: { captureException },
      tracer: { startSpan: () => span },
    });
    const failure = new Error('sensitive-test-value');
    await expect(
      observability.run('worker.check', {}, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(captureException).toHaveBeenCalledOnce();
    expect(String(captureException.mock.calls[0]?.[0])).toBe('Error: Operation failed');
    expect(span.end).toHaveBeenCalledOnce();
  });

  it('does not change successful outcomes if optional instrumentation fails', async () => {
    const observability = createObservability({
      tracer: {
        startSpan() {
          throw new Error('unavailable');
        },
      },
    });
    await expect(observability.run('worker.check', {}, async () => 42)).resolves.toBe(42);
  });
});

describe('Phase 8 telemetry boundaries', () => {
  it('redacts unexpected URL/email values, interpolation errors and payload/header objects', () => {
    let output = '';
    const logger = createLogger({
      service: 'test',
      destination: {
        write(value) {
          output += value;
        },
      },
    });
    logger.info(
      {
        description: 'https://fixture.example/private?code=sensitive',
        nested: { contact: 'private@example.com' },
        headers: { custom: 'sensitive' },
        payload: { data: 'sensitive' },
      },
      'Operation checked',
    );
    logger.info('Failure %j', new Error('sensitive interpolation'));
    expect(output).not.toContain('sensitive');
    expect(output).not.toContain('private@example.com');
    expect(output).toContain('Operation checked');
  });
  it('bounds hostile metadata size without preventing an operational log', () => {
    let output = '';
    const logger = createLogger({
      service: 'test',
      destination: {
        write(value) {
          output += value;
        },
      },
    });
    logger.info(
      { value: 'x'.repeat(10000), rows: Array.from({ length: 1000 }, (_, i) => i) },
      'Checked',
    );
    expect(output.length).toBeLessThan(2000);
    expect(output).toContain('[TRUNCATED]');
  });
  it('records actual durations and failure counters without attaching secret context', async () => {
    const record = vi.fn();
    const observer = createObservability({ metrics: { record } });
    await observer.run(
      'test.duration',
      { requestId: '00000000-0000-4000-8000-000000000001' },
      async () => 4,
    );
    expect(record).toHaveBeenCalledWith({
      operation: 'test.duration',
      durationMs: expect.any(Number),
      success: true,
    });
    await expect(
      observer.run('test.duration', {}, async () => {
        throw new Error('private');
      }),
    ).rejects.toThrow('private');
    expect(record).toHaveBeenLastCalledWith({
      operation: 'test.duration',
      durationMs: expect.any(Number),
      success: false,
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain('private');
    expect(JSON.stringify(record.mock.calls)).not.toContain('requestId');
  });
  it('does not make a successful operation fail for invalid context or a broken metrics sink', async () => {
    const record = vi.fn(() => {
      throw new Error('metric sink down');
    });
    await expect(
      createObservability({ metrics: { record } }).run(
        'invalid/url',
        { jobId: 'invalid body data' },
        async () => 42,
      ),
    ).resolves.toBe(42);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'operation.unknown' }),
    );
  });
});

describe('asynchronous observability failure isolation', () => {
  it('absorbs a rejected optional sink without changing a successful result', async () => {
    const observer = createObservability({
      metrics: {
        async record() {
          throw new Error('sink unavailable');
        },
      },
    });
    await expect(observer.run('test.async_sink', {}, async () => 7)).resolves.toBe(7);
    await Promise.resolve();
  });
});
