import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { createBillingProvider, StripeBillingProvider } from '@threadsignal/billing';
import { requireOrganization } from '../organizations/server';
import { hasTrustedOrigin } from '../auth/policy';
import { getServerEnv } from '../env/server';
import { boundedBody } from '../knowledge/http';
import { enforceAttributionLimit } from '../phase6/rate-limit';
import {
  billingSubscriptionSchema,
  billingUsageSchema,
  notificationPreferencesSchema,
} from '@/components/phase7/types';
import { billingEnabled } from './server';
import { BillingError, billingFailure, checked } from './errors';
import { billingDatabase } from './database';

export async function billingRoute(action: () => Promise<unknown>) {
  try {
    if (!billingEnabled()) throw new BillingError('LOCAL_ONLY', 503);
    return Response.json(
      { data: await action() },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    unstable_rethrow(error);
    const failure = billingFailure(error);
    return Response.json(
      { error: failure.error },
      { status: failure.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
export async function billingContext(
  request: Request,
  permission: 'read' | 'owner' | 'preferences' = 'read',
) {
  if (!billingEnabled()) throw new BillingError('LOCAL_ONLY', 503);
  if (
    permission !== 'read' &&
    !hasTrustedOrigin(request.headers, getServerEnv().NEXT_PUBLIC_APP_URL)
  )
    throw new BillingError('FORBIDDEN', 403);
  const context = await requireOrganization();
  const requestedOrganization = new URL(request.url).searchParams.get('organizationId');
  if (requestedOrganization && z.uuid().parse(requestedOrganization) !== context.organization.id)
    throw new BillingError('FORBIDDEN', 403);
  const selected = request.headers.get('x-threadsignal-organization');
  if (selected && selected !== context.organization.id)
    throw new BillingError('WORKSPACE_CHANGED', 409);
  if (permission !== 'read') {
    if (request.headers.get('x-threadsignal-organization') !== context.organization.id)
      throw new BillingError('WORKSPACE_CHANGED', 409);
    if (permission === 'owner' && context.organization.role !== 'owner')
      throw new BillingError('FORBIDDEN', 403);
    await enforceAttributionLimit(
      'management',
      `billing:${context.organization.id}:${context.user.id}`,
    );
  }
  return context;
}
export async function billingJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
    throw new BillingError('INVALID_INPUT');
  const bytes = await boundedBody(request, 8192);
  try {
    return schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    throw new BillingError('INVALID_INPUT');
  }
}
export function billingProvider() {
  const env = getServerEnv();
  if (env.BILLING_PROVIDER === 'mock') return createBillingProvider();
  return new StripeBillingProvider({
    secretKey: env.STRIPE_SECRET_KEY!,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET!,
    priceIds: { solo: env.STRIPE_SOLO_PRICE_ID!, growth: env.STRIPE_GROWTH_PRICE_ID! },
    appOrigin: env.NEXT_PUBLIC_APP_URL,
  });
}
export async function readSubscription(request: Request) {
  const { organization, supabase } = await billingContext(request);
  return billingSubscriptionSchema.parse(
    checked(await supabase.rpc('get_billing_subscription', { p_organization_id: organization.id })),
  );
}
export async function readUsage(request: Request) {
  const { organization, supabase } = await billingContext(request);
  return billingUsageSchema.parse(
    checked(await supabase.rpc('get_billing_usage', { p_organization_id: organization.id })),
  );
}
const checkoutRecord = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  plan_key: z.enum(['solo', 'growth']),
  provider: z.enum(['mock', 'stripe']),
  status: z.string(),
  expires_at: z.string(),
});
export async function checkout(request: Request) {
  const { organization, supabase } = await billingContext(request, 'owner');
  const input = await billingJson(
    request,
    z.object({ planKey: z.enum(['solo', 'growth']), idempotencyKey: z.uuid() }).strict(),
  );
  const env = getServerEnv();
  const subscription = billingSubscriptionSchema.parse(
    checked(await supabase.rpc('get_billing_subscription', { p_organization_id: organization.id })),
  );
  if (
    env.BILLING_PROVIDER === 'stripe' &&
    subscription.provider === 'stripe' &&
    subscription.customer_id &&
    !['canceled', 'incomplete_expired'].includes(subscription.status)
  ) {
    const session = await billingProvider().createPortal({
      organizationId: organization.id,
      customerId: subscription.customer_id,
      returnUrl: `${env.NEXT_PUBLIC_APP_URL}/app/settings/billing`,
      idempotencyKey: input.idempotencyKey,
    });
    return { request: null, url: session.url };
  }
  const record = checkoutRecord.parse(
    checked(
      await supabase.rpc('begin_billing_checkout', {
        p_organization_id: organization.id,
        p_plan_key: input.planKey,
        p_idempotency_key: input.idempotencyKey,
        p_provider: env.BILLING_PROVIDER,
      }),
    ),
  );
  if (record.provider !== env.BILLING_PROVIDER)
    throw new BillingError('BILLING_PROVIDER_MISMATCH', 409);
  if (env.BILLING_PROVIDER === 'mock') return { request: record, url: null };
  if (record.status !== 'pending' || Date.parse(record.expires_at) <= Date.now())
    throw new BillingError('BILLING_REQUEST_EXPIRED', 409);
  const customerId = subscription.provider === 'stripe' ? subscription.customer_id : null;
  const session = await billingProvider().createCheckout({
    organizationId: organization.id,
    planKey: input.planKey,
    ...(customerId ? { customerId } : {}),
    successUrl: `${env.NEXT_PUBLIC_APP_URL}/app/settings/billing?checkout=returned`,
    cancelUrl: `${env.NEXT_PUBLIC_APP_URL}/app/settings/billing`,
    idempotencyKey: record.id,
  });
  await billingDatabase('registerSession', [record.id, 'stripe', session.id, customerId]);
  return { request: record, url: session.url };
}
export async function completeMockCheckout(request: Request) {
  const { organization, user } = await billingContext(request, 'owner');
  if (getServerEnv().BILLING_PROVIDER !== 'mock')
    throw new BillingError('BILLING_PROVIDER_MISMATCH', 409);
  const input = await billingJson(request, z.object({ requestId: z.uuid() }).strict());
  return {
    subscription: billingSubscriptionSchema.parse(
      await billingDatabase('completeMock', [organization.id, input.requestId], user.id),
    ),
  };
}
export async function portal(request: Request) {
  const { organization, supabase, user } = await billingContext(request, 'owner');
  const input = await billingJson(
    request,
    z
      .object({
        action: z.enum([
          'open',
          'cancel',
          'resume',
          'payment_failed',
          'payment_recovered',
          'renew',
        ]),
      })
      .strict(),
  );
  const env = getServerEnv();
  if (env.BILLING_PROVIDER === 'mock') {
    if (input.action === 'open') return { subscription: await readSubscription(request) };
    return {
      subscription: billingSubscriptionSchema.parse(
        await billingDatabase('manageMock', [organization.id, input.action], user.id),
      ),
    };
  }
  if (input.action !== 'open') throw new BillingError('INVALID_INPUT');
  const subscription = billingSubscriptionSchema.parse(
    checked(await supabase.rpc('get_billing_subscription', { p_organization_id: organization.id })),
  );
  if (!subscription.customer_id) throw new BillingError('PLAN_INACTIVE', 409);
  const session = await billingProvider().createPortal({
    organizationId: organization.id,
    customerId: subscription.customer_id,
    returnUrl: `${env.NEXT_PUBLIC_APP_URL}/app/settings/billing`,
    idempotencyKey: crypto.randomUUID(),
  });
  return { url: session.url };
}
export async function notificationPreferences(request: Request) {
  const { organization, supabase } = await billingContext(
    request,
    request.method === 'GET' ? 'read' : 'preferences',
  );
  const result =
    request.method === 'GET'
      ? await supabase.rpc('get_notification_preferences', { p_organization_id: organization.id })
      : await supabase.rpc('set_notification_preferences', {
          p_organization_id: organization.id,
          p_preferences: await billingJson(request, notificationPreferencesSchema),
        });
  return { preferences: notificationPreferencesSchema.parse(checked(result)) };
}
export async function notificationDeliveries(request: Request) {
  const { organization, supabase } = await billingContext(request);
  return {
    deliveries: checked(
      await supabase.rpc('list_notification_deliveries', { p_organization_id: organization.id }),
    ),
  };
}
