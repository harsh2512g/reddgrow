import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { root, assertInside } from './isolation.mjs';

const containerName = 'threadsignal-redis-1';
const volumeName = 'threadsignal-redis';
const ownerLabel = 'com.threadsignal.foundation';
const schema = z
  .object({
    name: z.literal('threadsignal'),
    services: z
      .object({
        redis: z
          .object({
            image: z.string().regex(/^redis:\d+\.\d+\.\d+-alpine$/),
            command: z.tuple([
              z.literal('redis-server'),
              z.literal('--appendonly'),
              z.literal('yes'),
              z.literal('--protected-mode'),
              z.literal('no'),
            ]),
            ports: z.tuple([z.literal('127.0.0.1:56379:6379')]),
            volumes: z.tuple([z.literal('threadsignal-redis:/data')]),
            healthcheck: z
              .object({
                test: z.tuple([z.literal('CMD'), z.literal('redis-cli'), z.literal('ping')]),
                interval: z.literal('2s'),
                timeout: z.literal('2s'),
                retries: z.literal(30),
              })
              .strict(),
            security_opt: z.tuple([z.literal('no-new-privileges:true')]),
            restart: z.literal('no'),
          })
          .strict(),
      })
      .strict(),
    volumes: z.object({ 'threadsignal-redis': z.null() }).strict(),
  })
  .strict();

export function redisDefinition(input) {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error('Redis Compose configuration violates project isolation.');
  return result.data.services.redis;
}
function definition() {
  try {
    return redisDefinition(
      parse(readFileSync(assertInside(join(root, 'docker-compose.yml')), 'utf8')),
    );
  } catch {
    throw new Error('Invalid project Redis configuration.');
  }
}
function inspect(execute) {
  const result = execute(
    'docker',
    [
      'inspect',
      '--format',
      '{{ index .Config.Labels "com.threadsignal.foundation" }} {{ index .Config.Labels "com.threadsignal.definition" }}',
      containerName,
    ],
    { quiet: true, allowFailure: true },
  );
  if (result.status !== 0) return null;
  const [owner, digest] = result.stdout.trim().split(' ');
  if (owner !== 'redis')
    throw new Error('Refusing Redis container without project ownership label.');
  return { digest };
}
export async function startRedis(execute) {
  const config = definition();
  const digest = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  const existing = inspect(execute);
  if (existing && existing.digest !== digest) {
    execute('docker', ['stop', containerName], { quiet: true });
    execute('docker', ['rm', containerName], { quiet: true });
  }
  if (!existing || existing.digest !== digest) {
    execute('docker', ['volume', 'create', '--label', `${ownerLabel}=redis`, volumeName], {
      quiet: true,
    });
    execute(
      'docker',
      [
        'run',
        '--detach',
        '--name',
        containerName,
        '--label',
        `${ownerLabel}=redis`,
        '--label',
        `com.threadsignal.definition=${digest}`,
        '--restart',
        config.restart,
        '--security-opt',
        config.security_opt[0],
        '--publish',
        config.ports[0],
        '--volume',
        `${volumeName}:/data`,
        '--health-cmd',
        'redis-cli ping',
        '--health-interval',
        config.healthcheck.interval,
        '--health-timeout',
        config.healthcheck.timeout,
        '--health-retries',
        String(config.healthcheck.retries),
        config.image,
        ...config.command,
      ],
      { quiet: true },
    );
  } else execute('docker', ['start', containerName], { quiet: true });
  for (let attempt = 0; attempt < 30; attempt++) {
    const ping = execute('docker', ['exec', containerName, 'redis-cli', 'ping'], {
      quiet: true,
      allowFailure: true,
    });
    if (ping.status === 0 && ping.stdout.trim() === 'PONG') {
      process.stdout.write('Project Redis is ready.\n');
      return;
    }
    await delay(1000);
  }
  throw new Error('Project Redis did not become healthy.');
}
export function healthRedis(execute) {
  if (!inspect(execute)) throw new Error('Project Redis container is absent.');
  const ping = execute('docker', ['exec', containerName, 'redis-cli', 'ping'], { quiet: true });
  if (ping.stdout.trim() !== 'PONG') throw new Error('Project Redis health check failed.');
  return 'PONG';
}
export function stopRedis(execute) {
  if (inspect(execute)) execute('docker', ['stop', containerName], { quiet: true });
}
