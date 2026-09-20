import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  BillingProviderError,
  MockBillingProvider,
  STRIPE_API_VERSION,
  StripeBillingProvider,
  type StripeBillingOptions,
} from '../src/index.js';

const organizationId = 'b822f52a-bd34-49a8-8a1b-bebfa634aa36';
// Synthetic values assembled here are never loaded from environment or used against a network.
const options = {
  secretKey: ['sk', 'test', 'syntheticfixtureonly'].join('_'),
  webhookSecret: ['whsec', 'syntheticfixtureonly'].join('_'),
  priceIds: { solo: 'price_Solo', growth: 'price_Growth' },
  appOrigin: 'http://127.0.0.1:3000',
};
const now = new Date('2026-09-19T12:00:00.000Z');
const time = now.getTime() / 1000;
const checkout = {
  organizationId,
  planKey: 'solo' as const,
  successUrl: `${options.appOrigin}/app/settings/billing?success=1`,
  cancelUrl: `${options.appOrigin}/app/settings/billing`,
  idempotencyKey: 'fixture_checkout_1',
};
const subscription = () => ({
  id: 'sub_Fixture',
  customer: 'cus_Fixture',
  status: 'active',
  metadata: { organization_id: organizationId },
  cancel_at_period_end: false,
  trial_end: null,
  items: {
    has_more: false,
    data: [
      {
        quantity: 1,
        current_period_start: time,
        current_period_end: time + 30 * 86400,
        price: {
          id: 'price_Solo',
          currency: 'usd',
          unit_amount: 2900,
          recurring: { interval: 'month', interval_count: 1 },
        },
      },
    ],
  },
});
function event(
  type = 'customer.subscription.updated',
  object: unknown = subscription(),
  overrides: Record<string, unknown> = {},
) {
  return JSON.stringify({
    id: 'evt_Fixture',
    created: time,
    livemode: false,
    api_version: STRIPE_API_VERSION,
    type,
    data: { object },
    ...overrides,
  });
}
function sign(body: string, timestamp = time) {
  return `t=${timestamp},v1=${createHmac('sha256', options.webhookSecret).update(`${timestamp}.${body}`).digest('hex')}`;
}
function provider(body: unknown, status = 200) {
  const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
  return { adapter: new StripeBillingProvider({ ...options, fetch: transport }), transport };
}

