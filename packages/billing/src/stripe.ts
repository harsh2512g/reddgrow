import { measuredProviderRequest } from '@threadsignal/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { PLANS } from '@threadsignal/config';
import {
  appOrigin,
  BillingProviderError,
  billingSubscriptionSchema,
  checkoutInputSchema,
  parseBillingInput,
  portalInputSchema,
  requireReturnUrl,
  subscriptionStatusSchema,
  type BillingConnection,
  type BillingProvider,
  type BillingSession,
  type BillingSubscription,
  type BillingWebhookEvent,
  type CheckoutInput,
  type PortalInput,
} from './contracts.js';

/** Webhook endpoints must use this same documented stable API version. */
export const STRIPE_API_VERSION = '2026-08-26.dahlia';
export const STRIPE_WEBHOOK_MAX_BYTES = 262_144;
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;
const stripeId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,240}$`));
const objectId = (prefix: string) =>
  z
    .union([stripeId(prefix), z.object({ id: stripeId(prefix) })])
    .transform((value) => (typeof value === 'string' ? value : value.id));
const timestamp = z.number().int().min(0).max(253_402_300_799);
const configSchema = z.object({
  secretKey: z.string().regex(/^(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{8,}$/),
  webhookSecret: z.string().regex(/^whsec_[A-Za-z0-9]{8,}$/),
  priceIds: z
    .object({ solo: stripeId('price'), growth: stripeId('price') })
    .refine((ids) => ids.solo !== ids.growth),
  appOrigin: z.string(),
});
export interface StripeBillingOptions {
  secretKey: string;
  webhookSecret: string;
  priceIds: { solo: string; growth: string };
  appOrigin: string;
  fetch?: typeof fetch;
}
const subscriptionSchema = z.object({
  id: stripeId('sub'),
  customer: objectId('cus'),
  status: subscriptionStatusSchema,
  metadata: z.object({ organization_id: z.uuid() }),
  cancel_at_period_end: z.boolean(),
  trial_end: timestamp.nullable(),
  items: z.object({
    has_more: z.literal(false),
    data: z
      .array(
        z.object({
          quantity: z.literal(1),
          current_period_start: timestamp,
          current_period_end: timestamp,
          price: z.object({
            id: stripeId('price'),
            currency: z.literal('usd'),
            unit_amount: z.number().int(),
            recurring: z.object({ interval: z.literal('month'), interval_count: z.literal(1) }),
          }),
        }),
      )
      .length(1),
  }),
});
const eventSchema = z.object({
  id: stripeId('evt'),
  created: timestamp,
  type: z.string().min(1).max(200),
  livemode: z.boolean(),
  api_version: z.literal(STRIPE_API_VERSION),
  account: z.undefined().optional(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

export class StripeBillingProvider implements BillingProvider {
  readonly mode = 'stripe';
  private readonly config: z.infer<typeof configSchema>;
  private readonly origin: string;
  private readonly transport: typeof fetch;
  constructor(options: StripeBillingOptions) {
    const parsed = configSchema.safeParse(options);
    if (!parsed.success) throw new BillingProviderError('BILLING_CONFIGURATION');
    this.config = parsed.data;
    this.origin = appOrigin(options.appOrigin);
    this.transport = options.fetch ?? fetch;
  }
  async checkConnection(): Promise<BillingConnection> {
    // Constructors never perform external I/O. Explicit health calls use a read endpoint.
    const result = z
      .object({ id: stripeId('acct'), charges_enabled: z.boolean() })
      .safeParse(await this.request('/account'));
    if (!result.success) throw new BillingProviderError('BILLING_RESPONSE');
    return { provider: this.mode, available: true, paymentsEnabled: result.data.charges_enabled };
  }
  async createCheckout(input: CheckoutInput): Promise<BillingSession> {
    const request = parseBillingInput(checkoutInputSchema, input);
    if (request.customerId && !stripeId('cus').safeParse(request.customerId).success)
      throw new BillingProviderError('BILLING_INPUT');
    const body = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': this.config.priceIds[request.planKey],
      'line_items[0][quantity]': '1',
      client_reference_id: request.organizationId,
      'metadata[organization_id]': request.organizationId,
      'subscription_data[metadata][organization_id]': request.organizationId,
      success_url: requireReturnUrl(request.successUrl, this.origin),
      cancel_url: requireReturnUrl(request.cancelUrl, this.origin),
    });
    if (request.customerId) body.set('customer', request.customerId);
    return this.session(
      await this.request('/checkout/sessions', body, request.idempotencyKey),
      'checkout.stripe.com',
      'cs',
    );
  }
  async createPortal(input: PortalInput): Promise<BillingSession> {
    const request = parseBillingInput(portalInputSchema, input);
    if (!stripeId('cus').safeParse(request.customerId).success)
      throw new BillingProviderError('BILLING_INPUT');
    return this.session(
      await this.request(
        '/billing_portal/sessions',
        new URLSearchParams({
          customer: request.customerId,
          return_url: requireReturnUrl(request.returnUrl, this.origin),
        }),
        request.idempotencyKey,
      ),
      'billing.stripe.com',
      'bps',
    );
  }
  async retrieveSubscription(subscriptionId: string): Promise<BillingSubscription> {
    if (!stripeId('sub').safeParse(subscriptionId).success)
      throw new BillingProviderError('BILLING_INPUT');
    const parsed = subscriptionSchema.safeParse(
      await this.request(`/subscriptions/${subscriptionId}`),
    );
    if (!parsed.success) throw new BillingProviderError('BILLING_RESPONSE');
    const subscription = parsed.data;
    const item = subscription.items.data[0];
    if (!item) throw new BillingProviderError('BILLING_RESPONSE');
    const planKey =
      item.price.id === this.config.priceIds.solo
        ? 'solo'
        : item.price.id === this.config.priceIds.growth
          ? 'growth'
          : null;
    if (!planKey || item.price.unit_amount !== PLANS[planKey].monthlyPriceUsd * 100)
      throw new BillingProviderError('BILLING_RESPONSE');
    const normalized = billingSubscriptionSchema.safeParse({
      id: subscription.id,
      customerId: subscription.customer,
      organizationId: subscription.metadata.organization_id,
      planKey,
      status: subscription.status,
      currentPeriodStart: new Date(item.current_period_start * 1000).toISOString(),
      currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      trialEndsAt:
        subscription.trial_end === null
          ? null
          : new Date(subscription.trial_end * 1000).toISOString(),
    });
    if (!normalized.success || normalized.data.id !== subscriptionId)
      throw new BillingProviderError('BILLING_RESPONSE');
    return normalized.data;
  }
  verifyWebhook(rawBody: string, signature: string, now = new Date()): BillingWebhookEvent {
    if (Buffer.byteLength(rawBody) > STRIPE_WEBHOOK_MAX_BYTES || signature.length > 4096)
      throw new BillingProviderError('BILLING_SIGNATURE');
    const parts = signature.split(',').map((part) => part.trim().split('='));
    const times = parts.filter(([key]) => key === 't').map(([, value]) => value);
    const signatures = parts
      .filter(([key]) => key === 'v1')
      .map(([, value]) => value)
      .filter((value): value is string => /^[a-f0-9]{64}$/.test(value ?? ''));
    const time = times[0];
    if (
      times.length !== 1 ||
      !time ||
      !/^\d{1,12}$/.test(time) ||
      signatures.length === 0 ||
      !Number.isFinite(now.getTime()) ||
      Math.abs(now.getTime() / 1000 - Number(time)) > STRIPE_WEBHOOK_TOLERANCE_SECONDS
    ) {
      throw new BillingProviderError('BILLING_SIGNATURE');
    }
    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(`${time}.${rawBody}`)
      .digest();
    // Evaluate every v1 entry, including rotated signatures, without an early matching exit.
    const valid = signatures.reduce(
      (matched, value) => Number(timingSafeEqual(expected, Buffer.from(value, 'hex'))) | matched,
      0,
    );
    if (!valid) throw new BillingProviderError('BILLING_SIGNATURE');
    let input: unknown;
    try {
      input = JSON.parse(rawBody);
    } catch {
      throw new BillingProviderError('BILLING_RESPONSE');
    }
    const parsed = eventSchema.safeParse(input);
    if (!parsed.success || parsed.data.livemode !== this.config.secretKey.includes('_live_'))
      throw new BillingProviderError('BILLING_RESPONSE');
    const event = parsed.data;
    const object = event.data.object;
    let subscriptionId: string | null = null;
    let customerId: string | null = null;
    let organizationId: string | null = null;
    let checkoutId: string | null = null;
    const relevant = [
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'customer.subscription.trial_will_end',
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'invoice.payment_failed',
      'invoice.paid',
      'invoice.payment_succeeded',
    ].includes(event.type);
    if (relevant) {
      const customer = objectId('cus').safeParse(object['customer']);
      if (!customer.success) throw new BillingProviderError('BILLING_RESPONSE');
      customerId = customer.data;
      if (event.type.startsWith('checkout.')) {
        const checkout = z
          .object({
            id: z.string().regex(/^cs_[A-Za-z0-9_]{1,240}$/),
            mode: z.literal('subscription'),
          })
          .safeParse(object);
        if (!checkout.success) throw new BillingProviderError('BILLING_RESPONSE');
        checkoutId = checkout.data.id;
      }
      let subscriptionValue = object['subscription'];
      if (event.type.startsWith('customer.subscription.')) subscriptionValue = object['id'];
      if (event.type.startsWith('invoice.')) {
        const invoice = z
          .object({
            parent: z
              .object({
                type: z.literal('subscription_details'),
                subscription_details: z.object({ subscription: objectId('sub') }),
              })
              .nullable(),
          })
          .safeParse(object);
        // One-off invoices have no subscription and cannot change entitlements.
        if (invoice.success && invoice.data.parent === null)
          return {
            id: event.id,
            created: event.created,
            type: event.type,
            subscriptionId: null,
            customerId,
            organizationId: null,
            checkoutId: null,
          };
        if (!invoice.success) throw new BillingProviderError('BILLING_RESPONSE');
        subscriptionValue = invoice.data.parent?.subscription_details.subscription;
      }
      const subscription = objectId('sub').safeParse(subscriptionValue);
      if (!subscription.success) throw new BillingProviderError('BILLING_RESPONSE');
      subscriptionId = subscription.data;
      const metadata = z.object({ organization_id: z.uuid() }).safeParse(object['metadata']);
      if (metadata.success) organizationId = metadata.data.organization_id;
    }
    return {
      id: event.id,
      created: event.created,
      type: event.type,
      subscriptionId,
      customerId,
      organizationId,
      checkoutId,
    };
  }
  private session(input: unknown, hostname: string, prefix: string): BillingSession {
    const parsed = z
      .object({
        id: z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_]{1,240}$`)),
        url: z.url().max(4096),
      })
      .safeParse(input);
    if (!parsed.success) throw new BillingProviderError('BILLING_RESPONSE');
    const url = new URL(parsed.data.url);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== hostname ||
      url.port ||
      url.username ||
      url.password
    )
      throw new BillingProviderError('BILLING_RESPONSE');
    return parsed.data;
  }
  private async request(path: string, body?: URLSearchParams, key?: string): Promise<unknown> {
    try {
      const response = await measuredProviderRequest('stripe', () =>
        this.transport(`https://api.stripe.com/v1${path}`, {
          method: body ? 'POST' : 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${this.config.secretKey}`,
            'Stripe-Version': STRIPE_API_VERSION,
            ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
          ...(body ? { body: body.toString() } : {}),
        }),
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new BillingProviderError(
          'BILLING_UNAVAILABLE',
          response.status === 429 || response.status >= 500,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new BillingProviderError('BILLING_RESPONSE');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > STRIPE_WEBHOOK_MAX_BYTES) {
          await reader.cancel();
          throw new BillingProviderError('BILLING_RESPONSE');
        }
        chunks.push(value);
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw new BillingProviderError('BILLING_RESPONSE');
      }
    } catch (error) {
      if (error instanceof BillingProviderError) throw error;
      throw new BillingProviderError('BILLING_UNAVAILABLE', true);
    }
  }
}
