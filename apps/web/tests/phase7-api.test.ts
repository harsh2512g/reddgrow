// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  rpc: vi.fn(),
  context: vi.fn(),
  rate: vi.fn(),
  db: vi.fn(),
  provider: vi.fn(),
  mode: 'mock' as 'mock' | 'stripe',
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/phase7/server', () => ({ billingEnabled: mocks.enabled }));
vi.mock('@/lib/phase7/database', () => ({ billingDatabase: mocks.db }));
vi.mock('@/lib/organizations/server', () => ({ requireOrganization: mocks.context }));
vi.mock('@/lib/phase6/rate-limit', () => ({ enforceAttributionLimit: mocks.rate }));
vi.mock('@/lib/env/server', () => ({
  getServerEnv: () => ({
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
    BILLING_PROVIDER: mocks.mode,
    EMAIL_PROVIDER: 'console',
  }),
}));
import {
  billingRoute,
  checkout,
  completeMockCheckout,
  portal,
  notificationPreferences,
  readSubscription,
} from '../src/lib/phase7/api';
const org = '70000000-0000-4000-8000-000000000001',
  user = '70000000-0000-4000-8000-000000000002',
  id = '70000000-0000-4000-8000-000000000003';
const subscription = {
  organization_id: org,
  provider: 'mock',
  plan_key: 'solo',
  status: 'active',
  period_start: '2026-09-01T00:00:00Z',
  period_end: '2026-10-01T00:00:00Z',
  cancel_at_period_end: false,
  grace_ends_at: null,
  trial_ends_at: null,
  can_manage: true,
  active: true,
  billing_email: 'owner@example.com',
  customer_id: null,
  subscription_id: null,
};
function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://127.0.0.1:3000/api/billing/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:3000',
      Host: '127.0.0.1:3000',
      'x-threadsignal-organization': org,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  mocks.mode = 'mock';
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.rate.mockResolvedValue(undefined);
  mocks.context.mockResolvedValue({
    organization: { id: org, role: 'owner' },
    user: { id: user },
    supabase: { rpc: mocks.rpc },
  });
  mocks.rpc.mockResolvedValue({ data: subscription, error: null });
  mocks.db.mockResolvedValue(subscription);
});
describe('Phase7 billing and preference request boundaries', () => {
  it('rejects a cross-workspace query on read endpoints before SQL', async () => {
    const request = new Request(
      `http://127.0.0.1:3000/api/billing/subscription?organizationId=${id}`,
    );
    expect((await billingRoute(() => readSubscription(request))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['expired', 'completed'])(
    'never opens Stripe checkout from a %s local request',
    async (status) => {
      mocks.mode = 'stripe';
      mocks.rpc.mockImplementation(async (name: string) => ({
        data:
          name === 'get_billing_subscription'
            ? subscription
            : {
                id,
                organization_id: org,
                plan_key: 'solo',
                provider: 'stripe',
                status,
                expires_at: '2000-01-01T00:00:00Z',
              },
        error: null,
      }));
      const response = await billingRoute(() =>
        checkout(req({ planKey: 'solo', idempotencyKey: id })),
      );
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('BILLING_REQUEST_EXPIRED');
      expect(mocks.db).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['CHECKOUT_EXPIRED', 409],
    ['BILLING_RATE_LIMIT', 429],
    ['MOCK_BILLING_ONLY', 409],
  ])('maps safe database failure %s to its actionable response', async (message, status) => {
    mocks.db.mockRejectedValue({ message });
    expect((await billingRoute(() => completeMockCheckout(req({ requestId: id })))).status).toBe(
      status,
    );
  });
  it('fails closed before authentication or SQL outside the verified runtime', async () => {
    mocks.enabled.mockReturnValue(false);
    expect(
      (await billingRoute(() => checkout(req({ planKey: 'solo', idempotencyKey: id })))).status,
    ).toBe(503);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['admin', 'member', 'viewer'])(
    'rejects %s billing writes before allocating a checkout',
    async (role) => {
      mocks.context.mockResolvedValue({
        organization: { id: org, role },
        user: { id: user },
        supabase: { rpc: mocks.rpc },
      });
      expect(
        (await billingRoute(() => checkout(req({ planKey: 'growth', idempotencyKey: id })))).status,
      ).toBe(403);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it('rejects a cross-origin checkout', async () => {
    expect(
      (
        await billingRoute(() =>
          checkout(
            req({ planKey: 'solo', idempotencyKey: id }, { Origin: 'https://attacker.example' }),
          ),
        )
      ).status,
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects stale or forged workspace selection', async () => {
    expect(
      (
        await billingRoute(() =>
          checkout(
            req({ planKey: 'solo', idempotencyKey: id }, { 'x-threadsignal-organization': id }),
          ),
        )
      ).status,
    ).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { planKey: 'enterprise', idempotencyKey: id },
    { planKey: 'solo', idempotencyKey: id, organizationId: id },
    { planKey: 'solo', idempotencyKey: id, priceId: 'price_attacker' },
    { planKey: 'solo', idempotencyKey: 'bad' },
  ])('rejects client-controlled entitlements and malformed requests', async (body) => {
    expect((await billingRoute(() => checkout(req(body)))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('allocates durable mock checkout using the verified organization and never calls payment SQL bridge', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'get_billing_subscription'
          ? subscription
          : {
              id,
              organization_id: org,
              plan_key: 'solo',
              provider: 'mock',
              status: 'pending',
              expires_at: '2026-09-19T12:00:00Z',
            },
      error: null,
    }));
    const response = await billingRoute(() =>
      checkout(req({ planKey: 'solo', idempotencyKey: id })),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.url).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith('begin_billing_checkout', {
      p_organization_id: org,
      p_plan_key: 'solo',
      p_idempotency_key: id,
      p_provider: 'mock',
    });
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it('completes only an existing request; does not accept a browser-supplied plan', async () => {
    expect(
      (await billingRoute(() => completeMockCheckout(req({ requestId: id, planKey: 'growth' }))))
        .status,
    ).toBe(400);
    expect((await billingRoute(() => completeMockCheckout(req({ requestId: id })))).status).toBe(
      200,
    );
    expect(mocks.db).toHaveBeenCalledWith('completeMock', [org, id], user);
  });
  it('uses a bounded allowlist for mock lifecycle actions', async () => {
    expect((await billingRoute(() => portal(req({ action: 'delete_customer' })))).status).toBe(400);
    expect((await billingRoute(() => portal(req({ action: 'cancel' })))).status).toBe(200);
    expect(mocks.db).toHaveBeenCalledWith('manageMock', [org, 'cancel'], user);
  });
  it('rejects body sizes before parsing', async () => {
    expect(
      (
        await billingRoute(() =>
          checkout(req({ planKey: 'solo', idempotencyKey: id, padding: 'x'.repeat(9000) })),
        )
      ).status,
    ).toBe(413);
  });
  it('does not echo SQL/provider error data', async () => {
    mocks.db.mockRejectedValue({ message: 'provider sensitive payload secretfixture' });
    const response = await billingRoute(() => completeMockCheckout(req({ requestId: id })));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secretfixture');
  });
  it('allows viewers to change their own preferences; identity comes from authenticated SQL claims', async () => {
    mocks.context.mockResolvedValue({
      organization: { id: org, role: 'viewer' },
      user: { id: user },
      supabase: { rpc: mocks.rpc },
    });
    const preferences = {
      categories: {
        welcome: true,
        invitation: true,
        ingestion_complete: true,
        ingestion_failed: true,
        daily_digest: false,
        high_score_alert: false,
        trial_ending: true,
        usage_limit: true,
        payment_failed: true,
        subscription_changed: true,
      },
      digest_time: '09:00',
      minimum_score: 85,
      quiet_start: '22:00',
      quiet_end: '08:00',
      timezone: 'UTC',
    };
    mocks.rpc.mockResolvedValue({ data: preferences, error: null });
    expect((await billingRoute(() => notificationPreferences(req(preferences)))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('set_notification_preferences', {
      p_organization_id: org,
      p_preferences: preferences,
    });
    expect(
      (await billingRoute(() => notificationPreferences(req({ ...preferences, user_id: id }))))
        .status,
    ).toBe(400);
  });
});
