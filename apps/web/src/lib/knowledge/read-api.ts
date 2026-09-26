import 'server-only';
import { z } from 'zod';
import { brandSchema, sourceSchema, documentSchema } from '@threadsignal/knowledge';
import { apiContext, ownedBrand } from './api';
import { brandColumns, sourceColumns } from './server';
import { KnowledgeError, checkDatabaseError, knowledgeInput } from './http';

function pagination(request: Request) {
  const params = new URL(request.url).searchParams;
  return knowledgeInput(
    {
      limit: params.get('limit') ?? 25,
      after: params.get('after') ?? undefined,
    },
    z.object({ limit: z.coerce.number().int().min(1).max(100), after: z.uuid().optional() }),
  );
}
export async function readBrands(request: Request, brandId?: string) {
  const context = await apiContext(request);
  if (brandId) return { brand: await ownedBrand(context, brandId) };
  const { limit, after } = pagination(request);
  let query = context.supabase
    .from('brands')
    .select(brandColumns)
    .eq('organization_id', context.organization.id)
    .order('id')
    .limit(limit + 1);
  if (after) query = query.gt('id', after);
  const result = await query;
  checkDatabaseError(result.error);
  const brands = z.array(brandSchema).parse(result.data);
  return {
    brands: brands.slice(0, limit),
    next_cursor: brands.length > limit ? brands[limit - 1]!.id : null,
  };
}
export async function readSources(request: Request, brandId: string) {
  const context = await apiContext(request);
  const brand = await ownedBrand(context, brandId);
  const { limit, after } = pagination(request);
  let query = context.supabase
    .from('knowledge_sources')
    .select(sourceColumns)
    .eq('organization_id', context.organization.id)
    .eq('brand_id', brand.id)
    .order('id')
    .limit(limit + 1);
  if (after) query = query.gt('id', after);
  const result = await query;
  checkDatabaseError(result.error);
  const sources = z.array(sourceSchema).parse(result.data);
  return {
    sources: sources.slice(0, limit),
    next_cursor: sources.length > limit ? sources[limit - 1]!.id : null,
  };
}
export async function readSource(request: Request, sourceId: string) {
  const context = await apiContext(request);
  const id = knowledgeInput(sourceId, z.uuid());
  const { limit, after } = pagination(request);
  const result = await context.supabase
    .from('knowledge_sources')
    .select(sourceColumns)
    .eq('organization_id', context.organization.id)
    .eq('id', id)
    .maybeSingle();
  checkDatabaseError(result.error);
  if (!result.data) throw new KnowledgeError('NOT_FOUND', 404);
  const source = sourceSchema.parse(result.data);
  let query = context.supabase
    .from('knowledge_documents')
    .select('id,title,canonical_url,page_number,content,is_included,checksum')
    .eq('organization_id', context.organization.id)
    .eq('source_id', source.id)
    .order('id')
    .limit(limit + 1);
  if (after) query = query.gt('id', after);
  const documents = await query;
  checkDatabaseError(documents.error);
  const rows = z.array(documentSchema).parse(documents.data);
  return {
    source,
    documents: rows.slice(0, limit),
    next_cursor: rows.length > limit ? rows[limit - 1]!.id : null,
  };
}
export async function archiveBrand(request: Request, brandId: string) {
  const context = await apiContext(request, true);
  const brand = await ownedBrand(context, brandId);
  if (request.headers.get('x-threadsignal-organization') !== context.organization.id)
    throw new KnowledgeError('WORKSPACE_CHANGED', 409);
  const result = await context.supabase.rpc('archive_brand', {
    p_brand_id: brand.id,
    p_archived: true,
  });
  checkDatabaseError(result.error);
  return { id: brand.id };
}
