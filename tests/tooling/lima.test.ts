import { describe, expect, it } from 'vitest';
import { limaOverrideConfiguration } from '../../scripts/lima.mjs';

describe('project Lima forwarding override', () => {
  it('forwards only the Supabase and Redis TCP ranges to host loopback', () => {
    const rules = limaOverrideConfiguration().portForwards.filter((rule) => 'hostIP' in rule);
    expect(rules).toHaveLength(8);
    expect([...new Set(rules.map((rule) => rule.guestIP))]).toEqual([
      '0.0.0.0',
      '127.0.0.1',
      '::',
      '::1',
    ]);
    for (const rule of rules) {
      expect(rule.hostIP).toBe('127.0.0.1');
      expect(rule.proto).toBe('tcp');
      expect([
        [54320, 54324],
        [56379, 56379],
      ]).toContainEqual(rule.guestPortRange);
      expect(rule.hostPortRange).toEqual(rule.guestPortRange);
      expect(rule.guestPortRange[0]).toBeGreaterThan(1024);
    }
  });

  it('ignores all remaining IPv4/IPv6 TCP and UDP ports after the specific rules', () => {
    const rules = limaOverrideConfiguration().portForwards;
    expect(rules.slice(-4)).toEqual(
      ['0.0.0.0', '::'].flatMap((guestIP) =>
        ['tcp', 'udp'].map((proto) => ({
          guestIP,
          guestIPMustBeZero: false,
          guestPortRange: [1, 65535],
          proto,
          ignore: true,
        })),
      ),
    );
    expect(rules.slice(0, -4).every((rule) => 'hostIP' in rule)).toBe(true);
  });

  it('inherits generated Unix sockets without creating duplicate forwarders', () => {
    for (const rule of limaOverrideConfiguration().portForwards) {
      expect(rule).not.toHaveProperty('guestSocket');
      expect(rule).not.toHaveProperty('hostSocket');
    }
  });

  it('uses Lima’s guestIPMustBeZero flag only with the IPv4 wildcard address', () => {
    for (const rule of limaOverrideConfiguration().portForwards) {
      if ('guestIPMustBeZero' in rule && rule.guestIPMustBeZero === true) {
        expect(rule.guestIP).toBe('0.0.0.0');
      }
    }
  });

  it('keeps host mounts, host public keys and agent forwarding disabled', () => {
    expect(limaOverrideConfiguration()).toMatchObject({
      mounts: [],
      ssh: { loadDotSSHPubKeys: false, forwardAgent: false },
    });
  });
});
