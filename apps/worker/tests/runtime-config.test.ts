import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseWorkerConfig } from '../src/config';
import { startWorker } from '../src/runtime';

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  redis: vi.fn(),
  authority: vi.fn(async () => undefined),
  queues: vi.fn(),
  processors: vi.fn(),
  listen: vi.fn(),
  sql: vi.fn(async () => []),
  running: true,
}));

vi.mock('@threadsignal/database', () => ({ verifyDeploymentDatabaseAuthority: mocks.authority }));

vi.mock('postgres', () => ({
  default: (options: unknown) => {
    mocks.database(options);
    return Object.assign(mocks.sql, {
      end: vi.fn(async () => undefined),
      begin: vi.fn(async (operation: (sql: typeof mocks.sql) => Promise<unknown>) =>
        operation(mocks.sql),
      ),
    });
  },
}));
vi.mock('ioredis', () => ({
  Redis: class {
    constructor(options: unknown) {
      mocks.redis(options);
    }
    on() {}
    async connect() {}
    async ping() {
      return 'PONG';
    }
    disconnect() {}
  },
}));
vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string, options: unknown) {
      mocks.queues(name, options);
    }
    on() {}
    async waitUntilReady() {}
    async add() {}
    async close() {}
  },
  Worker: class {
    constructor(name: string, _handler: unknown, options: unknown) {
      mocks.processors(name, options);
    }
    on() {}
    isRunning() {
      return mocks.running;
    }
    async waitUntilReady() {}
    async close() {}
  },
  UnrecoverableError: class extends Error {},
}));
vi.mock('node:http', () => ({
  createServer: () => ({
    listening: false,
    once() {},
    off() {},
    on() {},
    listen(port: number, host: string, callback: () => void) {
      this.listening = true;
      mocks.listen(port, host);
      callback();
    },
    close(callback: () => void) {
      this.listening = false;
      callback();
    },
    closeIdleConnections() {},
  }),
}));
vi.mock('@threadsignal/shared', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
  createObservability: () => ({}),
}));

const projectRef = 'abcdefghijklmnopqrst';
const local = {
  DATABASE_URL: 'postgresql://postgres:synthetic-password@127.0.0.1:54322/postgres',
  SUPABASE_SERVICE_ROLE_KEY: [
    'e30',
    Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url'),
    'synthetic',
  ].join('.'),
};
const hosted = {
  THREADSIGNAL_WORKER_MODE: 'personal-development',
  THREADSIGNAL_SUPABASE_MODE: 'personal-development',
  THREADSIGNAL_SUPABASE_PROJECT_REF: projectRef,
  NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
  DATABASE_URL: `postgresql://threadsignal_worker:synthetic-password@db.${projectRef}.supabase.co:5432/postgres`,
  THREADSIGNAL_DATABASE_CA: '-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----',
  SUPABASE_SECRET_KEY: `sb_secret_${'synthetic'.repeat(3)}`,
};

