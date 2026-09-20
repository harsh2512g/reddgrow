import { describe, expect, it } from 'vitest';
import {
  actionFailure,
  organizationInputSchema,
  inviteInputSchema,
  tokenSchema,
} from '../src/lib/organizations/schema';

describe('organization boundary inputs', () => {
  const valid = {
    name: 'Signal Studio',
    slug: 'signal-studio',
    billingEmail: 'owner@example.test',
    timezone: 'Asia/Kolkata',
    currency: 'USD',
  };
  it('rejects malformed workspace names, URLs, time zones and currencies', () => {
    for (const fields of [
      { name: 'x' },
      { slug: '../another-org' },
      { timezone: 'private/secret' },
      { billingEmail: 'invalid' },
      { currency: 'US' },
    ]) {
      expect(organizationInputSchema.safeParse({ ...valid, ...fields }).success).toBe(false);
    }
  });
  it('canonicalizes IANA time zones and rejects offset-only input', () => {
    expect(organizationInputSchema.parse({ ...valid, timezone: 'utc' }).timezone).toBe('UTC');
    expect(organizationInputSchema.safeParse({ ...valid, timezone: '+05:30' }).success).toBe(false);
  });
  it('normalizes invitations while rejecting owner escalation', () => {
    expect(inviteInputSchema.parse({ email: ' Person@Example.test ', role: 'viewer' }).email).toBe(
      'person@example.test',
    );
    expect(
      inviteInputSchema.safeParse({ email: 'person@example.test', role: 'owner' }).success,
    ).toBe(false);
    expect(tokenSchema.safeParse('../forged').success).toBe(false);
  });
  it('shows actionable limits without leaking database errors or invitation tokens', () => {
    expect(actionFailure({ message: 'SEAT_LIMIT' }).message).toContain('available seats');
    const error = {
      message: 'password=private-token recipient@example.test',
      code: 'XX001',
      detail: 'private-token',
    };
    expect(JSON.stringify(actionFailure(error))).not.toMatch(/private-token|recipient@|XX001/);
  });
});
