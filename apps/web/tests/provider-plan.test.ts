// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ organization: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/organizations/server', () => ({ requireOrganization: mocks.organization }));
import { requireActiveProviderPlan } from '../src/lib/provider-plan';
const org = '10000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.organization.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
});
describe('Supabase provider admission', () => {
  it.each(['active', 'trialing', 'past_due'])(
    'honors database eligibility for %s',
    async (status) => {
      mocks.rpc.mockResolvedValue({
        data: { organization_id: org, active: true, status, plan_key: 'solo' },
        error: null,
      });
      expect(await requireActiveProviderPlan(org)).toMatchObject({ plan_key: 'solo' });
      expect(mocks.organization).toHaveBeenCalledWith(org);
      expect(mocks.rpc).toHaveBeenCalledWith('get_billing_subscription', {
        p_organization_id: org,
      });
    },
  );
  it.each(['expired', 'past_due', 'canceled', 'paused'])(
    'rejects ineligible %s plans',
    async (status) => {
      mocks.rpc.mockResolvedValue({
        data: { organization_id: org, active: false, status, plan_key: 'trial' },
        error: null,
      });
      await expect(requireActiveProviderPlan(org)).rejects.toMatchObject({
        code: status === 'expired' ? 'TRIAL_EXPIRED' : 'PLAN_INACTIVE',
        status: 409,
      });
    },
  );
  it.each([
    null,
    [],
    { active: true },
    { organization_id: 'different', active: true, status: 'active', plan_key: 'solo' },
  ])('fails closed on missing or malformed authority', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(requireActiveProviderPlan(org)).rejects.toMatchObject({
      code: 'PLAN_UNAVAILABLE',
      status: 503,
    });
  });
  it('does not trust a payload accompanying a failed database read', async () => {
    mocks.rpc.mockResolvedValue({
      data: { organization_id: org, active: true, status: 'active', plan_key: 'growth' },
      error: { message: 'private upstream detail' },
    });
    await expect(requireActiveProviderPlan(org)).rejects.toThrow('PLAN_UNAVAILABLE');
  });
});
