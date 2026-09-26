import 'server-only';
import { withWebAIUsage } from '../env/ai-usage';
import { providerEmbeddingIdentity } from '@threadsignal/ai';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { configuredAIProvider } from '../env/providers';
import { deploymentRuntime } from '../env/runtime';
import {
  brandSchema,
  sourceSchema,
  documentSchema,
  searchResultSchema,
  EMBEDDING_DIMENSIONS,
} from '@threadsignal/knowledge';
import { requireOrganization } from '@/lib/organizations/server';
import { getServerEnv } from '@/lib/env/server';

export function localKnowledgeEnabled() {
  if (deploymentRuntime(getServerEnv())) return true;
  // Both profiles run on this machine. Hosted access is enabled only by the dedicated launcher
  // after it verifies the selected project's schema and its separate worker's readiness.
  if (process.env.THREADSIGNAL_LOCAL !== '1' || process.env.THREADSIGNAL_SERVICES_READY !== '1')
    return false;
  const env = getServerEnv();
  if (env.THREADSIGNAL_SUPABASE_MODE === 'local') return true;
  const projectRef = env.THREADSIGNAL_SUPABASE_PROJECT_REF;
  return (
    env.THREADSIGNAL_HOSTED_KNOWLEDGE_READY === '1' &&
    env.THREADSIGNAL_SUPABASE_MODE === 'personal-development' &&
    typeof projectRef === 'string' &&
    /^[a-z]{20}$/.test(projectRef) &&
    env.NEXT_PUBLIC_SUPABASE_URL === `https://${projectRef}.supabase.co`
  );
}
export const brandColumns =
  'id,organization_id,name,website_url,profile,status,created_at' as const;
export const sourceColumns =
  'id,organization_id,brand_id,name,type,status,source_url,storage_path,filename,mime_type,error_code,page_count,chunk_count,generation,created_at,updated_at,last_ingested_at,deleted_at' as const;
export async function loadBrands() {
  const { organization, supabase } = await requireOrganization();
  const localEnabled = localKnowledgeEnabled();
  const result = localEnabled
    ? await supabase
        .from('brands')
        .select(brandColumns)
        .eq('organization_id', organization.id)
        .order('created_at')
    : { data: [], error: null };
  if (result.error) throw new Error('Brands could not be loaded.');
  return {
    organization,
    brands: z.array(brandSchema).parse(result.data),
    canManage: ['owner', 'admin'].includes(organization.role),
    localEnabled,
  };
}
export async function loadBrand(id: string) {
  const workspace = await loadBrands();
  if (!workspace.localEnabled) return { ...workspace, brand: undefined };
  if (!z.uuid().safeParse(id).success) notFound();
  const brand = workspace.brands.find((item) => item.id === id);
  if (!brand) notFound();
  return { ...workspace, brand };
}
export async function loadKnowledge(brandId?: string) {
  const workspace = await loadBrands();
  const brand = brandId
    ? workspace.brands.find((item) => item.id === brandId)
    : workspace.brands.find((item) => item.status === 'active');
  if (workspace.localEnabled && brandId && !brand) notFound();
  const { supabase } = await requireOrganization(workspace.organization.id);
  const result = brand
    ? await supabase
        .from('knowledge_sources')
        .select(sourceColumns)
        .eq('organization_id', workspace.organization.id)
        .eq('brand_id', brand.id)
        .order('created_at', { ascending: false })
        .limit(200)
    : { data: [], error: null };
  if (result.error) throw new Error('Knowledge sources could not be loaded.');
  return { ...workspace, brand, sources: z.array(sourceSchema).parse(result.data) };
}
export async function loadKnowledgeSource(id: string) {
  const workspace = await loadBrands();
  if (!workspace.localEnabled)
    return { ...workspace, brand: undefined, source: undefined, documents: [] };
  if (!z.uuid().safeParse(id).success) notFound();
  const { supabase } = await requireOrganization(workspace.organization.id);
  const result = await supabase
    .from('knowledge_sources')
    .select(sourceColumns)
    .eq('id', id)
    .eq('organization_id', workspace.organization.id)
    .maybeSingle();
  if (result.error) throw new Error('The source could not be loaded.');
  if (!result.data) notFound();
  const source = sourceSchema.parse(result.data);
  const brand = workspace.brands.find((item) => item.id === source.brand_id);
  if (!brand) notFound();
  const docs = await supabase
    .from('knowledge_documents')
    .select('id,title,canonical_url,page_number,content,is_included,checksum')
    .eq('source_id', id)
    .eq('organization_id', workspace.organization.id)
    .order('created_at')
    .limit(100);
  if (docs.error) throw new Error('Extracted documents could not be loaded.');
  return { ...workspace, brand, source, documents: z.array(documentSchema).parse(docs.data) };
}
export async function searchKnowledge(brandId: string, query: string) {
  const { brand, organization, localEnabled } = await loadBrand(brandId);
  if (!localEnabled || !brand) return [];
  const validated = z.string().trim().min(1).max(500).parse(query);
  const { supabase, user } = await requireOrganization(organization.id);
  const provider = configuredAIProvider();
  const [embedding] = await withWebAIUsage(
    { organizationId: organization.id, brandId: brand.id, userId: user.id },
    'knowledge.search',
    provider,
    () =>
      provider.embed({
        texts: [validated],
        dimensions: EMBEDDING_DIMENSIONS,
      }),
  );
  const result = await supabase.rpc('search_knowledge', {
    p_brand_id: brand.id,
    p_embedding: JSON.stringify(embedding),
    p_query: validated,
    ...(getServerEnv().THREADSIGNAL_SUPABASE_MODE === 'personal-development'
      ? {}
      : { p_embedding_identity: providerEmbeddingIdentity(provider) }),
  });
  if (result.error) throw new Error('Knowledge search could not be completed.');
  return z.array(searchResultSchema).parse(result.data);
}
