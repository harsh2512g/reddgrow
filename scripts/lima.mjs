import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { assertInside } from './isolation.mjs';

export function limaOverrideConfiguration() {
  const network = ['0.0.0.0', '127.0.0.1', '::', '::1'].flatMap((guestIP) =>
    [
      [54320, 54324],
      [56379, 56379],
    ].map((ports) => ({
      guestIP,
      ...(guestIP === '0.0.0.0' ? { guestIPMustBeZero: true } : {}),
      guestPortRange: ports,
      hostIP: '127.0.0.1',
      hostPortRange: ports,
      proto: 'tcp',
    })),
  );
  const ignored = ['0.0.0.0', '::'].flatMap((guestIP) =>
    ['tcp', 'udp'].map((proto) => ({
      guestIP,
      guestIPMustBeZero: false,
      guestPortRange: [1, 65535],
      proto,
      ignore: true,
    })),
  );

  return {
    ssh: { loadDotSSHPubKeys: false, forwardAgent: false },
    mounts: [],
    // First match wins: project TCP ports, then reject every other TCP/UDP port
    // before Colima's generated catch-all rules. This excludes privileged ports
    // and their host forwarding helpers. IPv4-mapped IPv6 is matched as IPv4.
    // Lima merges the generated socket rules; duplicating them breaks sockets.
    portForwards: [...network, ...ignored],
  };
}

export function prepareLimaConfiguration(limaHome) {
  const directory = assertInside(join(limaHome, '_config'));
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    assertInside(join(directory, 'override.yaml')),
    stringify(limaOverrideConfiguration()),
  );
}
