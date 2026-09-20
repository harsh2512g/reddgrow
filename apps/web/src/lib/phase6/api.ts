import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import {
  attributionSettingsSchema,
  createConversionKeyInputSchema,
  trackingLinkInputSchema,
  validateDestinationUrl,
} from '@threadsignal/tracking';
import { requireOrganization } from '../organizations/server';
import { hasTrustedOrigin } from '../auth/policy';
import { getServerEnv } from '../env/server';
import { boundedBody } from '../knowledge/http';
import { attributionEnabled, loadTracking, loadAnalytics } from './server';
import { AttributionError, attributionFailure, requireData } from './errors';
import { trackingLinkSchema, conversionKeyRecordSchema, trackingSettingsSchema } from './schema';
import { enforceAttributionLimit } from './rate-limit';
export const hashTrackingSecret = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export async function attributionJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
    throw new AttributionError('INVALID_INPUT');
  const bytes = await boundedBody(request, 16384);
  try {
    return schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    throw new AttributionError('INVALID_INPUT');
  }
}
export async function attributionRoute(action: () => Promise<unknown>) {
  try {
    if (!attributionEnabled()) throw new AttributionError('LOCAL_ONLY', 503);
    return Response.json(
      { data: await action() },
      { headers: { 'Cache-Control': 'private, no-store', 'X-Request-ID': crypto.randomUUID() } },
    );
  } catch (error) {
    unstable_rethrow(error);
    const failure = attributionFailure(error);
    return Response.json(
      { error: failure.error },
      {
        status: failure.status,
        headers: { 'Cache-Control': 'no-store', 'X-Request-ID': failure.error.requestId },
      },
    );
  }
}
export async function attributionContext(
  request: Request,
  permission: 'read' | 'act' | 'manage' = 'read',
) {
  if (!attributionEnabled()) throw new AttributionError('LOCAL_ONLY', 503);
  if (
    permission !== 'read' &&
    !hasTrustedOrigin(request.headers, getServerEnv().NEXT_PUBLIC_APP_URL)
  )
    throw new AttributionError('FORBIDDEN', 403);
  const workspace = await requireOrganization();
  if (permission !== 'read') {
    if (request.headers.get('x-threadsignal-organization') !== workspace.organization.id)
      throw new AttributionError('WORKSPACE_CHANGED', 409);
    if (
      workspace.organization.role === 'viewer' ||
      (permission === 'manage' && !['owner', 'admin'].includes(workspace.organization.role))
    )
      throw new AttributionError('FORBIDDEN', 403);
    await enforceAttributionLimit('management', workspace.organization.id);
  }
  return workspace;
}
export async function createTrackingLink(request: Request) {
  const { supabase, organization } = await attributionContext(request, 'act');
  const input = await attributionJson(request, trackingLinkInputSchema);
  const draft = requireData(
    await supabase
      .from('drafts')
      .select('brand_id,opportunity_id')
      .eq('organization_id', organization.id)
      .eq('id', input.draftId)
      .maybeSingle(),
  );
  if (!draft) throw new AttributionError('DRAFT_NOT_FOUND', 404);
  const brand = requireData(
    await supabase
      .from('brands')
      .select('website_url,profile')
      .eq('organization_id', organization.id)
      .eq('id', draft.brand_id)
      .single(),
  );
  const profile = z.object({ allowed_links: z.array(z.string()) }).parse(brand?.profile);
  const approved = [brand!.website_url, ...profile.allowed_links].map(
    (value) => new URL(value).hostname,
  );
  let destination: string;
  try {
    destination = validateDestinationUrl(input.destinationUrl, approved).href;
  } catch {
    throw new AttributionError('TRACKING_DESTINATION_DENIED');
  }
  const utm: Record<string, string> = {
    utm_source: input.utm.source,
    utm_medium: input.utm.medium,
    utm_campaign: input.utm.campaign,
    utm_content: input.utm.content ?? draft.opportunity_id,
  };
  const link = trackingLinkSchema.parse(
    requireData(
      await supabase.rpc('create_tracking_link', {
        p_organization_id: organization.id,
        p_draft_id: input.draftId,
        p_expected_version: input.expectedVersion,
        p_code: randomBytes(12).toString('base64url'),
        p_destination: destination,
        p_utm: utm,
        p_overwrite: input.overwriteUtm,
      }),
    ),
  );
  return { link };
}
export async function listTrackingLinks(request: Request) {
  await attributionContext(request);
  const brandId = z
    .uuid()
    .optional()
    .parse(new URL(request.url).searchParams.get('brandId') ?? undefined);
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .parse(new URL(request.url).searchParams.get('page') ?? 1);
  const result = await loadTracking(brandId, page);
  return { links: result.links, pagination: result.pagination };
}
export async function revokeTrackingLink(request: Request, id: string) {
  const context = await attributionContext(request, 'act');
  z.uuid().parse(id);
  await attributionJson(request, z.object({}).strict());
  requireData(
    await context.supabase.rpc('revoke_tracking_link', {
      p_organization_id: context.organization.id,
      p_id: id,
    }),
  );
  return { revoked: true };
}
export async function createConversionKey(request: Request) {
  const context = await attributionContext(request, 'manage');
  const input = await attributionJson(request, createConversionKeyInputSchema);
  const key = `tsk_${randomBytes(32).toString('base64url')}`;
  const record = conversionKeyRecordSchema.parse(
    requireData(
      await context.supabase.rpc('create_conversion_api_key', {
        p_organization_id: context.organization.id,
        p_brand_id: input.brandId,
        p_name: input.name,
        p_prefix: key.slice(0, 12),
        p_hash: hashTrackingSecret(key),
        ...(input.rotateKeyId ? { p_replaces: input.rotateKeyId } : {}),
      }),
    ),
  );
  return { key, record };
}
export async function listConversionKeys(request: Request) {
  const c = await attributionContext(request);
  if (!['owner', 'admin'].includes(c.organization.role))
    throw new AttributionError('FORBIDDEN', 403);
  const brandId = z.uuid().parse(new URL(request.url).searchParams.get('brandId'));
  return {
    keys: z.array(conversionKeyRecordSchema).parse(
      requireData(
        await c.supabase.rpc('list_conversion_api_keys', {
          p_organization_id: c.organization.id,
          p_brand_id: brandId,
        }),
      ),
    ),
  };
}
export async function revokeConversionKey(request: Request, id: string) {
  const c = await attributionContext(request, 'manage');
  z.uuid().parse(id);
  await attributionJson(request, z.object({}).strict());
  requireData(
    await c.supabase.rpc('revoke_conversion_api_key', {
      p_organization_id: c.organization.id,
      p_id: id,
    }),
  );
  return { revoked: true };
}
export async function updateTrackingSettings(request: Request) {
  const c = await attributionContext(request, 'manage');
  const input = await attributionJson(request, attributionSettingsSchema);
  return {
    settings: trackingSettingsSchema.parse(
      requireData(
        await c.supabase.rpc('update_tracking_settings', {
          p_organization_id: c.organization.id,
          p_days: input.attributionDays,
          p_consent: input.consentText,
        }),
      ),
    ),
  };
}
export async function readAnalytics(
  request: Request,
  section: 'summary' | 'funnel' | 'timeseries' | 'subreddits' | 'opportunities' | 'all',
) {
  await attributionContext(request);
  const report = await loadAnalytics(Object.fromEntries(new URL(request.url).searchParams));
  if (report.invalidFilters) throw new AttributionError('INVALID_INPUT');
  if (!report.analytics) throw new AttributionError('UNAVAILABLE', 503);
  return section === 'all'
    ? report.analytics
    : section === 'summary'
      ? report.analytics.metrics
      : section === 'funnel' || section === 'timeseries'
        ? report.analytics[section]
        : report.analytics.breakdowns[section];
}
