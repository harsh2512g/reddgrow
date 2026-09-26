import { root, dockerSocketFor } from './isolation.mjs';

export const projectDockerSocket = `unix://${dockerSocketFor(root)}`;
export const serviceDefinitions = {
  database: { name: 'supabase_db_threadsignal', containerPort: '5432/tcp', hostPort: '54322' },
  redis: { name: 'threadsignal-redis-1', containerPort: '6379/tcp', hostPort: '56379' },
};

// Request exactly operational metadata; never inspect or return container environment fields.
export const ownershipInspectFormat =
  '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}';

const fullContainerId = /^[0-9a-f]{64}$/;
const localBindings = new Set(['127.0.0.1', '0.0.0.0', '::1', '::']);

function validateContainer(raw, definition, expectedId) {
  const data = JSON.parse(raw);
  if (
    !data ||
    typeof data.id !== 'string' ||
    !fullContainerId.test(data.id) ||
    (expectedId !== undefined && data.id !== expectedId) ||
    data.name !== `/${definition.name}` ||
    data.running !== true
  ) {
    throw new Error('Project service identity is not current.');
  }
  const bindings = data.ports?.[definition.containerPort];
  if (
    !Array.isArray(bindings) ||
    !bindings.some(
      (binding) =>
        binding && binding.HostPort === definition.hostPort && localBindings.has(binding.HostIp),
    )
  ) {
    throw new Error('Project service port binding is not current.');
  }
  return data.id;
}

function validateMarker(marker) {
  if (
    !marker ||
    marker.version !== 1 ||
    marker.dockerSocket !== projectDockerSocket ||
    typeof marker.databaseContainerId !== 'string' ||
    !fullContainerId.test(marker.databaseContainerId) ||
    typeof marker.redisContainerId !== 'string' ||
    !fullContainerId.test(marker.redisContainerId) ||
    marker.databaseContainerId === marker.redisContainerId
  ) {
    throw new Error('Project service ownership is missing or invalid.');
  }
}

/** Called only after successful startup; the adapter first verifies the exact project socket. */
export function recordServiceOwnership(adapter) {
  try {
    adapter.verifyDocker();
    const databaseContainerId = validateContainer(
      adapter.inspectContainer(serviceDefinitions.database.name),
      serviceDefinitions.database,
    );
    const redisContainerId = validateContainer(
      adapter.inspectContainer(serviceDefinitions.redis.name),
      serviceDefinitions.redis,
    );
    const marker = {
      version: 1,
      dockerSocket: projectDockerSocket,
      databaseContainerId,
      redisContainerId,
    };
    validateMarker(marker);
    return marker;
  } catch {
    throw new Error('Could not record ownership of the running project services.');
  }
}

/** A stale marker disables service access. Verification never opens a host TCP connection. */
export function verifyServiceOwnership(marker, adapter) {
  try {
    // Reject missing/stale shapes before any Docker command or filesystem socket access.
    validateMarker(marker);
    adapter.verifyDocker();
    validateContainer(
      adapter.inspectContainer(marker.databaseContainerId),
      serviceDefinitions.database,
      marker.databaseContainerId,
    );
    validateContainer(
      adapter.inspectContainer(marker.redisContainerId),
      serviceDefinitions.redis,
      marker.redisContainerId,
    );
    return true;
  } catch {
    return false;
  }
}
