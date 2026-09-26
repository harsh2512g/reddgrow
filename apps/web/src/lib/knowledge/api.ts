import 'server-only';
import { enforceMutationRateLimit } from '@/lib/mutation-rate-limit';
import { extractionProofSchema } from './extraction-schema';
import { randomUUID } from 'node:crypto';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import {
  brandInputSchema,
  brandSchema,
  sourceInputSchema,
  sourceSchema,
  MAX_UPLOAD_BYTES,
} from '@threadsignal/knowledge';
import { validateKnowledgeFile, IngestionError } from '@threadsignal/knowledge/files';
import { discoverFixturePages, SimpleCrawlerProvider } from '@threadsignal/crawler';
import { requireOrganization } from '@/lib/organizations/server';
import { hasTrustedOrigin } from '@/lib/auth/policy';
import { getServerEnv } from '@/lib/env/server';
import { deploymentRuntime } from '@/lib/env/runtime';
import { requireActiveProviderPlan } from '@/lib/provider-plan';
import { brandColumns, sourceColumns, localKnowledgeEnabled, searchKnowledge } from './server';
import {
  KnowledgeError,
  knowledgeErrorResponse,
  checkDatabaseError,
  knowledgeJson,
  boundedBody,
} from './http';

type Context = Awaited<ReturnType<typeof requireOrganization>>;
export async function apiContext(request: Request, manage = false) {
  if (!localKnowledgeEnabled()) throw new KnowledgeError('KNOWLEDGE_UNAVAILABLE', 503);
  if (manage && !hasTrustedOrigin(request.headers, getServerEnv().NEXT_PUBLIC_APP_URL))
    throw new KnowledgeError('FORBIDDEN', 403);
  const context = await requireOrganization();
  if (manage && !['owner', 'admin'].includes(context.organization.role))
    throw new KnowledgeError('FORBIDDEN', 403);
  if (manage) await enforceMutationRateLimit('knowledge', context.organization.id);
  return context;
}
function id(value: string) {
  const result = z.uuid().safeParse(value);
  if (!result.success) throw new KnowledgeError('NOT_FOUND', 404);
  return result.data;
}
export async function ownedBrand(context: Context, brandId: string) {
  const result = await context.supabase
    .from('brands')
    .select(brandColumns)
    .eq('id', id(brandId))
    .eq('organization_id', context.organization.id)
    .maybeSingle();
  checkDatabaseError(result.error);
  if (!result.data) throw new KnowledgeError('NOT_FOUND', 404);
  return brandSchema.parse(result.data);
}
async function ownedSource(context: Context, sourceId: string) {
  const result = await context.supabase
    .from('knowledge_sources')
    .select(sourceColumns)
    .eq('id', id(sourceId))
    .eq('organization_id', context.organization.id)
    .maybeSingle();
  checkDatabaseError(result.error);
  if (!result.data) throw new KnowledgeError('NOT_FOUND', 404);
  return sourceSchema.parse(result.data);
}
export async function knowledgeRoute(action: () => Promise<unknown>) {
  try {
    const data = await action();
    return data instanceof Response
      ? data
      : Response.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    unstable_rethrow(error);
    return knowledgeErrorResponse(error);
  }
}
export async function createBrand(request: Request) {
  const { supabase, organization } = await apiContext(request, true);
  if (request.headers.get('x-threadsignal-organization') !== organization.id)
    throw new KnowledgeError('WORKSPACE_CHANGED', 409);
  const profile = await knowledgeJson(request, brandInputSchema);
  // Supabase's generated RPC parameter type omits SQL argument nullability; null creates a brand.
  const result = await supabase.rpc('save_brand', {
    p_organization_id: organization.id,
    p_id: null as unknown as string,
    p_profile: profile,
  });
  checkDatabaseError(result.error);
  return { id: z.uuid().parse(result.data) };
}
export async function updateBrand(request: Request, brandId: string) {
  const context = await apiContext(request, true);
  const brand = await ownedBrand(context, brandId);
  const input = await knowledgeJson(
    request,
    z.union([
      z
        .object({ profile: brandInputSchema, extraction: extractionProofSchema.optional() })
        .strict(),
      z.object({ archived: z.boolean() }).strict(),
    ]),
  );
  if ('profile' in input && input.extraction) {
    const { assertExtractionCurrent } = await import('./extraction');
    await assertExtractionCurrent(context, brand.id, input.extraction.checksum);
  }
  const result =
    'profile' in input
      ? await context.supabase.rpc('save_brand', {
          p_organization_id: context.organization.id,
          p_id: brand.id,
          p_profile: input.profile,
        })
      : await context.supabase.rpc('archive_brand', {
          p_brand_id: brand.id,
          p_archived: input.archived,
        });
  checkDatabaseError(result.error);
  return { id: brand.id };
}
export async function sourcePages(request: Request, brandId: string) {
  const context = await apiContext(request);
  const brand = await ownedBrand(context, brandId);
  const env = getServerEnv();
  if (env.CRAWLER_PROVIDER === 'fixture') return { pages: discoverFixturePages(brand.website_url) };
  if (!deploymentRuntime(env) || env.CRAWLER_PROVIDER !== 'simple')
    throw new KnowledgeError('KNOWLEDGE_UNAVAILABLE', 503);
  if (!['owner', 'admin'].includes(context.organization.role))
    throw new KnowledgeError('FORBIDDEN', 403);
  await enforceMutationRateLimit('knowledge', context.organization.id);
  if (brand.status !== 'active') throw new KnowledgeError('BRAND_ARCHIVED', 409);
  const { plan_key: planKey } = await requireActiveProviderPlan(context.organization.id);
  const maxPages = planKey === 'growth' ? env.MAX_GROWTH_CRAWL_PAGES : env.MAX_SOLO_CRAWL_PAGES;
  return {
    pages: await new SimpleCrawlerProvider({ timeoutMs: 12_000 }).discoverPages(
      {
        url: brand.website_url,
        approvedDomains: [new URL(brand.website_url).hostname],
      },
      Math.min(maxPages, 100),
    ),
  };
}
export async function addSource(request: Request, brandId: string) {
  const context = await apiContext(request, true);
  const brand = await ownedBrand(context, brandId);
  const input = await knowledgeJson(request, sourceInputSchema);
  if (input.type === 'file') throw new KnowledgeError('INVALID_INPUT');
  const result = await context.supabase.rpc('add_knowledge_source', {
    p_brand_id: brand.id,
    p_id: randomUUID(),
    p_input: input,
  });
  checkDatabaseError(result.error);
  return { id: z.uuid().parse(result.data) };
}
export async function uploadSource(request: Request, brandId: string) {
  const context = await apiContext(request, true);
  const brand = await ownedBrand(context, brandId);
  if (brand.status !== 'active') throw new KnowledgeError('BRAND_ARCHIVED', 409);
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data; boundary=/i.test(contentType))
    throw new KnowledgeError('INVALID_INPUT');
  const bytes = await boundedBody(request, MAX_UPLOAD_BYTES + 16_384);
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw new KnowledgeError('INVALID_INPUT');
  }
  const file = form.get('file');
  const name = z.string().trim().min(2).max(150).safeParse(form.get('name'));
  if (!(file instanceof File) || !name.success || form.getAll('file').length !== 1)
    throw new KnowledgeError('INVALID_INPUT');
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  // Browsers omit the MIME for Markdown on some platforms. Choose only from the extension allowlist.
  const mime =
    file.type ||
    (/\.(md|markdown)$/i.test(file.name)
      ? 'text/markdown'
      : /\.txt$/i.test(file.name)
        ? 'text/plain'
        : '');
  try {
    validateKnowledgeFile({ filename: file.name, mimeType: mime, bytes: fileBytes });
  } catch (error) {
    throw new KnowledgeError(
      error instanceof IngestionError ? error.code.toUpperCase() : 'INVALID_FILE',
    );
  }
  const safeName = file.name
    .replace(/\.markdown$/i, '.md')
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .replace(/^[^A-Za-z0-9]+/, 'file_');
  const extension = safeName.slice(safeName.lastIndexOf('.')).toLowerCase();
  const filename = safeName.slice(0, safeName.lastIndexOf('.')).slice(0, 130) + extension;
  const sourceId = randomUUID();
  const path = `${context.organization.id}/${brand.id}/${sourceId}/${filename}`;
  const input = sourceInputSchema.parse({
    name: name.data,
    type: 'file',
    filename,
    mime_type: mime,
    storage_path: path,
  });
  const bucket = context.supabase.storage.from('knowledge-private');
  const uploaded = await bucket.upload(path, fileBytes, { contentType: mime, upsert: false });
  if (uploaded.error) throw new KnowledgeError('STORAGE_UNAVAILABLE', 503);
  try {
    const result = await context.supabase.rpc('add_knowledge_source', {
      p_brand_id: brand.id,
      p_id: sourceId,
      p_input: input,
    });
    checkDatabaseError(result.error);
  } catch (error) {
    try {
      const cleanup = await bucket.remove([path]);
      if (cleanup.error) throw new Error();
    } catch {
      throw new KnowledgeError('UPLOAD_CLEANUP_FAILED', 503);
    }
    throw error;
  }
  return { id: sourceId };
}
export async function changeSource(
  request: Request,
  sourceId: string,
  operation: 'retry' | 'delete',
) {
  const context = await apiContext(request, true);
  const source = await ownedSource(context, sourceId);
  const result = await context.supabase.rpc(
    operation === 'retry' ? 'retry_knowledge_source' : 'delete_knowledge_source',
    { p_source_id: source.id },
  );
  checkDatabaseError(result.error);
  return { id: source.id };
}
export async function includeDocument(request: Request, documentId: string) {
  const context = await apiContext(request, true);
  const input = await knowledgeJson(request, z.object({ included: z.boolean() }).strict());
  const document = await context.supabase
    .from('knowledge_documents')
    .select('id')
    .eq('id', id(documentId))
    .eq('organization_id', context.organization.id)
    .maybeSingle();
  checkDatabaseError(document.error);
  if (!document.data) throw new KnowledgeError('NOT_FOUND', 404);
  const result = await context.supabase.rpc('set_knowledge_document_included', {
    p_document_id: document.data.id,
    p_included: input.included,
  });
  checkDatabaseError(result.error);
  return { id: document.data.id };
}
export async function runSearch(request: Request) {
  await apiContext(request);
  const params = new URL(request.url).searchParams;
  const query = z.string().trim().min(1).max(500).safeParse(params.get('q'));
  if (!query.success) throw new KnowledgeError('INVALID_INPUT');
  return searchKnowledge(id(params.get('brandId') ?? ''), query.data);
}
export async function downloadSource(request: Request, sourceId: string) {
  const context = await apiContext(request);
  const source = await ownedSource(context, sourceId);
  if (!source.storage_path || source.deleted_at) throw new KnowledgeError('NOT_FOUND', 404);
  const file = await context.supabase.storage
    .from('knowledge-private')
    .download(source.storage_path);
  if (file.error || !file.data) throw new KnowledgeError('NOT_FOUND', 404);
  return new Response(file.data, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${source.filename?.replace(/[^A-Za-z0-9_.-]/g, '_') ?? 'knowledge'}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
