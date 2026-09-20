import 'server-only';
import { z } from 'zod';
import { analyticsFiltersSchema, analyticsReportSchema } from '@threadsignal/analytics';
import { getPlan } from '@threadsignal/config';
import { loadSignalWorkspace, localOpportunitiesEnabled } from '../phase3/server';
import { getServerEnv } from '../env/server';
import { planSchema } from '../organizations/schema';
import { conversionKeyRecordSchema, trackingLinkSchema, trackingSettingsSchema } from './schema';
import { requireData } from './errors';
export const attributionEnabled = localOpportunitiesEnabled;
export async function loadTracking(brandId?: string, requestedPage = 1, selectedDraftId?: string) {
  if (selectedDraftId) z.uuid().parse(selectedDraftId);
  const page = z.number().int().min(1).max(10000).parse(requestedPage);
  const pageSize = 50;
  const workspace = await loadSignalWorkspace(brandId);
  const { enabled, organization, supabase, brand } = workspace;
  const empty = {
    ...workspace,
    pagination: { page, pageSize, total: 0, totalPages: 1 },
    apiOrigin: getServerEnv().NEXT_PUBLIC_APP_URL,
    links: [] as z.infer<typeof trackingLinkSchema>[],
    keys: [] as z.infer<typeof conversionKeyRecordSchema>[],
    drafts: [] as Array<{ id: string; current_version: number; title: string; brand_id: string }>,
    settings: {
      attribution_days: 30,
      consent_text: 'Allow privacy-respecting attribution of this visit and conversion events.',
    },
    features: getPlan('trial').features,
  };
  if (!enabled) return empty;
  const [settings, plan] = await Promise.all([
    supabase.rpc('get_tracking_settings', { p_organization_id: organization.id }),
    supabase.rpc('get_organization_plan', { p_organization_id: organization.id }),
  ]);
  empty.settings = trackingSettingsSchema.parse(requireData(settings));
  empty.features = getPlan(
    z.array(planSchema).min(1).parse(requireData(plan))[0]!.plan_key,
  ).features;
  if (!brand) return empty;
  const draftQuery = supabase
    .from('drafts')
    .select('id,current_version,brand_id,opportunity_id')
    .eq('organization_id', organization.id)
    .eq('brand_id', brand.id)
    .eq('status', 'approved')
    .is('purged_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  const [links, drafts, keys] = await Promise.all([
    supabase
      .from('tracking_links')
      .select(
        'id,organization_id,brand_id,opportunity_id,draft_id,draft_version,code,destination_url,utm_config,overwrite_utm,status,created_at,revoked_at',
        { count: 'exact' },
      )
      .eq('organization_id', organization.id)
      .eq('brand_id', brand.id)
      .order('status', { ascending: true })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1),
    selectedDraftId ? draftQuery.eq('id', selectedDraftId) : draftQuery,
    workspace.canManage
      ? supabase.rpc('list_conversion_api_keys', {
          p_organization_id: organization.id,
          p_brand_id: brand.id,
        })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const choices = z
    .array(
      z.object({
        id: z.uuid(),
        current_version: z.number().int(),
        brand_id: z.uuid(),
        opportunity_id: z.uuid(),
      }),
    )
    .parse(requireData(drafts));
  const titles = choices.length
    ? z.array(z.object({ id: z.uuid(), summary: z.string() })).parse(
        requireData(
          await supabase
            .from('opportunities')
            .select('id,summary')
            .eq('organization_id', organization.id)
            .in(
              'id',
              choices.map((d) => d.opportunity_id),
            ),
        ),
      )
    : [];
  return {
    ...empty,
    pagination: {
      page,
      pageSize,
      total: links.count ?? 0,
      totalPages: Math.max(1, Math.ceil((links.count ?? 0) / pageSize)),
    },
    links: z.array(trackingLinkSchema).parse(requireData(links)),
    keys: z.array(conversionKeyRecordSchema).parse(requireData(keys)),
    drafts: choices.map((d) => ({
      ...d,
      title: titles.find((o) => o.id === d.opportunity_id)?.summary || 'Approved reply',
    })),
  };
}
export async function loadAnalytics(input: unknown = {}) {
  const parsed = analyticsFiltersSchema.safeParse(input);
  const filters = parsed.success ? parsed.data : {};
  const workspace = await loadSignalWorkspace(filters.brandId);
  const today = new Date().toISOString().slice(0, 10);
  const from = filters.from ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const normalized = { ...filters, from, to: filters.to ?? today };
  const valid = parsed.success && analyticsFiltersSchema.safeParse(normalized).success;
  const base = {
    ...workspace,
    filters: normalized,
    invalidFilters: !valid,
    advancedAnalytics: false,
    options: {
      brands: workspace.brands.map((b) => ({ id: b.id, name: b.name })),
      subreddits: [] as Array<{ id: string; name: string }>,
      opportunities: [] as Array<{ id: string; name: string }>,
      competitors: [] as Array<{ id: string; name: string }>,
    },
    analytics: null as z.infer<typeof analyticsReportSchema> | null,
  };
  if (!workspace.enabled) return base;
  const { supabase, organization } = workspace;
  const [monitors, opportunities, competitors, plan] = await Promise.all([
    supabase
      .from('brand_subreddits')
      .select('subreddit:subreddits(id,name)')
      .eq('organization_id', organization.id)
      .limit(200),
    supabase
      .from('opportunities')
      .select('id,summary')
      .eq('organization_id', organization.id)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('brand_competitors')
      .select('id,name')
      .eq('organization_id', organization.id)
      .limit(100),
    supabase.rpc('get_organization_plan', { p_organization_id: organization.id }),
  ]);
  base.advancedAnalytics = getPlan(
    z.array(planSchema).min(1).parse(requireData(plan))[0]!.plan_key,
  ).features.advancedAnalytics;
  if (!base.advancedAnalytics && (filters.competitorId || filters.style)) {
    base.invalidFilters = true;
    return base;
  }
  const communityRows = z
    .array(z.object({ subreddit: z.object({ id: z.uuid(), name: z.string() }) }))
    .parse(requireData(monitors));
  base.options.subreddits = [
    ...new Map(communityRows.map((r) => [r.subreddit.id, r.subreddit])).values(),
  ];
  base.options.opportunities = z
    .array(z.object({ id: z.uuid(), summary: z.string() }))
    .parse(requireData(opportunities))
    .map((o) => ({ id: o.id, name: o.summary }));
  base.options.competitors = z
    .array(z.object({ id: z.uuid(), name: z.string() }))
    .parse(requireData(competitors));
  if (!valid) return base;
  const query: Record<string, string> = { from: normalized.from, to: normalized.to };
  for (const [key, column] of Object.entries({
    brandId: 'brand_id',
    subredditId: 'subreddit_id',
    opportunityId: 'opportunity_id',
    competitorId: 'competitor_id',
    event: 'event',
    intent: 'intent',
    style: 'style',
  })) {
    const value = Reflect.get(filters, key) as unknown;
    if (typeof value === 'string') query[column] = value;
  }
  base.analytics = analyticsReportSchema.parse(
    requireData(
      await supabase.rpc('get_attribution_analytics', {
        p_organization_id: organization.id,
        p_filters: query,
      }),
    ),
  );
  // Resolve report labels through tenant-scoped Supabase reads, including older conversations
  // outside the recent filter choices. The SQL report bounds each breakdown to 100 rows.
  const opportunityIds = z
    .array(z.uuid())
    .max(100)
    .parse(base.analytics.breakdowns.opportunities.map((row) => row.id));
  const titles = new Map(base.options.opportunities.map((row) => [row.id, row.name]));
  const missingIds = opportunityIds.filter((id) => !titles.has(id));
  if (missingIds.length) {
    const older = z
      .array(z.object({ id: z.uuid(), summary: z.string() }))
      .parse(
        requireData(
          await supabase
            .from('opportunities')
            .select('id,summary')
            .eq('organization_id', organization.id)
            .in('id', missingIds)
            .limit(100),
        ),
      );
    for (const row of older) titles.set(row.id, row.summary);
  }
  base.analytics.breakdowns.opportunities = base.analytics.breakdowns.opportunities.map((row) => ({
    ...row,
    label: titles.get(row.id)?.trim() || 'Conversation details',
  }));
  return base;
}
