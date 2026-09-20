import 'server-only';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireOrganization } from '@/lib/organizations/server';
import { getServerEnv } from '@/lib/env/server';
import { brandColumns } from '@/lib/knowledge/server';
import { brandSchema } from '@threadsignal/knowledge';
import {
  communitySchema,
  feedFilterSchema,
  keywordRecordSchema,
  monitoringSchema,
  opportunitySchema,
  ruleSchema,
  usageSchema,
  type FeedFilters,
} from './schema';

export function localOpportunitiesEnabled() {
  return (
    process.env.THREADSIGNAL_LOCAL === '1' &&
    process.env.THREADSIGNAL_SERVICES_READY === '1' &&
    getServerEnv().THREADSIGNAL_SUPABASE_MODE === 'local'
  );
}
export const communityColumns =
  'id,name,display_name,description,subscriber_count,is_nsfw,last_synced_at' as const;
const opportunityColumns =
  `id,organization_id,brand_id,subreddit_id,status,summary,user_need,intent_category,risk_level,semantic_relevance,buying_intent,freshness,engagement_velocity,rule_fit,competitor_context,penalty_score,final_score,suggested_action,is_blocked,risk_reasons,matched_capabilities,missing_capabilities,matched_competitor_ids,reasoning_summary,knowledge_citations,evaluated_at,created_at` as const;
const feedColumns =
  `${opportunityColumns},post:reddit_posts!inner(id,title,body,permalink,created_at_provider,score,num_comments,is_deleted,is_locked,is_archived),subreddit:subreddits!inner(${communityColumns})` as const;
