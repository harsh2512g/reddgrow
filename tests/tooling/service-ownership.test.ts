import { describe, expect, it, vi } from 'vitest';
import {
  ownershipInspectFormat,
  projectDockerSocket,
  recordServiceOwnership,
  serviceDefinitions,
  verifyServiceOwnership,
} from '../../scripts/service-ownership.mjs';

const databaseContainerId = 'a'.repeat(64);
const redisContainerId = 'b'.repeat(64);
const marker = {
  version: 1,
  dockerSocket: projectDockerSocket,
  databaseContainerId,
  redisContainerId,
};

function container(service: 'database' | 'redis', overrides: Record<string, unknown> = {}) {
  const definition = serviceDefinitions[service];
  return JSON.stringify({
    id: service === 'database' ? databaseContainerId : redisContainerId,
    name: `/${definition.name}`,
    running: true,
    ports: { [definition.containerPort]: [{ HostIp: '127.0.0.1', HostPort: definition.hostPort }] },
    ...overrides,
  });
}

function adapter() {
  return {
    verifyDocker: vi.fn(),
    inspectContainer: vi.fn((reference: string) =>
      reference === databaseContainerId || reference === serviceDefinitions.database.name
        ? container('database')
        : container('redis'),
    ),
  };
}

describe('project service ownership', () => {
  it('records full IDs from the expected running containers after socket verification', () => {
    const current = adapter();
    expect(recordServiceOwnership(current)).toEqual(marker);
    expect(current.verifyDocker).toHaveBeenCalledOnce();
    expect(current.inspectContainer.mock.calls.map(([reference]) => reference)).toEqual([
      serviceDefinitions.database.name,
      serviceDefinitions.redis.name,
    ]);
  });

  it('verifies recorded immutable IDs, expected names and port bindings', () => {
    const current = adapter();
    expect(verifyServiceOwnership(marker, current)).toBe(true);
    expect(current.inspectContainer.mock.calls.map(([reference]) => reference)).toEqual([
      databaseContainerId,
      redisContainerId,
    ]);
  });

  it.each([
    undefined,
    null,
    {},
    { ...marker, version: 2 },
    { ...marker, dockerSocket: 'unix:///unaccessed-outside-socket' },
    { ...marker, databaseContainerId: 'short-id' },
    { ...marker, redisContainerId: databaseContainerId },
  ])('rejects missing or invalid ownership before any Docker call', (invalid) => {
    const current = adapter();
    expect(verifyServiceOwnership(invalid, current)).toBe(false);
    expect(current.verifyDocker).not.toHaveBeenCalled();
    expect(current.inspectContainer).not.toHaveBeenCalled();
  });

  it('does not inspect containers through a failed or unrelated Docker context', () => {
    const current = adapter();
    current.verifyDocker.mockImplementation(() => {
      throw new Error('wrong socket');
    });
    expect(verifyServiceOwnership(marker, current)).toBe(false);
    expect(current.inspectContainer).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'c'.repeat(64) },
    { name: '/unrelated-container' },
    { running: false },
    { ports: {} },
    { ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5432' }] } },
    { ports: { '5432/tcp': [{ HostIp: '192.0.2.1', HostPort: '54322' }] } },
  ])(
    'rejects changed identity, state or ports without inspecting further containers',
    (overrides) => {
      const current = adapter();
      current.inspectContainer.mockReturnValue(container('database', overrides));
      expect(verifyServiceOwnership(marker, current)).toBe(false);
      expect(current.inspectContainer).toHaveBeenCalledOnce();
    },
  );

  it('requests operational Docker metadata without container environment fields', () => {
    expect(ownershipInspectFormat).toContain('.NetworkSettings.Ports');
    expect(ownershipInspectFormat).not.toMatch(/\.Config|\.Env|secret|password|token/i);
  });

  it('does not expose malformed Docker metadata in recording errors', () => {
    const current = adapter();
    current.inspectContainer.mockReturnValue('fixture-sensitive-value invalid json');
    expect(() => recordServiceOwnership(current)).toThrow('Could not record ownership');
    expect(() => recordServiceOwnership(current)).not.toThrow('fixture-sensitive-value');
  });
});
