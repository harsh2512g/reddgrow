import { describe, expect, it } from 'vitest';
import {
  PLANS,
  getPlan,
  isTrialExpired,
  hasOrganizationPermission,
  canManageMember,
  planKeySchema,
  organizationRoleSchema,
} from '../src/index.js';

describe('central plans and organization permissions', () => {
  it('matches the promised trial and paid limits', () => {
    expect(PLANS.trial.trialDays).toBe(7);
    expect(PLANS.trial.limits).toEqual({
      organizations: 1,
      brands: 1,
      monitoredSubreddits: 3,
      opportunities: 20,
      aiDrafts: 10,
      members: 1,
    });
    expect([getPlan('solo').monthlyPriceUsd, getPlan('growth').monthlyPriceUsd]).toEqual([29, 79]);
    expect([PLANS.solo.limits.members, PLANS.growth.limits.members]).toEqual([1, 5]);
    expect(PLANS.growth.limits).toEqual({
      organizations: 1,
      brands: 3,
      monitoredSubreddits: 40,
      opportunities: 500,
      aiDrafts: 300,
      members: 5,
    });
  });
  it('treats the expiry instant and malformed expiry as expired', () => {
    const now = new Date('2026-09-15T00:00:00Z');
    expect(isTrialExpired('2026-09-15T00:00:00Z', now)).toBe(true);
    expect(isTrialExpired('2026-09-16T00:00:00Z', now)).toBe(false);
    expect(isTrialExpired('invalid', now)).toBe(true);
    expect(isTrialExpired(null, now)).toBe(false);
  });
  it('keeps billing and ownership exclusive to owners', () => {
    for (const role of organizationRoleSchema.options) {
      expect(hasOrganizationPermission(role, 'manage_billing')).toBe(role === 'owner');
      expect(hasOrganizationPermission(role, 'request_data')).toBe(role === 'owner');
      expect(hasOrganizationPermission(role, 'manage_members')).toBe(
        role === 'owner' || role === 'admin',
      );
    }
    expect(canManageMember('admin', 'owner')).toBe(false);
    expect(canManageMember('admin', 'member')).toBe(true);
    expect(canManageMember('viewer', 'viewer')).toBe(false);
    expect(planKeySchema.safeParse('enterprise').success).toBe(false);
  });
});
