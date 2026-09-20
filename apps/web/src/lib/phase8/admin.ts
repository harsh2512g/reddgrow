import 'server-only';
import { z } from 'zod';
import { notFound } from 'next/navigation';
import { requireUser } from '../auth/require-session';
import { localOpportunitiesEnabled } from '../phase3/server';
import { getServerEnv } from '../env/server';
import { operationsJson, operationsQuery, operationsSession } from './http';
import { checked, OperationsError } from './errors';
import {
  activityPageSchema,
  jobFamilySchema,
  jobsPageSchema,
  jobStatusSchema,
  operationReasonSchema,
  organizationDetailSchema,
  organizationsPageSchema,
  overviewSchema,
  retryResultSchema,
  statusResultSchema,
} from './contracts';
import { providerStatesSchema } from './provider-schema';

const pagination = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    before: z.iso.datetime({ offset: true }).optional(),
    beforeId: z.uuid().optional(),
  })
  .refine(
    (value) => Boolean(value.before) === Boolean(value.beforeId),
    'A complete cursor is required.',
  );
const jobsQuery = pagination
  .safeExtend({
    family: jobFamilySchema.optional(),
    status: jobStatusSchema.optional(),
    organizationId: z.uuid().optional(),
  })
  .strict();

export async function adminPageSession() {
  const context = await requireUser('/internal/admin');
  if (!localOpportunitiesEnabled()) notFound();
  if (checked(await context.supabase.rpc('platform_admin_session')) !== true) notFound();
  return context;
}
export async function adminContext(request: Request, mutation = false) {
  const context = await operationsSession(request, mutation);
  if (checked(await context.supabase.rpc('platform_admin_session')) !== true)
    throw new OperationsError('FORBIDDEN', 403);
  return context;
}
export async function adminOverview(request: Request) {
  const { supabase } = await adminContext(request);
  return overviewSchema.parse(checked(await supabase.rpc('platform_admin_overview')));
}
export async function adminOrganizations(request: Request) {
  const { supabase } = await adminContext(request);
  const input = z
    .object({
      limit: z.coerce.number().int().min(1).max(50).default(25),
      after: z.uuid().optional(),
    })
    .strict()
    .parse(operationsQuery(request));
  return organizationsPageSchema.parse(
    checked(
      await supabase.rpc('platform_admin_organizations', {
        p_limit: input.limit,
        ...(input.after ? { p_after: input.after } : {}),
      }),
    ),
  );
}
export async function adminOrganization(request: Request, id: string) {
  const { supabase } = await adminContext(request);
  return organizationDetailSchema.parse(
    checked(
      await supabase.rpc('platform_admin_organization', { p_organization_id: z.uuid().parse(id) }),
    ),
  );
}
export async function adminJobs(request: Request) {
  const { supabase } = await adminContext(request);
  const input = jobsQuery.parse(operationsQuery(request));
  return jobsPageSchema.parse(
    checked(
      await supabase.rpc('platform_admin_jobs', {
        p_limit: input.limit,
        ...(input.before ? { p_before: input.before, p_before_id: input.beforeId! } : {}),
        ...(input.family ? { p_family: input.family } : {}),
        ...(input.status ? { p_status: input.status } : {}),
        ...(input.organizationId ? { p_organization_id: input.organizationId } : {}),
      }),
    ),
  );
}
export async function adminRetry(request: Request, id: string) {
  const { supabase } = await adminContext(request, true);
  const input = await operationsJson(
    request,
    z
      .object({ family: jobFamilySchema, reason: operationReasonSchema, requestId: z.uuid() })
      .strict(),
  );
  return retryResultSchema.parse(
    checked(
      await supabase.rpc('platform_admin_retry_job', {
        p_family: input.family,
        p_job_id: z.uuid().parse(id),
        p_reason: input.reason,
        p_request_id: input.requestId,
      }),
    ),
  );
}
export async function adminStatus(request: Request, id: string) {
  const { supabase } = await adminContext(request, true);
  const input = await operationsJson(
    request,
    z.object({ paused: z.boolean(), reason: operationReasonSchema, requestId: z.uuid() }).strict(),
  );
  return statusResultSchema.parse(
    checked(
      await supabase.rpc('platform_admin_set_organization_status', {
        p_organization_id: z.uuid().parse(id),
        p_paused: input.paused,
        p_reason: input.reason,
        p_request_id: input.requestId,
      }),
    ),
  );
}
export function configuredProviders() {
  const env = getServerEnv();
  return providerStatesSchema.parse([
    {
      name: 'Reddit',
      adapter: env.REDDIT_PROVIDER,
      external_enabled: env.REDDIT_PROVIDER !== 'mock',
    },
    { name: 'AI', adapter: env.AI_PROVIDER, external_enabled: env.AI_PROVIDER !== 'mock' },
    {
      name: 'Crawler',
      adapter: env.CRAWLER_PROVIDER,
      external_enabled: env.CRAWLER_PROVIDER !== 'fixture',
    },
    {
      name: 'Email',
      adapter: env.EMAIL_PROVIDER,
      external_enabled: env.EMAIL_PROVIDER !== 'console',
    },
    {
      name: 'Billing',
      adapter: env.BILLING_PROVIDER,
      external_enabled: env.BILLING_PROVIDER !== 'mock',
    },
  ]);
}
export async function adminProviders(request: Request) {
  await adminContext(request);
  return configuredProviders();
}
export async function organizationActivity(request: Request) {
  const { supabase } = await operationsSession(request);
  const input = pagination
    .safeExtend({ organizationId: z.uuid() })
    .strict()
    .parse(operationsQuery(request));
  // SQL independently derives membership from the verified Supabase JWT subject.
  return activityPageSchema.parse(
    checked(
      await supabase.rpc('get_organization_activity', {
        p_organization_id: input.organizationId,
        p_limit: input.limit,
        ...(input.before ? { p_before: input.before, p_before_id: input.beforeId! } : {}),
      }),
    ),
  );
}