function checked<T>(result: { data: T; error: unknown }, message: string): T {
  if (result.error) throw new Error(message);
  return result.data;
}
export async function loadSignalWorkspace(brandId?: string) {
  const { organization, supabase } = await requireOrganization();
  const enabled = localOpportunitiesEnabled();
  const brands = enabled
    ? z
        .array(brandSchema)
        .parse(
          checked(
            await supabase
              .from('brands')
              .select(brandColumns)
              .eq('organization_id', organization.id)
              .order('created_at'),
            'Brands could not be loaded.',
          ),
        )
    : [];
  const brand = brandId
    ? brands.find((item) => item.id === brandId)
    : brands.find((item) => item.status === 'active');
  if (enabled && brandId && !brand) notFound();
  return {
    organization,
    supabase,
    brands,
    brand,
    enabled,
    canManage: ['owner', 'admin'].includes(organization.role),
    canAct: organization.role !== 'viewer',
  };
}
export async function loadMonitoring(brandId?: string) {
  const workspace = await loadSignalWorkspace(brandId);
  const { brand, supabase, organization } = workspace;
  const communities = brand
    ? z
        .array(monitoringSchema)
        .parse(
          checked(
            await supabase
              .from('brand_subreddits')
              .select(
                `id,organization_id,brand_id,subreddit_id,status,priority,minimum_score,risk_level,product_relevance,allowed_reply_style,internal_notes,internal_interpretation,monitor_new,monitor_hot,monitor_rising,subreddit:subreddits(${communityColumns})`,
              )
              .eq('organization_id', organization.id)
              .eq('brand_id', brand.id)
              .order('priority', { ascending: false }),
            'Communities could not be loaded.',
          ),
        )
    : [];
  const rules = communities.length
    ? z.array(ruleSchema).parse(
        checked(
          await supabase
            .from('subreddit_rules')
            .select('id,subreddit_id,title,description,last_synced_at')
            .in(
              'subreddit_id',
              communities.map((item) => item.subreddit_id),
            )
            .order('title'),
          'Community rules could not be loaded.',
        ),
      )
    : [];
  const assessments = brand
    ? z
        .array(
          z.object({
            subreddit_id: z.uuid(),
            semantic_relevance: z.coerce.number(),
            risk_level: z.enum(['low', 'medium', 'high', 'blocked']),
          }),
        )
        .parse(
          checked(
            await supabase
              .from('opportunities')
              .select('subreddit_id,semantic_relevance,risk_level')
              .eq('organization_id', organization.id)
              .eq('brand_id', brand.id)
              .order('evaluated_at', { ascending: false })
              .limit(500),
            'Recent community assessments could not be loaded.',
          ),
        )
    : [];
  const checkpoints = communities.length
    ? z
        .array(
          z.object({
            subreddit_id: z.uuid(),
            last_success_at: z.string().nullable(),
            next_sync_at: z.string(),
            provider_paused: z.boolean(),
            consecutive_errors: z.number(),
          }),
        )
        .parse(
          checked(
            await supabase
              .from('reddit_sync_checkpoints')
              .select(
                'subreddit_id,last_success_at,next_sync_at,provider_paused,consecutive_errors',
              )
              .in(
                'subreddit_id',
                communities.map((community) => community.subreddit_id),
              ),
            'Monitoring status could not be loaded.',
          ),
        )
    : [];
  const riskOrder = { low: 0, medium: 1, high: 2, blocked: 3 };
  const assessed = communities.map((community) => {
    const recent = assessments.filter((item) => item.subreddit_id === community.subreddit_id);
    const checkpointsForCommunity = checkpoints.filter(
      (item) => item.subreddit_id === community.subreddit_id,
    );
    return {
      ...community,
      sync: checkpointsForCommunity.length
        ? {
            paused: checkpointsForCommunity.some((item) => item.provider_paused),
            failed: checkpointsForCommunity.some((item) => item.consecutive_errors > 0),
            last_success_at:
              checkpointsForCommunity
                .map((item) => item.last_success_at)
                .filter((date) => date !== null)
                .sort()
                .at(-1) ?? null,
            next_sync_at: checkpointsForCommunity.map((item) => item.next_sync_at).sort()[0]!,
          }
        : null,
      assessment: recent.length
        ? {
            count: recent.length,
            product_relevance: Math.round(
              recent.reduce((sum, item) => sum + item.semantic_relevance, 0) / recent.length,
            ),
            risk_level: recent.reduce(
              (highest, item) =>
                riskOrder[item.risk_level] > riskOrder[highest] ? item.risk_level : highest,
              'low' as 'low' | 'medium' | 'high' | 'blocked',
            ),
          }
        : null,
    };
  });
  return { ...workspace, communities: assessed, rules };
}
export async function loadKeywords(brandId?: string) {
  const workspace = await loadSignalWorkspace(brandId);
  const keywords = workspace.brand
    ? z
        .array(keywordRecordSchema)
        .parse(
          checked(
            await workspace.supabase
              .from('brand_keywords')
              .select('id,brand_id,value,kind,is_exclusion,status,source')
              .eq('organization_id', workspace.organization.id)
              .eq('brand_id', workspace.brand.id)
              .order('created_at'),
            'Keywords could not be loaded.',
          ),
        )
    : [];
  return { ...workspace, keywords };
}
const cursorSchema = z
  .object({
    sort: z.enum(['score', 'freshness', 'engagement']),
    value: z.number().finite().min(0).max(100),
    id: z.uuid(),
  })
  .strict();
