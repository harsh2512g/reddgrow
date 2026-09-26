import 'server-only';
import { apiError, apiErrorResponse } from '../api-errors';
import { BillingProviderError } from '@threadsignal/billing';
import { z } from 'zod';
import { createLogger } from '@threadsignal/shared';
const logger = createLogger({ service: 'billing-webhook' });
import { getServerEnv } from '../env/server';
import { boundedBody, KnowledgeError } from '../knowledge/http';
import { billingEnabled } from './server';
import { billingProvider } from './api';
import { reconcileBilling } from './database';
import { BillingError, billingFailure } from './errors';

export async function billingWebhook(request: Request) {
  try {
    if (!billingEnabled() || getServerEnv().BILLING_PROVIDER !== 'stripe')
      return apiErrorResponse({
        status: 404,
        error: apiError('WEBHOOK_DISABLED', 'Billing webhooks are not enabled for this provider.'),
      });
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
      throw new BillingError('INVALID_WEBHOOK', 400);
    const bytes = await boundedBody(request, 262144);
    let raw: string;
    try {
      raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new BillingError('INVALID_WEBHOOK', 400);
    }
    const provider = billingProvider();
    const event = provider.verifyWebhook(raw, request.headers.get('stripe-signature') ?? '');
    if (!event.subscriptionId) return Response.json({ received: true, ignored: true });
    // Invoice events may omit organization metadata. Resolve it from the current,
    // authenticated provider object, never from browser parameters or a return URL.
    const identity =
      event.organizationId ??
      (await provider.retrieveSubscription(event.subscriptionId)).organizationId;
    const organizationId = z.uuid().parse(identity);
    const subscriptionId = event.subscriptionId;
    const result = await reconcileBilling(organizationId, async () => {
      const subscription = await provider.retrieveSubscription(subscriptionId);
      if (
        subscription.organizationId !== organizationId ||
        subscription.id !== subscriptionId ||
        (event.customerId !== null && subscription.customerId !== event.customerId)
      )
        throw new BillingError('INVALID_WEBHOOK', 400);
      return {
        provider: 'stripe',
        eventId: event.id,
        eventCreatedAt: new Date(event.created * 1000).toISOString(),
        checkoutSessionId: event.checkoutId,
        subscription,
      };
    });
    return Response.json({ received: true, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const normalized =
      error instanceof BillingProviderError
        ? new BillingError(
            error.code === 'BILLING_SIGNATURE' ? 'INVALID_WEBHOOK' : 'UNAVAILABLE',
            error.code === 'BILLING_SIGNATURE' ? 400 : 503,
          )
        : error instanceof KnowledgeError
          ? new BillingError('INVALID_WEBHOOK', error.status)
          : error;
    const failure = billingFailure(normalized);
    logger.warn(
      {
        event: 'billing_webhook_failed',
        code: failure.error.code,
        status: failure.status,
        requestId: failure.error.requestId,
      },
      'Billing webhook rejected or unavailable.',
    );
    return apiErrorResponse(failure);
  }
}
