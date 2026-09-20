import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { root, state } from '../../scripts/isolation.mjs';
import {
  dockerArguments,
  dockerClientConfiguration,
  parseRuntimeConfiguration,
  parseSupabaseStatus,
  stopServicesSafely,
} from '../../scripts/service-utils.mjs';

describe('local service shutdown', () => {
  function steps() {
    return {
      verifyDocker: vi.fn(),
      stopSupabase: vi.fn(),
      stopCompose: vi.fn(),
      stopColima: vi.fn(),
    };
  }

  it('shuts down only its Colima profile when Docker verification fails', () => {
    const cleanup = steps();
    cleanup.verifyDocker.mockImplementation(() => {
      throw new Error('wrong socket');
    });
    expect(stopServicesSafely(cleanup)).toEqual(['docker_verification']);
    expect(cleanup.stopSupabase).not.toHaveBeenCalled();
    expect(cleanup.stopCompose).not.toHaveBeenCalled();
    expect(cleanup.stopColima).toHaveBeenCalledOnce();
  });

  it('continues cleanup after a Supabase failure and reports every failed step', () => {
    const cleanup = steps();
    cleanup.stopSupabase.mockImplementation(() => {
      throw new Error('unavailable');
    });
    cleanup.stopColima.mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(stopServicesSafely(cleanup)).toEqual(['stopSupabase', 'stopColima']);
    expect(cleanup.stopCompose).toHaveBeenCalledOnce();
    expect(cleanup.stopColima).toHaveBeenCalledOnce();
  });

  it('reports success only when verified service cleanup fully succeeds', () => {
    const cleanup = steps();
    expect(stopServicesSafely(cleanup)).toEqual([]);
    expect(cleanup.stopSupabase).toHaveBeenCalledOnce();
    expect(cleanup.stopCompose).toHaveBeenCalledOnce();
    expect(cleanup.stopColima).toHaveBeenCalledOnce();
  });
});

describe('generated service configuration', () => {
  const local = 'postgresql://postgres:fixture-password@127.0.0.1:54322/postgres';
  const jwt = (role: string) =>
    `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture`;
  it('forwards only the project-local public anonymous key to the web runtime', () => {
    const publicKey = jwt('anon');
    expect(
      parseSupabaseStatus(
        JSON.stringify({
          DB_URL: local,
          ANON_KEY: publicKey,
          SERVICE_ROLE_KEY: jwt('service_role'),
        }),
      ),
    ).toEqual({ DATABASE_URL: local, NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey });
    expect(
      parseRuntimeConfiguration(
        JSON.stringify({ DATABASE_URL: local, NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey }),
      ),
    ).toEqual({ DATABASE_URL: local, NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey });
  });
  it('rejects elevated keys or malformed public-key configuration without exposing values', () => {
    for (const value of [
      jwt('service_role'),
      jwt('authenticated'),
      'fixture-sensitive-value',
      123,
    ]) {
      let error: unknown;
      try {
        parseRuntimeConfiguration(
          JSON.stringify({ DATABASE_URL: local, NEXT_PUBLIC_SUPABASE_ANON_KEY: value }),
        );
      } catch (failure) {
        error = failure;
      }
      expect(error).toBeInstanceOf(Error);
      expect(inspect(error)).not.toContain(String(value));
    }
  });
  it('accepts only the dedicated local database', () => {
    expect(parseRuntimeConfiguration(JSON.stringify({ DATABASE_URL: local }))).toEqual({
      DATABASE_URL: local,
    });
    expect(
      parseSupabaseStatus(
        JSON.stringify({
          DB_URL: local.replace('postgresql:', 'postgres:').replace('127.0.0.1', 'localhost'),
        }),
      ),
    ).toEqual({ DATABASE_URL: local });
  });

  it.each([
    'fixture-sensitive-value invalid json',
    JSON.stringify({ DATABASE_URL: 'fixture-sensitive-value invalid url' }),
    JSON.stringify({
      DATABASE_URL: 'postgresql://postgres:fixture-sensitive-value@remote.example:54322/postgres',
    }),
    JSON.stringify({ DATABASE_URL: `${local}?password=fixture-sensitive-value` }),
    JSON.stringify(null),
  ])('suppresses malformed configuration input and URL error properties', (raw) => {
    for (const parse of [parseRuntimeConfiguration, parseSupabaseStatus]) {
      let failure: unknown;
      try {
        parse(raw);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(inspect(failure)).not.toContain('fixture-sensitive-value');
      expect(failure).not.toHaveProperty('input');
      expect(failure).not.toHaveProperty('cause');
    }
  });
});

describe('Docker credential isolation', () => {
  it('uses explicit project config and Colima context flags', () => {
    expect(dockerArguments(['context', 'show'])).toEqual([
      '--config',
      join(state, 'docker'),
      '--context',
      'colima',
      'context',
      'show',
    ]);
    expect(dockerClientConfiguration()).toEqual({
      auths: {},
      credsStore: 'threadsignal',
      currentContext: 'colima',
    });
  });

  it.each([
    ['list', 0, '{}\n'],
    ['get', 1, 'credentials not found in native keychain\n'],
    ['store', 1, 'ThreadSignal registry credential storage is disabled.\n'],
    ['erase', 1, 'ThreadSignal registry credential storage is disabled.\n'],
  ])('handles %s without reading or exposing credential input', (operation, status, output) => {
    const result = spawnSync(
      join(root, 'scripts/bin/docker-credential-threadsignal'),
      [String(operation)],
      {
        cwd: root,
        env: { PATH: '/usr/bin:/bin' },
        input: JSON.stringify({ Secret: 'fixture-sensitive-value' }),
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(status);
    expect(result.stdout).toBe(output);
    expect(result.stdout + result.stderr).not.toContain('fixture-sensitive-value');
  });
});
