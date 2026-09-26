import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getPlan } from '@threadsignal/config';
import { loadWorkspace } from '@/lib/organizations/server';
import { planSchema } from '@/lib/organizations/schema';
import { localKnowledgeEnabled } from '@/lib/knowledge/server';
import { localOpportunitiesEnabled } from '@/lib/phase3/server';
import { billingEnabled } from '@/lib/phase7/server';
import { billingUsageSchema } from '@/components/phase7/types';
import type { SetupSnapshot } from './model';

const brandsSchema = z.array(
  z.object({ id: z.uuid(), name: z.string(), status: z.enum(['active', 'archived']) }),
);
function read<T>(result: { data: T; error: unknown }) {
  if (result.error) throw new Error('Workspace setup could not be loaded. Please try again.');
  return result.data;
}

export const loadWorkspaceChrome = cache(async () => {
  const workspace = await loadWorkspace();
  const knowledgeEnabled = localKnowledgeEnabled();
  const pipelineEnabled = localOpportunitiesEnabled();
  if (!workspace.active)
    return {
      ...workspace,
      brands: [],
      knowledgeEnabled,
      pipelineEnabled,
      planName: 'Your workspace',
      draftUsage: null,
    };
  const id = workspace.active.id;
  const [brandsResult, planResult, usageResult] = await Promise.all([
    knowledgeEnabled
      ? workspace.supabase
          .from('brands')
          .select('id,name,status')
          .eq('organization_id', id)
          .order('created_at')
          .limit(100)
      : { data: [], error: null },
    workspace.supabase.rpc('get_organization_plan', { p_organization_id: id }),
    billingEnabled()
      ? workspace.supabase.rpc('get_billing_usage', { p_organization_id: id })
      : null,
  ]);
  const plan = z.array(planSchema).min(1).parse(read(planResult))[0]!;
  const usage = usageResult ? billingUsageSchema.parse(read(usageResult)) : null;
  return {
    ...workspace,
    brands: brandsSchema.parse(read(brandsResult)),
    knowledgeEnabled,
    pipelineEnabled,
    planName: `${getPlan(plan.plan_key).name} · ${plan.status.replaceAll('_', ' ')}`,
    draftUsage: usage?.meters.find((meter) => meter.metric === 'ai_drafts') ?? null,
  };
});

/** Setup is derived from saved tenant records; no localStorage flags or fake completion. */
export async function loadOnboarding(brandId?: string) {
  const workspace = await loadWorkspaceChrome();
  const brand = brandId
    ? workspace.brands.find((item) => item.id === brandId && item.status === 'active')
    : workspace.brands.find((item) => item.status === 'active');
  if (workspace.knowledgeEnabled && brandId && !brand) notFound();
  const state: SetupSnapshot = {
    brandId: brand?.id ?? null,
    knowledgeReady: 0,
    knowledgePending: 0,
    knowledgeFailed: 0,
    communities: 0,
    keywords: 0,
    opportunities: 0,
    pipelineEnabled: workspace.pipelineEnabled,
  };
  if (!workspace.active || !brand) return { ...workspace, brand, state };
  const { supabase } = workspace;
  const org = workspace.active.id;
  const [sources, documents, communities, keywords, opportunities] = await Promise.all([
    supabase
      .from('knowledge_sources')
      .select('id,status,chunk_count')
      .eq('organization_id', org)
      .eq('brand_id', brand.id)
      .is('deleted_at', null)
      .limit(200),
    supabase
      .from('knowledge_documents')
      .select('source_id')
      .eq('organization_id', org)
      .eq('brand_id', brand.id)
      .eq('is_included', true)
      .limit(500),
    workspace.pipelineEnabled
      ? supabase
          .from('brand_subreddits')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', org)
          .eq('brand_id', brand.id)
          .eq('status', 'active')
      : null,
    workspace.pipelineEnabled
      ? supabase
          .from('brand_keywords')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', org)
          .eq('brand_id', brand.id)
          .eq('status', 'active')
          .eq('is_exclusion', false)
      : null,
    workspace.pipelineEnabled
      ? supabase
          .from('opportunities')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', org)
          .eq('brand_id', brand.id)
          .not('evaluated_at', 'is', null)
          .gte('final_score', 40)
          .eq('is_blocked', false)
          .not('status', 'in', '(archived,dismissed)')
      : null,
  ]);
  const rows = z
    .array(
      z.object({ id: z.uuid(), status: z.string(), chunk_count: z.number().int().nonnegative() }),
    )
    .parse(read(sources));
  const included = new Set(
    z
      .array(z.object({ source_id: z.uuid() }))
      .parse(read(documents))
      .map((item) => item.source_id),
  );
  const count = (result: { data: unknown; error: unknown; count: number | null } | null) => {
    if (!result) return 0;
    read(result);
    return z.number().int().nonnegative().parse(result.count);
  };
  return {
    ...workspace,
    brand,
    state: {
      ...state,
      knowledgeReady: rows.filter(
        (item) =>
          ['ready', 'partial'].includes(item.status) &&
          item.chunk_count > 0 &&
          included.has(item.id),
      ).length,
      knowledgePending: rows.filter((item) => ['pending', 'processing'].includes(item.status))
        .length,
      knowledgeFailed: rows.filter((item) => item.status === 'failed').length,
      communities: count(communities),
      keywords: count(keywords),
      opportunities: count(opportunities),
    },
  };
}
