import 'server-only';
import { z } from 'zod';
import { requireOrganization } from '../organizations/server';
import { localOpportunitiesEnabled, communityColumns } from './server';
import { monitoringSchema, keywordRecordSchema } from './schema';
import { SignalError } from './api';

export async function readBrandMonitoring(
  request: Request,
  brandId: string,
  kind: 'subreddits' | 'keywords',
) {
  if (!localOpportunitiesEnabled()) throw new SignalError('LOCAL_ONLY', 503);
  const { organization, supabase } = await requireOrganization();
  const id = z.uuid().parse(brandId);
  const brand = await supabase
    .from('brands')
    .select('id')
    .eq('id', id)
    .eq('organization_id', organization.id)
    .maybeSingle();
  if (brand.error) throw new SignalError('PROCESSING_FAILED', 500);
  if (!brand.data) throw new SignalError('NOT_FOUND', 404);
  const params = new URL(request.url).searchParams;
  const { limit, after } = z
    .object({ limit: z.coerce.number().int().min(1).max(100), after: z.uuid().optional() })
    .parse({ limit: params.get('limit') ?? 25, after: params.get('after') ?? undefined });
  if (kind === 'keywords') {
    let query = supabase
      .from('brand_keywords')
      .select('id,brand_id,value,kind,is_exclusion,status,source')
      .eq('organization_id', organization.id)
      .eq('brand_id', id)
      .order('id')
      .limit(limit + 1);
    if (after) query = query.gt('id', after);
    const result = await query;
    if (result.error) throw new SignalError('PROCESSING_FAILED', 500);
    const items = z.array(keywordRecordSchema).parse(result.data);
    return {
      keywords: items.slice(0, limit),
      next_cursor: items.length > limit ? items[limit - 1]!.id : null,
    };
  }
  let query = supabase
    .from('brand_subreddits')
    .select(
      `id,organization_id,brand_id,subreddit_id,status,priority,minimum_score,risk_level,product_relevance,allowed_reply_style,internal_notes,internal_interpretation,monitor_new,monitor_hot,monitor_rising,subreddit:subreddits(${communityColumns})`,
    )
    .eq('organization_id', organization.id)
    .eq('brand_id', id)
    .order('id')
    .limit(limit + 1);
  if (after) query = query.gt('id', after);
  const result = await query;
  if (result.error) throw new SignalError('PROCESSING_FAILED', 500);
  const items = z.array(monitoringSchema).parse(result.data);
  return {
    subreddits: items.slice(0, limit),
    next_cursor: items.length > limit ? items[limit - 1]!.id : null,
  };
}