describe('runtime isolation at connection boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.running = true;
    mocks.sql.mockReset().mockResolvedValue([]);
  });

  it('passes verified TLS to PostgreSQL and separates both queue producers and consumers', async () => {
    const config = parseWorkerConfig(hosted);
    const worker = await startWorker(config);
    try {
      expect(mocks.database).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'threadsignal_worker',
          ssl: {
            rejectUnauthorized: true,
            ca: hosted.THREADSIGNAL_DATABASE_CA,
            servername: `db.${projectRef}.supabase.co`,
          },
        }),
      );
      for (const constructor of [mocks.queues, mocks.processors]) {
        expect(constructor).toHaveBeenCalledTimes(2);
        for (const name of ['knowledge-ingestion', 'foundation-heartbeat'])
          expect(constructor).toHaveBeenCalledWith(
            name,
            expect.objectContaining({ prefix: `threadsignal-hosted-${projectRef}` }),
          );
      }
      expect(mocks.listen).toHaveBeenCalledWith(3003, '127.0.0.1');
      expect(await worker.readiness()).toMatchObject({
        checks: { knowledge: 'up' },
        mode: 'personal-development',
        projectRef,
        queuePrefix: `threadsignal-hosted-${projectRef}`,
      });
    } finally {
      await worker.stop();
    }
  });

  it('reports knowledge unavailable when outbox permissions fail even though SELECT 1 succeeds', async () => {
    mocks.sql
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('synthetic permission failure'))
      .mockResolvedValue([]);
    const worker = await startWorker(parseWorkerConfig(hosted));
    try {
      expect(await worker.readiness()).toMatchObject({
        status: 'not_ready',
        checks: { database: 'up', redis: 'up', knowledge: 'down' },
      });
    } finally {
      await worker.stop();
    }
  });

  it('reports knowledge unavailable after the consumer stops or its dispatch becomes stale', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const worker = await startWorker(parseWorkerConfig(hosted));
    try {
      mocks.running = false;
      expect(await worker.readiness()).toMatchObject({ checks: { knowledge: 'down' } });
      mocks.running = true;
      clock.mockReturnValue(now + 30_001);
      expect(await worker.readiness()).toMatchObject({ checks: { knowledge: 'down' } });
    } finally {
      clock.mockRestore();
      await worker.stop();
    }
  });

  it('keeps local service endpoints, namespaces, TLS setting and readiness shape unchanged', async () => {
    const worker = await startWorker(parseWorkerConfig(local));
    try {
      expect(mocks.database).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', port: 54322, ssl: false }),
      );
      expect(mocks.listen).toHaveBeenCalledWith(3001, '127.0.0.1');
      for (const constructor of [mocks.queues, mocks.processors])
        for (const [, options] of constructor.mock.calls)
          expect(options).toMatchObject({ prefix: 'threadsignal-foundation' });
      expect(await worker.readiness()).toMatchObject({
        checks: { knowledge: 'up', privacy: 'up' },
      });
      expect(await worker.readiness()).not.toHaveProperty('projectRef');
      expect(await worker.readiness()).not.toHaveProperty('mode');
    } finally {
      await worker.stop();
    }
  });
  it('starts every processing subsystem only in the explicit deployment profile and carries TLS to every queue', async () => {
    const config = parseWorkerConfig({
      ...hosted,
      NODE_ENV: 'production',
      THREADSIGNAL_WORKER_MODE: 'deployment',
      THREADSIGNAL_SUPABASE_MODE: 'deployment',
      THREADSIGNAL_DEPLOYMENT_APPROVED: 'true',
      THREADSIGNAL_RUNTIME_ROLE: 'worker',
      NEXT_PUBLIC_APP_URL: 'https://app.threadsignal.example.com',
      DATABASE_URL: `postgresql://threadsignal_runtime_worker:synthetic-password@db.${projectRef}.supabase.co:5432/postgres`,
      REDIS_URL: 'rediss://default:synthetic-password@redis.threadsignal.example.com:6379/0',
    });
    const worker = await startWorker(config);
    try {
      expect(mocks.database).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'threadsignal_runtime_worker',
          ssl: expect.objectContaining({ rejectUnauthorized: true }),
        }),
      );
      expect(mocks.redis).toHaveBeenCalledWith(
        expect.objectContaining({
          tls: { rejectUnauthorized: true, servername: 'redis.threadsignal.example.com' },
        }),
      );
      for (const constructor of [mocks.queues, mocks.processors]) {
        expect(constructor.mock.calls.length).toBeGreaterThan(2);
        for (const [, options] of constructor.mock.calls)
          expect(options).toMatchObject({
            prefix: `threadsignal-deployment-${projectRef}`,
            connection: { tls: { rejectUnauthorized: true } },
          });
      }
      expect(mocks.listen).toHaveBeenCalledWith(3001, '0.0.0.0');
      expect(mocks.authority).toHaveBeenCalledWith(expect.any(Function), 'worker');
      expect(await worker.readiness()).toMatchObject({
        checks: {
          knowledge: 'up',
          privacy: 'up',
          opportunities: 'up',
          drafts: 'up',
          analytics: 'up',
          notifications: 'up',
        },
      });
    } finally {
      await worker.stop();
    }
  });
  it('refuses privileged or drifted deployment database authority before opening any queue', async () => {
    mocks.authority.mockRejectedValueOnce(new Error('Unsafe deployment role'));
    const config = parseWorkerConfig({
      ...hosted,
      NODE_ENV: 'production',
      THREADSIGNAL_WORKER_MODE: 'deployment',
      THREADSIGNAL_SUPABASE_MODE: 'deployment',
      THREADSIGNAL_DEPLOYMENT_APPROVED: 'true',
      THREADSIGNAL_RUNTIME_ROLE: 'worker',
      NEXT_PUBLIC_APP_URL: 'https://app.threadsignal.example.com',
      DATABASE_URL: `postgresql://threadsignal_runtime_worker:synthetic-password@db.${projectRef}.supabase.co:5432/postgres`,
      REDIS_URL: 'rediss://default:synthetic-password@redis.threadsignal.example.com:6379/0',
    });
    await expect(startWorker(config)).rejects.toThrow('Unsafe deployment role');
    expect(mocks.queues).not.toHaveBeenCalled();
    expect(mocks.processors).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
  });
});
