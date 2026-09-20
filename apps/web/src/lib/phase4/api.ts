import 'server-only';
import { enforceMutationRateLimit } from '../mutation-rate-limit';
import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { draftControlsSchema, personaInputSchema } from '@threadsignal/drafts';
import { requireOrganization } from '../organizations/server';
import { hasTrustedOrigin } from '../auth/policy';
import { getServerEnv } from '../env/server';
import { KnowledgeError, knowledgeJson } from '../knowledge/http';
import { localDraftsEnabled, loadDraft, loadDrafts, loadPersona } from './server';
const messages: Record<string, string> = {
  LOCAL_ONLY: 'Drafting is available in the separate local development workspace.',
  FORBIDDEN: 'Your role cannot make this change.',
  RATE_LIMITED: 'Too many changes. Wait a minute before trying again.',
  RATE_LIMIT_UNAVAILABLE: 'Request protection is temporarily unavailable. Please retry.',
  WORKSPACE_CHANGED: 'Your workspace changed. Reload this page before continuing.',
  NOT_FOUND: 'This item is unavailable in your workspace.',
  INVALID_INPUT: 'Check the fields and try again.',
  PROCESSING_FAILED: 'The action could not finish. Your text is preserved; please retry.',
  DRAFT_VERSION_CONFLICT:
    'This draft changed in another session. Keep your text, then load the latest version before saving again.',
  DRAFT_GENERATION_PENDING: 'Generation is still running. Wait for it to finish before editing.',
  DRAFT_LIMIT: 'Your plan has reached its draft allowance for this period.',
  DRAFT_RATE_LIMIT: 'Too many requests. Wait a minute before trying again.',
  IDEMPOTENCY_CONFLICT: 'This request changed while it was pending. Refresh before trying again.',
  POST_DELETED: 'The original post was deleted. Draft actions are unavailable.',
  POST_STALE:
    'This discussion needs fresh monitoring data before drafting. Refresh its community and try again.',
  OPPORTUNITY_UNAVAILABLE: 'This opportunity was dismissed or archived. Reopen it before drafting.',
  DRAFT_CONTEXT_TOO_LARGE:
    'There is too much product and community context for one draft. Shorten the brand profile or selected knowledge, then retry.',
  OPPORTUNITY_BLOCKED:
    'This opportunity cannot receive a draft because it is blocked or no longer open.',
  SUBREDDIT_PAUSED: 'Resume community monitoring before processing this draft.',
  BRAND_ARCHIVED: 'Restore the brand before processing this draft.',
  ORGANIZATION_UNAVAILABLE: 'This workspace is unavailable.',
  TRIAL_EXPIRED: 'Your workspace trial has expired. Existing drafts remain available to review.',
  PLAN_INACTIVE: 'Your current plan is inactive.',
  PLAN_UNAVAILABLE: 'Your workspace plan could not be loaded.',
  DRAFT_NOT_VERIFIED: 'Verify the current version before approving.',
  DRAFT_VERIFICATION_STALE:
    'Product knowledge, persona or community context changed. Verify the current version again.',
  DRAFT_BLOCKED: 'Resolve unsupported claims or failed checks before approval.',
  WARNINGS_NOT_ACKNOWLEDGED: 'Acknowledge the warnings before approving.',
  RESPONSIBLE_USE_REQUIRED: 'Confirm the responsible-use notice before approval.',
  DRAFT_NOT_APPROVED: 'Only a current approved draft may be copied.',
  DRAFT_REJECT_REASON_REQUIRED: 'Provide a reason for rejecting this draft.',
};
export class DraftError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
const databaseCodes: Record<string, string> = {
  VERIFICATION_REQUIRED: 'DRAFT_NOT_VERIFIED',
  DRAFT_CONTEXT_CHANGED: 'DRAFT_VERIFICATION_STALE',
  DRAFT_APPROVAL_BLOCKED: 'DRAFT_BLOCKED',
  WARNINGS_ACKNOWLEDGEMENT_REQUIRED: 'WARNINGS_NOT_ACKNOWLEDGED',
  REJECTION_REASON_REQUIRED: 'DRAFT_REJECT_REASON_REQUIRED',
  DRAFT_REJECTED: 'DRAFT_BLOCKED',
};
export function draftDatabaseError(error: { message: string; code?: string } | null) {
  if (!error) return;
  if (error.code === '42501') throw new DraftError('FORBIDDEN', 403);
  const code = databaseCodes[error.message] ?? error.message;
  if (messages[code]) throw new DraftError(code, 409);
  if (error.message.endsWith('_NOT_FOUND')) throw new DraftError('NOT_FOUND', 404);
  if (error.message.startsWith('INVALID_')) throw new DraftError('INVALID_INPUT');
  throw new DraftError('PROCESSING_FAILED', 500);
}
export async function draftRoute(action: () => Promise<unknown>) {
  const requestId = crypto.randomUUID();
  try {
    return Response.json(
      { data: await action() },
      { headers: { 'Cache-Control': 'private, no-store', 'X-Request-ID': requestId } },
    );
  } catch (error) {
    unstable_rethrow(error);
    const known =
      error instanceof DraftError
        ? error
        : error instanceof KnowledgeError
          ? new DraftError(error.code, error.status)
          : error instanceof z.ZodError
            ? new DraftError('INVALID_INPUT')
            : new DraftError('PROCESSING_FAILED', 500);
    return Response.json(
      {
        error: {
          code: known.code,
          message: messages[known.code] ?? messages.PROCESSING_FAILED,
          requestId,
        },
      },
      { status: known.status, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } },
    );
  }
}
export async function draftContext(
  request: Request,
  permission: 'read' | 'act' | 'manage' = 'read',
) {
  if (!localDraftsEnabled()) throw new DraftError('LOCAL_ONLY', 503);
  if (
    permission !== 'read' &&
    !hasTrustedOrigin(request.headers, getServerEnv().NEXT_PUBLIC_APP_URL)
  )
    throw new DraftError('FORBIDDEN', 403);
  const workspace = await requireOrganization();
  if (permission !== 'read') {
    if (request.headers.get('x-threadsignal-organization') !== workspace.organization.id)
      throw new DraftError('WORKSPACE_CHANGED', 409);
    if (
      workspace.organization.role === 'viewer' ||
      (permission === 'manage' && !['owner', 'admin'].includes(workspace.organization.role))
    )
      throw new DraftError('FORBIDDEN', 403);
  }
  if (permission !== 'read') await enforceMutationRateLimit('drafts', workspace.organization.id);
  return workspace;
}
async function owned(
  workspace: Awaited<ReturnType<typeof draftContext>>,
  table: 'drafts' | 'opportunities' | 'brands',
  id: string,
) {
  if (!z.uuid().safeParse(id).success) throw new DraftError('NOT_FOUND', 404);
  const result = await workspace.supabase
    .from(table)
    .select('id')
    .eq('organization_id', workspace.organization.id)
    .eq('id', id)
    .maybeSingle();
  draftDatabaseError(result.error);
  if (!result.data) throw new DraftError('NOT_FOUND', 404);
}
const expected = z.number().int().nonnegative();
export const versionInput = z.object({ expectedVersion: expected }).strict();
export const generationInput = z
  .object({ idempotencyKey: z.uuid(), options: draftControlsSchema.strict().default({}) })
  .strict();
