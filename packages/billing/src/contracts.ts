import { z } from 'zod';

export const paidPlanSchema = z.enum(['solo', 'growth']);
const providerId = z.string().regex(/^[A-Za-z0-9_]{1,255}$/);
export const subscriptionStatusSchema = z.enum([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
]);
export const billingSubscriptionSchema = z
  .object({
    id: providerId,
    customerId: providerId,
    organizationId: z.uuid(),
    planKey: paidPlanSchema,
    status: subscriptionStatusSchema,
    currentPeriodStart: z.iso.datetime(),
    currentPeriodEnd: z.iso.datetime(),
    cancelAtPeriodEnd: z.boolean(),
    trialEndsAt: z.iso.datetime().nullable(),
  })
  .refine((value) => Date.parse(value.currentPeriodEnd) > Date.parse(value.currentPeriodStart), {
    message: 'Subscription period must end after it starts',
  });
export type BillingSubscription = z.infer<typeof billingSubscriptionSchema>;
export const checkoutInputSchema = z
  .object({
    organizationId: z.uuid(),
    planKey: paidPlanSchema,
    customerId: providerId.optional(),
    successUrl: z.url().max(2048),
    cancelUrl: z.url().max(2048),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  })
  .strict();
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;
export const portalInputSchema = z
  .object({
    organizationId: z.uuid(),
    customerId: providerId,
    returnUrl: z.url().max(2048),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  })
  .strict();
export type PortalInput = z.infer<typeof portalInputSchema>;
export interface BillingSession {
  id: string;
  url: string;
}
export interface BillingConnection {
  provider: 'mock' | 'stripe';
  available: boolean;
  paymentsEnabled: boolean;
}
export interface BillingWebhookEvent {
  id: string;
  created: number;
  type: string;
  /** Null for a signed event unrelated to a subscription. */
  subscriptionId: string | null;
  customerId: string | null;
  organizationId: string | null;
  checkoutId: string | null;
}
export interface BillingProvider {
  readonly mode: 'mock' | 'stripe';
  checkConnection(): Promise<BillingConnection>;
  createCheckout(input: CheckoutInput): Promise<BillingSession>;
  createPortal(input: PortalInput): Promise<BillingSession>;
  retrieveSubscription(subscriptionId: string): Promise<BillingSubscription>;
  verifyWebhook(rawBody: string, signature: string, now?: Date): BillingWebhookEvent;
}

/** Safe stable codes only: upstream payloads can contain card/account information. */
export class BillingProviderError extends Error {
  constructor(
    readonly code:
      | 'BILLING_CONFIGURATION'
      | 'BILLING_INPUT'
      | 'BILLING_UNAVAILABLE'
      | 'BILLING_RESPONSE'
      | 'BILLING_SIGNATURE'
      | 'BILLING_NOT_FOUND',
    readonly retryable = false,
  ) {
    super(code);
    this.name = 'BillingProviderError';
  }
}

export function parseBillingInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BillingProviderError('BILLING_INPUT');
  return result.data;
}

export function appOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BillingProviderError('BILLING_CONFIGURATION');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))
    )
  ) {
    throw new BillingProviderError('BILLING_CONFIGURATION');
  }
  return url.origin;
}

export function requireReturnUrl(value: string, origin: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BillingProviderError('BILLING_INPUT');
  }
  if (url.origin !== origin || url.username || url.password || url.hash)
    throw new BillingProviderError('BILLING_INPUT');
  return url.href;
}
