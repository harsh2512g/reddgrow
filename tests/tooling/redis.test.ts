import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { redisDefinition } from '../../scripts/redis.mjs';

describe('Redis configuration isolation', () => {
  it('permits only the documented local Redis configuration', () => {
    const input: unknown = parse(readFileSync('docker-compose.yml', 'utf8'));
    expect(redisDefinition(input).ports).toEqual(['127.0.0.1:56379:6379']);
    expect(redisDefinition(input).command).toEqual([
      'redis-server',
      '--appendonly',
      'yes',
      '--protected-mode',
      'no',
    ]);
  });
  it.each(['ports', 'volumes', 'image', 'command'])(
    'rejects changes to unsafe %s values',
    (field) => {
      const input = parse(readFileSync('docker-compose.yml', 'utf8')) as {
        services: { redis: Record<string, unknown> };
      };
      input.services.redis[field] = field === 'image' ? 'unapproved/image:latest' : ['unapproved'];
      expect(() => redisDefinition(input)).toThrow('isolation');
    },
  );
});