describe('Stripe billing adapter', () => {
  it('constructs without network calls and maps only server-owned prices and metadata', async () => {
    const { adapter, transport } = provider({
      id: 'cs_test_Fixture',
      url: 'https://checkout.stripe.com/c/pay/cs_test_Fixture',
    });
    expect(transport).not.toHaveBeenCalled();
    await adapter.createCheckout(checkout);
    await adapter.createCheckout(checkout);
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toMatchObject({
      'Stripe-Version': STRIPE_API_VERSION,
      'Idempotency-Key': checkout.idempotencyKey,
    });
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('mode')).toBe('subscription');
    expect(body.get('line_items[0][price]')).toBe('price_Solo');
    expect(body.get('line_items[0][quantity]')).toBe('1');
    expect(body.get('subscription_data[metadata][organization_id]')).toBe(organizationId);
    expect(transport.mock.calls[1]?.[1]?.body).toBe(init?.body);
  });
  it('creates customer-bound portal and optionally reuses a checkout customer', async () => {
    const { adapter, transport } = provider({
      id: 'bps_Fixture',
      url: 'https://billing.stripe.com/p/session/fixture',
    });
    await adapter.createPortal({
      organizationId,
      customerId: 'cus_Fixture',
      returnUrl: checkout.cancelUrl,
      idempotencyKey: 'portal_1',
    });
    expect(new URLSearchParams(String(transport.mock.calls[0]?.[1]?.body)).get('customer')).toBe(
      'cus_Fixture',
    );
    const second = provider({
      id: 'cs_test_Fixture',
      url: 'https://checkout.stripe.com/c/pay/fixture',
    });
    await second.adapter.createCheckout({ ...checkout, customerId: 'cus_Fixture' });
    expect(
      new URLSearchParams(String(second.transport.mock.calls[0]?.[1]?.body)).get('customer'),
    ).toBe('cus_Fixture');
  });
  it.each([
    'https://evil.example/app',
    'http://127.0.0.1:3000.evil.example/app',
    'http://name:password@127.0.0.1:3000/app',
    'javascript:alert(1)',
  ])('refuses an unsafe return URL: %s', async (successUrl) => {
    const { adapter, transport } = provider({});
    await expect(adapter.createCheckout({ ...checkout, successUrl })).rejects.toMatchObject({
      code: 'BILLING_INPUT',
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    'https://checkout.stripe.com.evil.example/c/pay/fixture',
    'http://checkout.stripe.com/c/pay/fixture',
    'https://name:secret@checkout.stripe.com/c/pay/fixture',
    'https://checkout.stripe.com:8443/c/pay/fixture',
  ])('refuses an unsafe provider redirect: %s', async (url) => {
    await expect(
      provider({ id: 'cs_test_Fixture', url }).adapter.createCheckout(checkout),
    ).rejects.toMatchObject({ code: 'BILLING_RESPONSE' });
  });
  it('normalizes a single monthly subscription from the configured price, never metadata plan labels', async () => {
    const result = await provider(subscription()).adapter.retrieveSubscription('sub_Fixture');
    expect(result).toEqual({
      id: 'sub_Fixture',
      customerId: 'cus_Fixture',
      organizationId,
      planKey: 'solo',
      status: 'active',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: '2026-10-19T12:00:00.000Z',
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
    });
  });
  it.each([
    'price',
    'quantity',
    'currency',
    'amount',
    'interval',
    'organization',
    'period',
    'duplicate',
    'subscription_id',
  ])('rejects ambiguous/mismatched subscription %s', async (kind) => {
    const data = subscription();
    const item = data.items.data[0]!;
    if (kind === 'price') item.price.id = 'price_Unknown';
    if (kind === 'quantity') item.quantity = 2;
    if (kind === 'currency') item.price.currency = 'eur';
    if (kind === 'amount') item.price.unit_amount = 1;
    if (kind === 'interval') item.price.recurring.interval = 'year';
    if (kind === 'organization') data.metadata.organization_id = 'arbitrary';
    if (kind === 'period') item.current_period_end = item.current_period_start;
    if (kind === 'duplicate') data.items.data.push(item);
    if (kind === 'subscription_id') data.id = 'sub_Other';
    await expect(provider(data).adapter.retrieveSubscription('sub_Fixture')).rejects.toMatchObject({
      code: 'BILLING_RESPONSE',
    });
  });
  it('returns only safe failure codes with bounded retry classification', async () => {
    await expect(
      provider({ error: { message: 'sensitive upstream value' } }, 429).adapter.createCheckout(
        checkout,
      ),
    ).rejects.toMatchObject({ code: 'BILLING_UNAVAILABLE', retryable: true });
    await expect(
      provider({ error: { message: 'sensitive upstream value' } }, 400).adapter.createCheckout(
        checkout,
      ),
    ).rejects.toMatchObject({
      code: 'BILLING_UNAVAILABLE',
      retryable: false,
      message: 'BILLING_UNAVAILABLE',
    });
    const adapter = new StripeBillingProvider({
      ...options,
      fetch: async () => {
        throw new Error('sensitive transport value');
      },
    });
    await expect(adapter.createCheckout(checkout)).rejects.toMatchObject({
      message: 'BILLING_UNAVAILABLE',
      retryable: true,
    });
  });
  it('rejects malformed and overlarge responses', async () => {
    const malformed = new StripeBillingProvider({
      ...options,
      fetch: async () => new Response('not-json'),
    });
    await expect(malformed.checkConnection()).rejects.toMatchObject({ code: 'BILLING_RESPONSE' });
    const oversized = new StripeBillingProvider({
      ...options,
      fetch: async () => new Response('x'.repeat(300_000)),
    });
    await expect(oversized.checkConnection()).rejects.toMatchObject({ code: 'BILLING_RESPONSE' });
  });
  it('validates configuration without revealing input values', () => {
    expect(() => new StripeBillingProvider({ ...options, secretKey: 'private-invalid' })).toThrow(
      'BILLING_CONFIGURATION',
    );
    expect(
      () =>
        new StripeBillingProvider({
          ...options,
          priceIds: { solo: 'price_Same', growth: 'price_Same' },
        }),
    ).toThrow('BILLING_CONFIGURATION');
  });
});

describe('raw Stripe webhook verification', () => {
  const adapter = new StripeBillingProvider({
    ...options,
    fetch: async () => {
      throw new Error('Network is forbidden');
    },
  });
  it('accepts a signed subscription and preserves replay identity for the durable database gate', () => {
    const body = event();
    expect(adapter.verifyWebhook(body, sign(body), now)).toEqual({
      id: 'evt_Fixture',
      created: time,
      type: 'customer.subscription.updated',
      subscriptionId: 'sub_Fixture',
      customerId: 'cus_Fixture',
      organizationId,
      checkoutId: null,
    });
    expect(adapter.verifyWebhook(body, sign(body), now)).toEqual(
      adapter.verifyWebhook(body, sign(body), now),
    );
  });
  it('accepts rotated signatures but not a mutated raw body', () => {
    const body = event();
    expect(adapter.verifyWebhook(body, `${sign(body)},v1=${'0'.repeat(64)}`, now).id).toBe(
      'evt_Fixture',
    );
    expect(() => adapter.verifyWebhook(`${body} `, sign(body), now)).toThrow('BILLING_SIGNATURE');
  });
  it.each([-301, 301])('rejects signed timestamp outside the five-minute window (%i)', (offset) => {
    const body = event();
    expect(() => adapter.verifyWebhook(body, sign(body, time + offset), now)).toThrow(
      'BILLING_SIGNATURE',
    );
  });
  it.each([
    '',
    't=bad,v1=bad',
    `t=${time},t=${time},v1=${'0'.repeat(64)}`,
    `t=${time},v0=${'0'.repeat(64)}`,
    `t=${time},v1=abc`,
  ])('rejects malformed signatures', (signature) => {
    expect(() => adapter.verifyWebhook(event(), signature, now)).toThrow('BILLING_SIGNATURE');
  });
  it.each(['invoice.payment_failed', 'invoice.paid', 'invoice.payment_succeeded'])(
    'extracts current-version invoice subscription for %s',
    (type) => {
      const body = event(type, {
        customer: 'cus_Fixture',
        parent: {
          type: 'subscription_details',
          subscription_details: { subscription: 'sub_Fixture' },
        },
      });
      expect(adapter.verifyWebhook(body, sign(body), now)).toMatchObject({
        subscriptionId: 'sub_Fixture',
        organizationId: null,
        type,
      });
    },
  );
  it('does not let one-off invoices modify an organization', () => {
    const body = event('invoice.paid', { customer: 'cus_Fixture', parent: null });
    expect(adapter.verifyWebhook(body, sign(body), now).subscriptionId).toBeNull();
  });
  it('preserves checkout binding and does not trust successful navigation as payment', () => {
    const body = event('checkout.session.completed', {
      id: 'cs_test_Fixture',
      mode: 'subscription',
      subscription: 'sub_Fixture',
      customer: { id: 'cus_Fixture' },
      metadata: { organization_id: organizationId },
    });
    expect(adapter.verifyWebhook(body, sign(body), now)).toMatchObject({
      checkoutId: 'cs_test_Fixture',
      organizationId,
      subscriptionId: 'sub_Fixture',
    });
  });
  it('preserves older event timestamps for monotonic reconciliation instead of deriving entitlement from delivery order', () => {
    const body = event('customer.subscription.updated', subscription(), { created: time - 3600 });
    expect(adapter.verifyWebhook(body, sign(body), now).created).toBe(time - 3600);
  });
  it.each([{ livemode: true }, { api_version: '2020-01-01' }, { account: 'acct_Untrusted' }])(
    'rejects environment/API/connected-account mismatch',
    (override) => {
      const body = event(undefined, undefined, override);
      expect(() => adapter.verifyWebhook(body, sign(body), now)).toThrow('BILLING_RESPONSE');
    },
  );
  it('bounds untrusted body size before parsing', () => {
    expect(() => adapter.verifyWebhook('x'.repeat(300_000), '', now)).toThrow('BILLING_SIGNATURE');
  });
});

describe('mock billing boundary', () => {
  it('creates stable tenant-bound local references and refuses unauthenticated lifecycle changes', async () => {
    const adapter = new MockBillingProvider();
    const first = await adapter.createCheckout(checkout);
    expect(await adapter.createCheckout(checkout)).toEqual(first);
    expect(new URL(first.url).origin).toBe(options.appOrigin);
    expect(() => adapter.verifyWebhook('{}', 'mock')).toThrow('BILLING_SIGNATURE');
    await expect(adapter.retrieveSubscription('mock')).rejects.toThrow('BILLING_NOT_FOUND');
  });
  it('is a typed provider error without external details', () => {
    const error = new BillingProviderError('BILLING_INPUT');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('BILLING_INPUT');
    const config: StripeBillingOptions = options;
    expect(config.appOrigin).toBe(options.appOrigin);
  });
});
