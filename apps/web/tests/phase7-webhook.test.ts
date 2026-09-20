// @vitest-environment node
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BillingProviderError,
  STRIPE_API_VERSION,
  StripeBillingProvider,
  type BillingSubscription,
  type BillingWebhookEvent,
} from '@threadsignal/billing';

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  env: vi.fn(),
  provider: vi.fn(),
  verify: vi.fn(),
  retrieve: vi.fn(),
  reconcile: vi.fn(),
  persist: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/env/server', () => ({ getServerEnv: mocks.env }));
vi.mock('@/lib/phase7/server', () => ({ billingEnabled: mocks.enabled }));
vi.mock('@/lib/phase7/api', () => ({ billingProvider: mocks.provider }));
vi.mock('@/lib/phase7/database', () => ({ reconcileBilling: mocks.reconcile }));
import { billingWebhook } from '../src/lib/phase7/webhook';

const organizationId = '70000000-0000-4000-8000-000000000001';
const otherOrganizationId = '70000000-0000-4000-8000-000000000002';
const now = new Date('2026-09-19T12:00:00.000Z');
const timestamp = now.getTime() / 1000;
const webhookSecret = ['whsec', 'syntheticfixtureonly'].join('_');
const forbiddenTransport = vi.fn<typeof fetch>(async () => {
  throw new Error('External transport is forbidden in this suite');
});
const signatureAdapter = new StripeBillingProvider({
  secretKey: ['sk', 'test', 'syntheticfixtureonly'].join('_'),
  webhookSecret,
  priceIds: { solo: 'price_Solo', growth: 'price_Growth' },
  appOrigin: 'http://127.0.0.1:3000',
  fetch: forbiddenTransport,
});
const snapshot: BillingSubscription = {
  id: 'sub_Fixture',
  customerId: 'cus_Fixture',
  organizationId,
  planKey: 'solo',
  status: 'active',
  currentPeriodStart: now.toISOString(),
  currentPeriodEnd: '2026-10-19T12:00:00.000Z',
  cancelAtPeriodEnd: false,
  trialEndsAt: null,
};
function body(
  type = 'customer.subscription.updated',
  object: unknown = {
    id: snapshot.id,
    customer: snapshot.customerId,
    metadata: { organization_id: organizationId },
  },
) {
  return JSON.stringify({
    id: 'evt_Fixture',
    created: timestamp,
    api_version: STRIPE_API_VERSION,
    livemode: false,
    type,
    data: { object },
  });
}
function signature(raw: string, time = timestamp) {
  return `t=${time},v1=${createHmac('sha256', webhookSecret).update(`${time}.${raw}`).digest('hex')}`;
}
function request(raw = body(), headers: Record<string, string> = {}, query = '') {
  return new Request(`http://127.0.0.1:3000/api/billing/webhook${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature(raw), ...headers },
    body: raw,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.env.mockReturnValue({ BILLING_PROVIDER: 'stripe' });
  mocks.verify.mockImplementation((raw: string, header: string) =>
    signatureAdapter.verifyWebhook(raw, header, now),
  );
  mocks.retrieve.mockResolvedValue(snapshot);
  mocks.persist.mockResolvedValue({ status: 'applied' });
  mocks.reconcile.mockImplementation(
    async (_organizationId: string, readSnapshot: () => Promise<unknown>) =>
      mocks.persist(await readSnapshot()),
  );
  mocks.provider.mockReturnValue({
    verifyWebhook: mocks.verify,
    retrieveSubscription: mocks.retrieve,
  });
});

describe('Phase 7 webhook HTTP boundary', () => {
  it('verifies the exact raw body before provider lookup, locking or persistence', async () => {
    const raw = `  ${body()}\n`;
    const response = await billingWebhook(request(raw));
    expect(response.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith(raw, signature(raw));
    expect(mocks.verify.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reconcile.mock.invocationCallOrder[0]!,
    );
    expect(mocks.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.retrieve.mock.invocationCallOrder[0]!,
    );
    expect(mocks.retrieve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.persist.mock.invocationCallOrder[0]!,
    );
    expect(mocks.persist).toHaveBeenCalledWith({
      provider: 'stripe',
      eventId: 'evt_Fixture',
      eventCreatedAt: now.toISOString(),
      checkoutSessionId: null,
      subscription: snapshot,
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(forbiddenTransport).not.toHaveBeenCalled();
  });
  it.each(['signature', 'body', 'expired', 'missing'])(
    'refuses %s tampering/replay before any database or subscription access',
    async (kind) => {
      const raw = body();
      const headers = {
        'Stripe-Signature':
          kind === 'expired'
            ? signature(raw, timestamp - 301)
            : kind === 'missing'
              ? ''
              : kind === 'signature'
                ? `t=${timestamp},v1=${'0'.repeat(64)}`
                : signature(raw),
      };
      const response = await billingWebhook(request(kind === 'body' ? `${raw} ` : raw, headers));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('INVALID_WEBHOOK');
      expect(mocks.retrieve).not.toHaveBeenCalled();
      expect(mocks.reconcile).not.toHaveBeenCalled();
      expect(mocks.persist).not.toHaveBeenCalled();
    },
  );
  it('does not remove a byte-order mark before signature verification', async () => {
    const raw = body();
    const response = await billingWebhook(
      request(`\uFEFF${raw}`, { 'Stripe-Signature': signature(raw) }),
    );
    expect(response.status).toBe(400);
    expect(mocks.verify).toHaveBeenCalledWith(`\uFEFF${raw}`, signature(raw));
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it.each(['mock', 'disabled'])('fails closed when the selected runtime is %s', async (mode) => {
    if (mode === 'mock') mocks.env.mockReturnValue({ BILLING_PROVIDER: 'mock' });
    else mocks.enabled.mockReturnValue(false);
    const response = await billingWebhook(request());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'WEBHOOK_DISABLED' } });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it.each(['organizationId', 'customerId', 'id'] as const)(
    'refuses a subscription %s mismatch before publishing the snapshot',
    async (field) => {
      mocks.retrieve.mockResolvedValue({
        ...snapshot,
        [field]: field === 'organizationId' ? otherOrganizationId : `${snapshot[field]}Other`,
      });
      const response = await billingWebhook(request());
      expect(response.status).toBe(400);
      expect(mocks.persist).not.toHaveBeenCalled();
    },
  );
  it('resolves missing invoice metadata from the provider then re-fetches inside the organization lock', async () => {
    const raw = body('invoice.payment_failed', {
      customer: 'cus_Fixture',
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: 'sub_Fixture' },
      },
    });
    const response = await billingWebhook(request(raw));
    expect(response.status).toBe(200);
    expect(mocks.retrieve).toHaveBeenCalledTimes(2);
    expect(mocks.retrieve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reconcile.mock.invocationCallOrder[0]!,
    );
    expect(mocks.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.retrieve.mock.invocationCallOrder[1]!,
    );
    expect(mocks.reconcile).toHaveBeenCalledWith(organizationId, expect.any(Function));
  });
  it('cannot move an invoice to another organization between lookup and locked reconciliation', async () => {
    const raw = body('invoice.paid', {
      customer: 'cus_Fixture',
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: 'sub_Fixture' },
      },
    });
    mocks.retrieve
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, organizationId: otherOrganizationId });
    expect((await billingWebhook(request(raw))).status).toBe(400);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it('returns the durable duplicate outcome for a valid repeated event', async () => {
    mocks.persist
      .mockResolvedValueOnce({ status: 'applied' })
      .mockResolvedValueOnce({ status: 'duplicate' });
    const first = await billingWebhook(request());
    const second = await billingWebhook(request());
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ received: true, result: { status: 'duplicate' } });
    expect(mocks.persist.mock.calls[0]?.[0]).toEqual(mocks.persist.mock.calls[1]?.[0]);
  });
  it('binds checkout to signed metadata and the provider subscription, ignoring browser query, cookie and headers', async () => {
    const raw = body('checkout.session.completed', {
      id: 'cs_test_Fixture',
      mode: 'subscription',
      subscription: 'sub_Fixture',
      customer: 'cus_Fixture',
      metadata: { organization_id: organizationId },
    });
    const response = await billingWebhook(
      request(
        raw,
        {
          'x-threadsignal-organization': otherOrganizationId,
          Cookie: `organization=${otherOrganizationId}`,
        },
        `?organizationId=${otherOrganizationId}&checkout=returned`,
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalledWith(organizationId, expect.any(Function));
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutSessionId: 'cs_test_Fixture',
        subscription: expect.objectContaining({ organizationId }),
      }),
    );
  });
  it('does not treat a browser success-return payload as a webhook', async () => {
    const response = await billingWebhook(
      request(JSON.stringify({ checkout: 'returned', organizationId, planKey: 'growth' }), {
        'Stripe-Signature': '',
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it('acknowledges unrelated signed events without creating an entitlement update', async () => {
    const raw = body('payment_intent.succeeded', { id: 'pi_Fixture' });
    const response = await billingWebhook(request(raw));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, ignored: true });
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it.each(['declared', 'streamed'])(
    'rejects an oversized %s body before cryptography and SQL',
    async (kind) => {
      const response = await billingWebhook(
        request(
          kind === 'streamed' ? 'x'.repeat(262_145) : body(),
          kind === 'declared' ? { 'Content-Length': '262145' } : {},
        ),
      );
      expect(response.status).toBe(413);
      expect(mocks.verify).not.toHaveBeenCalled();
      expect(mocks.reconcile).not.toHaveBeenCalled();
    },
  );
  it('rejects non-JSON media types before signature verification', async () => {
    expect((await billingWebhook(request(body(), { 'Content-Type': 'text/plain' }))).status).toBe(
      400,
    );
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('rejects invalid UTF-8 as an invalid webhook without invoking the provider', async () => {
    const response = await billingWebhook(
      new Request('http://127.0.0.1:3000/api/billing/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: new Uint8Array([0xc3, 0x28]),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('returns safe retryable failure for provider unavailability without writing SQL', async () => {
    mocks.retrieve.mockRejectedValue(new BillingProviderError('BILLING_UNAVAILABLE', true));
    const response = await billingWebhook(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('UNAVAILABLE');
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it('never echoes a raw SQL/provider error or logs its payload', async () => {
    const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')];
    mocks.persist.mockRejectedValue(new Error('private customer record and synthetic secret'));
    const response = await billingWebhook(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('synthetic secret');
    expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
    expect(forbiddenTransport).not.toHaveBeenCalled();
  });
  it('requires a UUID organization even if a provider violates its interface', async () => {
    const invalid: BillingWebhookEvent = {
      id: 'evt_Fixture',
      created: timestamp,
      type: 'customer.subscription.updated',
      subscriptionId: 'sub_Fixture',
      customerId: 'cus_Fixture',
      organizationId: 'invalid',
      checkoutId: null,
    };
    mocks.verify.mockReturnValue(invalid);
    expect((await billingWebhook(request())).status).toBe(400);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
