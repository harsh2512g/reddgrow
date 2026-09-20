import { createHash } from 'node:crypto';
import {
  appOrigin,
  BillingProviderError,
  checkoutInputSchema,
  parseBillingInput,
  portalInputSchema,
  requireReturnUrl,
  type BillingConnection,
  type BillingProvider,
  type BillingSubscription,
  type BillingWebhookEvent,
  type CheckoutInput,
  type PortalInput,
} from './contracts.js';

/** Sessions are deterministic references; Supabase owns authorization, confirmation and state. */
export class MockBillingProvider implements BillingProvider {
  readonly mode = 'mock';
  private readonly origin: string;
  constructor(options: { appOrigin?: string } = {}) {
    this.origin = appOrigin(options.appOrigin ?? 'http://127.0.0.1:3000');
  }
  async checkConnection(): Promise<BillingConnection> {
    return { provider: this.mode, available: true, paymentsEnabled: false };
  }
  async createCheckout(input: CheckoutInput) {
    const request = parseBillingInput(checkoutInputSchema, input);
    requireReturnUrl(request.successUrl, this.origin);
    requireReturnUrl(request.cancelUrl, this.origin);
    const id = this.id('checkout', request.organizationId, request.idempotencyKey);
    return { id, url: `${this.origin}/app/settings/billing?checkout=${id}` };
  }
  async createPortal(input: PortalInput) {
    const request = parseBillingInput(portalInputSchema, input);
    requireReturnUrl(request.returnUrl, this.origin);
    const id = this.id('portal', request.organizationId, request.idempotencyKey);
    return { id, url: `${this.origin}/app/settings/billing?portal=${id}` };
  }
  async retrieveSubscription(_subscriptionId: string): Promise<BillingSubscription> {
    void _subscriptionId;
    // A process-local map would disagree with durable Supabase records after a restart.
    throw new BillingProviderError('BILLING_NOT_FOUND');
  }
  verifyWebhook(_rawBody: string, _signature: string): BillingWebhookEvent {
    void _rawBody;
    void _signature;
    // Mock changes require the authenticated owner's SQL operation, never a public webhook.
    throw new BillingProviderError('BILLING_SIGNATURE');
  }
  private id(kind: string, organizationId: string, key: string): string {
    return `mock_${kind}_${createHash('sha256').update(`${organizationId}:${key}`).digest('hex').slice(0, 32)}`;
  }
}