export function decodeFeedCursor(value: string | undefined, sort: FeedFilters['sort']) {
  if (!value) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (cursor.sort !== sort) throw new Error();
    return cursor;
  } catch {
    throw new Error('The page cursor is invalid. Reset the filters.');
  }
}
export async function loadOpportunities(input: unknown) {
  const parsed = feedFilterSchema.safeParse(input);
  let invalidFilters = !parsed.success;
  const filters = parsed.success ? parsed.data : feedFilterSchema.parse({});
  const workspace = await loadSignalWorkspace(filters.brandId);
  const { supabase, organization, brand } = workspace;
  const sortColumn = {
    score: 'final_score',
    freshness: 'freshness',
    engagement: 'engagement_velocity',
  }[filters.sort] as 'final_score' | 'freshness' | 'engagement_velocity';
  let cursor: ReturnType<typeof decodeFeedCursor>;
  try {
    cursor = decodeFeedCursor(filters.cursor, filters.sort);
  } catch {
    invalidFilters = true;
    delete filters.cursor;
  }
  let items: z.infer<typeof opportunitySchema>[] = [];
  let nextCursor: string | null = null;
  if (brand && !invalidFilters) {
    let query = supabase
      .from('opportunities')
      .select(feedColumns)
      .eq('organization_id', organization.id)
      .eq('brand_id', brand.id)
      .order(sortColumn, { ascending: false })
      .order('id', { ascending: false })
      .limit(25);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.risk) query = query.eq('risk_level', filters.risk);
    if (filters.intent) query = query.eq('intent_category', filters.intent);
    if (filters.subreddit) query = query.eq('subreddit_id', filters.subreddit);
    // This column is JSONB; a JavaScript array is serialized as a PostgreSQL array by PostgREST.
    if (filters.competitorId)
      query = query.contains('matched_competitor_ids', JSON.stringify([filters.competitorId]));
    if (filters.from) query = query.gte('post.created_at_provider', `${filters.from}T00:00:00Z`);
    if (filters.to) query = query.lte('post.created_at_provider', `${filters.to}T23:59:59.999Z`);
    if (filters.q) query = query.ilike('post.title', `%${filters.q.replace(/[\\%_]/g, '\\$&')}%`);
    query =
      filters.status === 'blocked' || filters.risk === 'blocked'
        ? query
        : query.gte('final_score', filters.minimumScore);
    if (cursor)
      query = query.or(
        `${sortColumn}.lt.${cursor.value},and(${sortColumn}.eq.${cursor.value},id.lt.${cursor.id})`,
      );
    const rows = z
      .array(opportunitySchema)
      .parse(checked(await query, 'Opportunities could not be loaded.'));
    items = rows.slice(0, 24);
    const last = items.at(-1);
    if (rows.length > 24 && last)
      nextCursor = Buffer.from(
        JSON.stringify({ sort: filters.sort, value: last[sortColumn], id: last.id }),
      ).toString('base64url');
  }
  const communities = brand
    ? z
        .array(communitySchema)
        .parse(
          checked(
            await supabase.from('subreddits').select(communityColumns).order('name'),
            'Community options could not be loaded.',
          ),
        )
    : [];
  const competitors = brand
    ? z
        .array(z.object({ id: z.uuid(), name: z.string() }))
        .parse(
          checked(
            await supabase
              .from('brand_competitors')
              .select('id,name')
              .eq('organization_id', organization.id)
              .eq('brand_id', brand.id),
            'Competitor options could not be loaded.',
          ),
        )
    : [];
  const usage = workspace.enabled
    ? usageSchema.parse(
        checked(
          await supabase.rpc('get_opportunity_usage', { p_organization_id: organization.id }),
          'Usage could not be loaded.',
        ),
      )
    : null;
  return {
    ...workspace,
    items,
    filters,
    invalidFilters,
    nextCursor,
    communities,
    competitors,
    usage,
  };
}
export async function loadOpportunity(id: string) {
  const workspace = await loadSignalWorkspace();
  if (!workspace.enabled)
    return { ...workspace, opportunity: null, rules: [], monitoring: null, competitors: [] };
  if (!z.uuid().safeParse(id).success) notFound();
  const value = checked(
    await workspace.supabase
      .from('opportunities')
      .select(
        `${opportunityColumns},post:reddit_posts!inner(id,title,body,permalink,created_at_provider,score,num_comments,is_deleted,is_locked,is_archived),subreddit:subreddits!inner(${communityColumns})`,
      )
      .eq('organization_id', workspace.organization.id)
      .eq('id', id)
      .maybeSingle(),
    'The opportunity could not be loaded.',
  );
  if (!value) notFound();
  const opportunity = opportunitySchema.parse(value);
  const rules = z
    .array(ruleSchema)
    .parse(
      checked(
        await workspace.supabase
          .from('subreddit_rules')
          .select('id,subreddit_id,title,description,last_synced_at')
          .eq('subreddit_id', opportunity.subreddit_id)
          .order('title'),
        'Rules could not be loaded.',
      ),
    );
  const monitoring = checked(
    await workspace.supabase
      .from('brand_subreddits')
      .select('internal_notes,internal_interpretation,allowed_reply_style')
      .eq('organization_id', workspace.organization.id)
      .eq('brand_id', opportunity.brand_id)
      .eq('subreddit_id', opportunity.subreddit_id)
      .maybeSingle(),
    'Monitoring guidance could not be loaded.',
  );
  const competitors = z
    .array(z.object({ id: z.uuid(), name: z.string(), notes: z.string() }))
    .parse(
      checked(
        await workspace.supabase
          .from('brand_competitors')
          .select('id,name,notes')
          .eq('organization_id', workspace.organization.id)
          .eq('brand_id', opportunity.brand_id),
        'Competitor context could not be loaded.',
      ),
    );
  return { ...workspace, opportunity, rules, monitoring, competitors };
}
