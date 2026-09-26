import 'server-only';
import { z } from 'zod';
import { requireOrganization } from './organizations/server';
import { KnowledgeError } from './knowledge/http';

/** Supabase computes eligibility using its clock, including payment grace and suspension. */
export async function requireActiveProviderPlan(organizationId: string) {
  const { supabase } = await requireOrganization(organizationId);
  const result = await supabase.rpc('get_billing_subscription', {
    p_organization_id: organizationId,
  });
  const parsed = z
    .object({
      organization_id: z.literal(organizationId),
      active: z.boolean(),
      status: z.string(),
      plan_key: z.enum(['trial', 'solo', 'growth']),
    })
    .safeParse(result.data);
  if (result.error || !parsed.success) throw new KnowledgeError('PLAN_UNAVAILABLE', 503);
  if (!parsed.data.active)
    throw new KnowledgeError(
      parsed.data.status === 'expired' ? 'TRIAL_EXPIRED' : 'PLAN_INACTIVE',
      409,
    );
  return parsed.data;
}
