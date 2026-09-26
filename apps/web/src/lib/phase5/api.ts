import 'server-only';
import { apiErrorResponse, createApiRequestId } from '../api-errors';
import { createHash, randomBytes } from 'node:crypto';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import {
  codeSchema,
  tokenSchema,
  currentResponseSchema,
  exchangeResponseSchema,
  handoffResponseSchema,
  extensionSessionSchema,
  editInputSchema,
  handoffInputSchema,
  publicationInputSchema,
  normalizeRedditUrl,
} from '@threadsignal/extension-contracts';
import { draftContext } from '../phase4/api';
import { localDraftsEnabled } from '../phase4/server';
import { boundedBody } from '../knowledge/http';
import { ExtensionError, extensionFailure } from './errors';
import {
  extensionCors,
  extensionOrigin,
  trustedExtensionHost,
  trustedExtensionRequest,
} from './policy';
import { extensionDatabase } from './database';
import { enforceExtensionRateLimit } from './rate-limit';

export const hashExtensionSecret = (value: string) =>
  createHash('sha256').update(value).digest('hex');
async function json<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
    throw new ExtensionError('INVALID_INPUT');
  const bytes = await boundedBody(request, 65536);
  try {
    return schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    throw new ExtensionError('INVALID_INPUT');
  }
}
export async function extensionRoute(
  request: Request,
  action: () => Promise<unknown>,
  bearer = false,
) {
  const headers = bearer
    ? extensionCors(request)
    : new Headers({ 'Cache-Control': 'private, no-store' });
  const requestId = createApiRequestId();
  headers.set('X-Request-ID', requestId);
  try {
    if (!localDraftsEnabled()) throw new ExtensionError('LOCAL_ONLY', 503);
    if (bearer && !trustedExtensionRequest(request)) throw new ExtensionError('FORBIDDEN', 403);
    if (bearer) await enforceExtensionRateLimit(request);
    return Response.json({ data: await action() }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    const failure = extensionFailure(error, requestId);
    return apiErrorResponse({ error: failure.body.error, status: failure.status }, headers);
  }
}
export function extensionOptions(request: Request) {
  const headers = extensionCors(request);
  const requested =
    request.headers
      .get('access-control-request-headers')
      ?.toLowerCase()
      .split(',')
      .map((h) => h.trim()) ?? [];
  const method = request.headers.get('access-control-request-method') ?? '';
  if (
    !localDraftsEnabled() ||
    !trustedExtensionHost(request) ||
    request.headers.get('origin') !== extensionOrigin ||
    !['GET', 'POST', 'PATCH'].includes(method) ||
    requested.some(
      (h) => !['authorization', 'content-type', 'x-threadsignal-extension'].includes(h),
    )
  )
    return new Response(null, { status: 403, headers });
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH');
  headers.set(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-ThreadSignal-Extension',
  );
  headers.set('Access-Control-Max-Age', '300');
  return new Response(null, { status: 204, headers });
}
function tokenHash(request: Request) {
  const value = request.headers.get('authorization') ?? '';
  if (!value.startsWith('Bearer ') || !tokenSchema.safeParse(value.slice(7)).success)
    throw new ExtensionError('EXTENSION_SESSION_INVALID', 401);
  return hashExtensionSecret(value.slice(7));
}
function location(input: string, comment = false) {
  const value = normalizeRedditUrl(input, { allowFixture: true });
  if (!value || (comment && !value.commentId))
    throw new ExtensionError(comment ? 'INVALID_COMMENT_URL' : 'INVALID_INPUT');
  return value;
}
export async function createConnection(request: Request) {
  const context = await draftContext(request, 'act');
  const input = await json(request, z.object({ name: z.string().trim().min(1).max(80) }).strict());
  const code = `tsc_${randomBytes(32).toString('base64url')}`;
  const result = await context.supabase.rpc('create_extension_connection_code', {
    p_organization_id: context.organization.id,
    p_code_hash: hashExtensionSecret(code),
    p_name: input.name,
  });
  if (result.error) throw result.error;
  const data = z.object({ id: z.uuid(), expires_at: z.string() }).parse(result.data);
  return { code, expiresAt: data.expires_at };
}
export async function listConnections(request: Request) {
  const context = await draftContext(request);
  if (context.organization.role === 'viewer') return { sessions: [] };
  const result = await context.supabase.rpc('list_extension_sessions', {
    p_organization_id: context.organization.id,
  });
  if (result.error) throw result.error;
  return { sessions: z.array(extensionSessionSchema).parse(result.data) };
}
export async function revokeConnections(request: Request) {
  const context = await draftContext(request, 'act');
  const input = await json(
    request,
    z.union([
      z.object({ sessionId: z.uuid() }).strict(),
      z.object({ all: z.literal(true) }).strict(),
    ]),
  );
  const result = await context.supabase.rpc('revoke_extension_sessions', {
    p_organization_id: context.organization.id,
    ...('sessionId' in input ? { p_session_id: input.sessionId } : {}),
  });
  if (result.error) throw result.error;
  return { revoked: z.number().int().nonnegative().parse(result.data) };
}
export async function exchangeConnection(request: Request) {
  const { code } = await json(request, z.object({ code: codeSchema }).strict());
  const token = `tse_${randomBytes(32).toString('base64url')}`;
  const result = z
    .object({
      session_id: z.uuid(),
      organization_id: z.uuid(),
      organization_name: z.string(),
      name: z.string(),
      expires_at: z.string(),
    })
    .parse(
      await extensionDatabase('exchange', [
        hashExtensionSecret(code),
        hashExtensionSecret(token),
        extensionOrigin,
      ]),
    );
  return exchangeResponseSchema.parse({
    token,
    session: {
      id: result.session_id,
      organizationId: result.organization_id,
      organizationName: result.organization_name,
      name: result.name,
      expiresAt: result.expires_at,
    },
  });
}
export async function currentConversation(request: Request) {
  const hash = tokenHash(request);
  const input = z
    .object({ redditUrl: z.string().max(2048), draftId: z.uuid().optional() })
    .strict()
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  const parsed = location(input.redditUrl);
  return currentResponseSchema.parse(
    await extensionDatabase('current', [
      hash,
      extensionOrigin,
      parsed.postId,
      parsed.subreddit,
      input.draftId ?? null,
    ]),
  );
}
export async function extensionDraftAction(
  request: Request,
  id: string,
  action: 'save' | 'prepare' | 'inserted' | 'published',
) {
  z.uuid().parse(id);
  const hash = tokenHash(request);
  if (action === 'save') {
    const input = await json(request, editInputSchema);
    return {
      version: z
        .number()
        .int()
        .positive()
        .parse(
          await extensionDatabase('save', [
            hash,
            extensionOrigin,
            id,
            input.expectedVersion,
            input.content,
          ]),
        ),
    };
  }
  if (action === 'published') {
    const input = await json(request, publicationInputSchema);
    const parsed = location(input.commentUrl, true);
    await extensionDatabase('published', [
      hash,
      extensionOrigin,
      id,
      input.expectedVersion,
      parsed.postId,
      parsed.subreddit,
      parsed.canonicalUrl,
    ]);
    return { version: input.expectedVersion };
  }
  const input = await json(request, handoffInputSchema);
  const parsed = location(input.redditUrl);
  const result = await extensionDatabase(action, [
    hash,
    extensionOrigin,
    id,
    input.expectedVersion,
    parsed.postId,
    parsed.subreddit,
  ]);
  return action === 'prepare'
    ? handoffResponseSchema.parse(result)
    : { version: input.expectedVersion };
}
export async function disconnectExtension(request: Request) {
  const hash = tokenHash(request);
  await json(request, z.object({}).strict());
  await extensionDatabase('disconnect', [hash, extensionOrigin]);
  return { revoked: true };
}
export async function markDraftPublished(request: Request, id: string) {
  const context = await draftContext(request, 'act');
  z.uuid().parse(id);
  const input = await json(request, publicationInputSchema);
  const parsed = location(input.commentUrl, true);
  const result = await context.supabase.rpc('mark_draft_published', {
    p_organization_id: context.organization.id,
    p_draft_id: id,
    p_expected_version: input.expectedVersion,
    p_comment_url: parsed.canonicalUrl,
  });
  if (result.error) throw result.error;
  return { version: input.expectedVersion };
}
