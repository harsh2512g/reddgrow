import 'server-only';
import { enforceMutationRateLimit } from '@/lib/mutation-rate-limit';
import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { createRedditProvider } from '@threadsignal/reddit';
import {
  keywordInputSchema,
  communitySettingsSchema,
  dismissalReasonSchema,
} from '@threadsignal/opportunities';
import {
  suggestKeywords,
  suggestSubreddits,
  previewKeywordMatches,
} from '@threadsignal/opportunities/scoring';
import { brandSchema } from '@threadsignal/knowledge';
import { requireOrganization } from '@/lib/organizations/server';
import { hasTrustedOrigin } from '@/lib/auth/policy';
import { getServerEnv } from '@/lib/env/server';
import { brandColumns } from '@/lib/knowledge/server';
import { KnowledgeError, knowledgeJson } from '@/lib/knowledge/http';
import {
  localOpportunitiesEnabled,
  loadOpportunities,
  loadOpportunity,
  decodeFeedCursor,
} from './server';
import { feedFilterSchema, keywordRecordSchema } from './schema';

const messages: Record<string, string> = {
  LOCAL_ONLY: 'Community monitoring is available in the local development workspace.',
  FORBIDDEN: 'Your role cannot make this change.',
  RATE_LIMITED: 'Too many changes. Wait a minute before trying again.',
  RATE_LIMIT_UNAVAILABLE: 'Request protection is temporarily unavailable. Please retry.',
  NOT_FOUND: 'This item is unavailable in your workspace.',
  WORKSPACE_CHANGED: 'Your workspace changed. Reload this page before saving.',
  INVALID_INPUT: 'Check the fields and try again.',
  COMMUNITY_UNAVAILABLE:
    'This community is not in the mock provider. Search the available fixtures.',
  SUBREDDIT_LIMIT:
    'Your plan has reached its monitored community limit. Pause a community before adding another.',
  SUBREDDIT_RECORD_LIMIT: 'This brand has reached its stored community limit.',
  SUBREDDIT_PAUSED: 'Resume this community before requesting another sync.',
  KEYWORD_EXISTS: 'This term already exists for this brand.',
  KEYWORD_LIMIT: 'This brand has reached its keyword limit.',
  BRAND_ARCHIVED: 'Restore this brand before changing its monitoring.',
  OPPORTUNITY_LIMIT: 'Your plan has reached its opportunity allowance for this period.',
  TRIAL_EXPIRED: 'Your workspace trial has expired.',
  PLAN_INACTIVE: 'Your workspace plan is inactive.',
  POST_DELETED: 'The original discussion was deleted and cannot be re-evaluated.',
  PLAN_UNAVAILABLE: 'Your workspace plan is unavailable.',
  ALREADY_MONITORED: 'This community is already monitored by this brand.',
  OPPORTUNITY_BLOCKED: 'This opportunity is blocked. It cannot become actionable.',
  PROCESSING_FAILED: 'The request could not be completed. Please try again.',
};
export class SignalError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
function databaseError(error: { message: string; code?: string } | null) {
  if (!error) return;
  if (error.code === '42501') throw new SignalError('FORBIDDEN', 403);
  if (error.code === '23505') throw new SignalError('ALREADY_MONITORED', 409);
  if (error.code === '23514') throw new SignalError('INVALID_INPUT');
  if (messages[error.message]) throw new SignalError(error.message, 409);
  if (error.message.startsWith('INVALID_')) throw new SignalError('INVALID_INPUT');
  if (error.message.endsWith('_NOT_FOUND')) throw new SignalError('NOT_FOUND', 404);
  throw new SignalError('PROCESSING_FAILED', 500);
}
function id(value: string) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new SignalError('NOT_FOUND', 404);
  return parsed.data;
}
async function context(request: Request, permission: 'read' | 'manage' | 'act' = 'read') {
  if (!localOpportunitiesEnabled()) throw new SignalError('LOCAL_ONLY', 503);
  if (
    permission !== 'read' &&
    !hasTrustedOrigin(request.headers, getServerEnv().NEXT_PUBLIC_APP_URL)
  )
    throw new SignalError('FORBIDDEN', 403);
  const workspace = await requireOrganization();
  if (permission !== 'read') {
    if (request.headers.get('x-threadsignal-organization') !== workspace.organization.id)
      throw new SignalError('WORKSPACE_CHANGED', 409);
    if (
      (permission === 'manage' && !['owner', 'admin'].includes(workspace.organization.role)) ||
      workspace.organization.role === 'viewer'
    )
      throw new SignalError('FORBIDDEN', 403);
  }
  if (permission !== 'read')
    await enforceMutationRateLimit('opportunities', workspace.organization.id);
  return workspace;
}
type Context = Awaited<ReturnType<typeof context>>;
async function brandFor(workspace: Context, brandId: string) {
  const result = await workspace.supabase
    .from('brands')
    .select(brandColumns)
    .eq('id', id(brandId))
    .eq('organization_id', workspace.organization.id)
    .maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new SignalError('NOT_FOUND', 404);
  return brandSchema.parse(result.data);
}
async function owned(
  workspace: Context,
  table: 'brand_subreddits' | 'brand_keywords' | 'opportunities',
  targetId: string,
) {
  const result = await workspace.supabase
    .from(table)
    .select('id,brand_id')
    .eq('id', id(targetId))
    .eq('organization_id', workspace.organization.id)
    .maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new SignalError('NOT_FOUND', 404);
  return result.data;
}
export async function signalRoute(action: () => Promise<unknown>) {
  try {
    return Response.json(
      { data: await action() },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    unstable_rethrow(error);
    const known =
      error instanceof SignalError
        ? error
        : error instanceof KnowledgeError
          ? new SignalError(error.code, error.status)
          : error instanceof z.ZodError
            ? new SignalError('INVALID_INPUT')
            : new SignalError('PROCESSING_FAILED', 500);
    return Response.json(
      { error: { code: known.code, message: messages[known.code] ?? messages.PROCESSING_FAILED } },
      { status: known.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
export async function findCommunities(request: Request) {
  await context(request);
  const query = z
    .string()
    .trim()
    .max(100)
    .parse(new URL(request.url).searchParams.get('q') ?? '');
  return { communities: await createRedditProvider('mock').searchSubreddits(query) };
}
export async function communitySuggestions(request: Request, brandId: string) {
  const workspace = await context(request, 'manage');
  const brand = await brandFor(workspace, brandId);
  const suggestions = await suggestSubreddits(brand.profile);
  const provider = createRedditProvider('mock');
  const available = await provider.searchSubreddits('');
  return {
    communities: suggestions.flatMap((suggestion) => {
      const community = available.find(
        (item) => item.name.toLowerCase() === suggestion.name.toLowerCase(),
      );
      return community ? [{ ...community, reason: suggestion.reason }] : [];
    }),
  };
}
export async function addCommunity(request: Request, brandId: string) {
  const workspace = await context(request, 'manage');
  await brandFor(workspace, brandId);
  const input = await knowledgeJson(
    request,
    z
      .object({
        name: z
          .string()
          .trim()
          .transform((value) => value.replace(/^r\//i, '').toLowerCase())
          .pipe(
            z
              .string()
              .refine(
                (value) => /^[a-z0-9_]{2,21}$/.test(value) || value === 'artificialintelligence',
              ),
          ),
        settings: communitySettingsSchema.prefault({}),
      })
      .strict(),
  );
  try {
    await createRedditProvider('mock').getSubreddit(input.name);
  } catch {
    throw new SignalError('COMMUNITY_UNAVAILABLE', 404);
  }
  const result = await workspace.supabase.rpc('add_brand_subreddit', {
    p_brand_id: brandId,
    p_name: input.name,
    p_settings: input.settings,
  });
  databaseError(result.error);
  return { id: z.uuid().parse(result.data) };
}
// Zod defaults also apply inside .partial(); unwrap them so a pause cannot reset notes or limits.
const updateCommunitySchema = z
  .object({
    status: communitySettingsSchema.shape.status.unwrap(),
    priority: communitySettingsSchema.shape.priority.unwrap(),
    minimum_score: communitySettingsSchema.shape.minimum_score.unwrap(),
    allowed_reply_style: communitySettingsSchema.shape.allowed_reply_style.unwrap(),
    internal_notes: communitySettingsSchema.shape.internal_notes.unwrap(),
    internal_interpretation: communitySettingsSchema.shape.internal_interpretation.unwrap(),
    monitor_new: communitySettingsSchema.shape.monitor_new.unwrap(),
    monitor_hot: communitySettingsSchema.shape.monitor_hot.unwrap(),
    monitor_rising: communitySettingsSchema.shape.monitor_rising.unwrap(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export async function editCommunity(
  request: Request,
  targetId: string,
  operation: 'update' | 'remove' | 'refresh',
  fixedKind?: 'rules',
) {
  const workspace = await context(request, 'manage');
  await owned(workspace, 'brand_subreddits', targetId);
  const result =
    operation === 'remove'
      ? await workspace.supabase.rpc('remove_brand_subreddit', { p_id: targetId })
      : operation === 'refresh'
        ? await workspace.supabase.rpc('refresh_brand_subreddit', {
            p_id: targetId,
            p_kind:
              fixedKind ??
              (await knowledgeJson(request, z.object({ kind: z.enum(['sync', 'rules']) }).strict()))
                .kind,
          })
        : await workspace.supabase.rpc('update_brand_subreddit', {
            p_id: targetId,
            p_settings: await knowledgeJson(request, updateCommunitySchema),
          });
  databaseError(result.error);
  return { id: targetId };
}
const validatedKeywordInput = keywordInputSchema
  .strict()
  .refine((value) => value.is_exclusion === (value.kind === 'exclusion'));
export async function addKeyword(request: Request, brandId: string) {
  const workspace = await context(request, 'manage');
  await brandFor(workspace, brandId);
  const input = await knowledgeJson(request, validatedKeywordInput);
  const result = await workspace.supabase.rpc('save_brand_keyword', {
    p_brand_id: brandId,
    p_id: null as unknown as string,
    p_input: input,
  });
  databaseError(result.error);
  return { id: z.uuid().parse(result.data) };
}
export async function editKeyword(request: Request, targetId: string, remove = false) {
  const workspace = await context(request, 'manage');
  const keyword = await owned(workspace, 'brand_keywords', targetId);
  const result = remove
    ? await workspace.supabase.rpc('delete_brand_keyword', { p_id: targetId })
    : await workspace.supabase.rpc('save_brand_keyword', {
        p_brand_id: keyword.brand_id,
        p_id: targetId,
        p_input: await knowledgeJson(request, validatedKeywordInput),
      });
  databaseError(result.error);
  return { id: targetId };
}
export async function keywordSuggestions(request: Request, brandId: string) {
  const workspace = await context(request, 'manage');
  const brand = await brandFor(workspace, brandId);
  return { keywords: z.array(keywordInputSchema).parse(await suggestKeywords(brand.profile)) };
}
export async function keywordPreview(request: Request, brandId: string) {
  const workspace = await context(request);
  await brandFor(workspace, brandId);
  const result = await workspace.supabase
    .from('brand_keywords')
    .select('id,brand_id,value,kind,is_exclusion,status,source')
    .eq('organization_id', workspace.organization.id)
    .eq('brand_id', brandId);
  databaseError(result.error);
  const keywords = z.array(keywordRecordSchema).parse(result.data);
  const provider = createRedditProvider('mock');
  const communities = await provider.searchSubreddits('');
  const pages = await Promise.all(
    communities
      .slice(0, 8)
      .map((community) =>
        provider.listPosts({ subreddit: community.name, sort: 'new', limit: 100 }),
      ),
  );
  return {
    matches: previewKeywordMatches({
      posts: pages.flatMap((page) => page.posts).slice(0, 100),
      keywords,
    }).slice(0, 30),
  };
}
export async function listOpportunities(request: Request) {
  await context(request);
  const filters = feedFilterSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  try {
    decodeFeedCursor(filters.cursor, filters.sort);
  } catch {
    throw new SignalError('INVALID_INPUT');
  }
  const result = await loadOpportunities(filters);
  return { items: result.items, nextCursor: result.nextCursor };
}
export async function opportunityDetail(request: Request, targetId: string) {
  await context(request);
  const result = await loadOpportunity(id(targetId));
  return { opportunity: result.opportunity, rules: result.rules };
}
export async function changeOpportunity(
  request: Request,
  targetId: string,
  action: 'status' | 'rescore',
  fixedStatus?: 'saved' | 'dismissed',
) {
  const workspace = await context(request, 'act');
  await owned(workspace, 'opportunities', targetId);
  if (action === 'rescore') {
    const result = await workspace.supabase.rpc('rescore_opportunity', { p_id: targetId });
    databaseError(result.error);
    return { id: targetId };
  }
  const input =
    fixedStatus === 'saved'
      ? { status: 'saved' as const, reason: undefined }
      : fixedStatus === 'dismissed'
        ? {
            status: 'dismissed' as const,
            ...(await knowledgeJson(request, z.object({ reason: dismissalReasonSchema }).strict())),
          }
        : await knowledgeJson(
            request,
            z
              .object({
                status: z.enum(['new', 'saved', 'monitoring', 'dismissed', 'archived']),
                reason: dismissalReasonSchema.optional(),
              })
              .strict()
              .refine((value) => value.status !== 'dismissed' || Boolean(value.reason)),
          );
  const result = await workspace.supabase.rpc('set_opportunity_status', {
    p_id: targetId,
    p_status: input.status,
    p_reason: input.reason ?? (null as unknown as string),
  });
  databaseError(result.error);
  return { id: targetId };
}
export async function bulkDismiss(request: Request) {
  const workspace = await context(request, 'act');
  const input = await knowledgeJson(
    request,
    z
      .object({
        ids: z
          .array(z.uuid())
          .min(1)
          .max(100)
          .refine((ids) => new Set(ids).size === ids.length),
        reason: dismissalReasonSchema,
      })
      .strict(),
  );
  const result = await workspace.supabase
    .from('opportunities')
    .select('id')
    .eq('organization_id', workspace.organization.id)
    .in('id', input.ids);
  databaseError(result.error);
  if (result.data?.length !== input.ids.length) throw new SignalError('NOT_FOUND', 404);
  const changed = await workspace.supabase.rpc('bulk_dismiss_opportunities', {
    p_ids: input.ids,
    p_reason: input.reason,
  });
  databaseError(changed.error);
  return { count: z.number().int().parse(changed.data) };
}
