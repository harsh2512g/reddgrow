import 'server-only';
import postgres from 'postgres';
import { z } from 'zod';
import { localOpportunitiesEnabled } from '../phase3/server';
import { BillingError } from './errors';

export const billingStatements = {
  completeMock: 'select public.complete_mock_checkout($1::uuid,$2::uuid) as value',
  manageMock: 'select public.manage_mock_subscription($1::uuid,$2::text) as value',
  registerSession:
    'select private.register_billing_session($1::uuid,$2::text,$3::text,$4::text) as value',
  applyEvent: 'select private.apply_billing_event($1::text::jsonb) as value',
} as const;
let client: ReturnType<typeof postgres> | undefined;
function database() {
  if (!localOpportunitiesEnabled()) throw new BillingError('LOCAL_ONLY', 503);
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new BillingError('UNAVAILABLE', 503);
  const url = new URL(raw);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '54322' ||
    url.pathname !== '/postgres' ||
    url.search ||
    url.hash
  )
    throw new BillingError('LOCAL_ONLY', 503);
  return (client ??= postgres(raw, {
    max: 4,
    connect_timeout: 2,
    idle_timeout: 10,
    max_lifetime: 300,
    onnotice: () => undefined,
    connection: { application_name: 'threadsignal-billing', statement_timeout: 10000 },
  }));
}
/** Fixed statements under a role with no table or Auth access. */
export async function billingDatabase(
  operation: keyof typeof billingStatements,
  args: (string | null)[],
  userId?: string,
) {
  return database().begin(async (tx) => {
    await tx`set local role threadsignal_billing_api`;
    if (userId) {
      z.uuid().parse(userId);
      await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: userId, role: 'authenticated' })},true)`;
    }
    const rows = await tx.unsafe(billingStatements[operation], args);
    return rows[0]?.value as unknown;
  });
}
/** Fetch the provider snapshot after acquiring this organization's lock, so concurrent events
 * cannot publish snapshots fetched in the opposite order. Never keep raw webhook bodies. */
export async function reconcileBilling(organizationId: string, snapshot: () => Promise<unknown>) {
  z.uuid().parse(organizationId);
  return database().begin(async (tx) => {
    await tx`set local role threadsignal_billing_api`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${`billing:${organizationId}`},0))`;
    const event = await snapshot();
    const rows = await tx.unsafe(billingStatements.applyEvent, [JSON.stringify(event)]);
    return rows[0]?.value as unknown;
  });
}