export async function createDraft(request: Request, opportunityId: string) {
  const workspace = await draftContext(request, 'act');
  await owned(workspace, 'opportunities', opportunityId);
  const input = await knowledgeJson(request, generationInput);
  const result = await workspace.supabase.rpc('request_draft', {
    p_opportunity_id: opportunityId,
    p_idempotency_key: input.idempotencyKey,
    p_options: input.options,
  });
  draftDatabaseError(result.error);
  return { id: z.uuid().parse(result.data) };
}
export async function getDrafts(request: Request) {
  await draftContext(request);
  const result = await loadDrafts(Object.fromEntries(new URL(request.url).searchParams));
  if (result.invalidFilters) throw new DraftError('INVALID_INPUT');
  return {
    drafts: result.drafts,
    titles: result.titles,
    usage: result.usage,
    nextCursor: result.nextCursor,
  };
}
export async function getDraft(request: Request, id: string) {
  const workspace = await draftContext(request);
  await owned(workspace, 'drafts', id);
  return (await loadDraft(id)).detail;
}
export async function getPersona(request: Request, brandId: string) {
  const workspace = await draftContext(request);
  await owned(workspace, 'brands', brandId);
  return { persona: (await loadPersona(brandId)).persona };
}
export async function savePersona(request: Request, brandId: string) {
  const workspace = await draftContext(request, 'manage');
  await owned(workspace, 'brands', brandId);
  const input = await knowledgeJson(request, personaInputSchema.strict());
  const result = await workspace.supabase.rpc('update_brand_persona', {
    p_brand_id: brandId,
    p_input: input,
  });
  draftDatabaseError(result.error);
  return { id: z.uuid().parse(result.data) };
}
export async function mutateDraft(
  request: Request,
  id: string,
  action: 'save' | 'regenerate' | 'verify' | 'approve' | 'reject' | 'restore' | 'feedback' | 'copy',
) {
  const workspace = await draftContext(request, 'act');
  await owned(workspace, 'drafts', id);
  const { supabase } = workspace;
  if (action === 'save') {
    const input = await knowledgeJson(
      request,
      z
        .object({
          expectedVersion: expected,
          content: z
            .string()
            .min(1)
            .max(12000)
            .refine((value) => value.trim().length > 0),
        })
        .strict(),
    );
    const result = await supabase.rpc('save_draft_edit', {
      p_draft_id: id,
      p_expected_version: input.expectedVersion,
      p_content: input.content,
    });
    draftDatabaseError(result.error);
    return { version: z.number().int().positive().parse(result.data) };
  }
  if (action === 'restore') {
    const input = await knowledgeJson(
      request,
      z.object({ expectedVersion: expected, restoreVersion: z.number().int().positive() }).strict(),
    );
    const result = await supabase.rpc('restore_draft_version', {
      p_draft_id: id,
      p_expected_version: input.expectedVersion,
      p_restore_version: input.restoreVersion,
    });
    draftDatabaseError(result.error);
    return { version: z.number().int().positive().parse(result.data) };
  }
  if (action === 'regenerate') {
    const input = await knowledgeJson(
      request,
      generationInput.extend({ expectedVersion: expected }),
    );
    const result = await supabase.rpc('regenerate_draft', {
      p_draft_id: id,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
      p_options: input.options,
    });
    draftDatabaseError(result.error);
    return { id: z.uuid().parse(result.data) };
  }
  if (action === 'approve') {
    const input = await knowledgeJson(
      request,
      z
        .object({
          expectedVersion: expected,
          acknowledgeWarnings: z.boolean(),
          acceptResponsibleUse: z.boolean(),
        })
        .strict(),
    );
    const result = await supabase.rpc('approve_draft', {
      p_draft_id: id,
      p_expected_version: input.expectedVersion,
      p_acknowledge_warnings: input.acknowledgeWarnings,
      p_accept_responsible_use: input.acceptResponsibleUse,
    });
    draftDatabaseError(result.error);
    return { id };
  }
  if (action === 'reject') {
    const input = await knowledgeJson(
      request,
      z.object({ expectedVersion: expected, reason: z.string().trim().min(3).max(1000) }).strict(),
    );
    const result = await supabase.rpc('reject_draft', {
      p_draft_id: id,
      p_expected_version: input.expectedVersion,
      p_reason: input.reason,
    });
    draftDatabaseError(result.error);
    return { id };
  }
  if (action === 'feedback') {
    const input = await knowledgeJson(
      request,
      z
        .object({
          rating: z.enum([
            'useful',
            'too_promotional',
            'incorrect',
            'irrelevant',
            'wrong_tone',
            'other',
          ]),
          notes: z.string().trim().max(2000).default(''),
        })
        .strict(),
    );
    const result = await supabase.rpc('submit_draft_feedback', {
      p_draft_id: id,
      p_rating: input.rating,
      p_notes: input.notes,
    });
    draftDatabaseError(result.error);
    return { id: z.uuid().parse(result.data) };
  }
  const input = await knowledgeJson(request, versionInput);
  const result =
    action === 'copy'
      ? await supabase.rpc('record_draft_copy', {
          p_draft_id: id,
          p_expected_version: input.expectedVersion,
        })
      : await supabase.rpc('verify_draft', {
          p_draft_id: id,
          p_expected_version: input.expectedVersion,
        });
  draftDatabaseError(result.error);
  return { id };
}
