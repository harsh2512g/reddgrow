import { z } from 'zod';
import { apiError, type ApiRequestId } from '../api-errors';
import { DraftError } from '../phase4/api';
import { KnowledgeError } from '../knowledge/http';
export class ExtensionError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
const messages: Record<string, string> = {
  LOCAL_ONLY: 'Extension processing is available in the local workspace only.',
  FORBIDDEN: 'This request or role is not allowed.',
  INVALID_INPUT: 'Check the fields and try again.',
  WORKSPACE_CHANGED: 'Your workspace changed. Reload before continuing.',
  EXTENSION_CODE_INVALID:
    'This code expired, was replaced or has already been used. Create a new code in Settings.',
  EXTENSION_SESSION_INVALID: 'This connection expired or was revoked. Connect again from Settings.',
  EXTENSION_SESSION_LIMIT: 'Disconnect an existing extension before adding another (maximum five).',
  EXTENSION_SESSION_NOT_FOUND: 'This connection is unavailable in your workspace.',
  EXTENSION_RATE_LIMIT: 'Too many requests. Wait a minute before trying again.',
  DRAFT_NOT_FOUND: 'The draft is unavailable in this workspace.',
  DRAFT_VERSION_CONFLICT: 'The draft changed. Refresh and review the current version.',
  DRAFT_NOT_APPROVED: 'Review and approve the current draft in ThreadSignal first.',
  VERIFICATION_REQUIRED: 'Verify and approve the current draft in ThreadSignal first.',
  POST_DELETED: 'This discussion was deleted. Its draft is unavailable.',
  POST_STALE: 'Refresh monitoring before using this discussion.',
  OPPORTUNITY_BLOCKED: 'This discussion is blocked or closed for replies.',
  OPPORTUNITY_UNAVAILABLE: 'Reopen this opportunity before using its draft.',
  SUBREDDIT_PAUSED: 'Resume community monitoring before using this draft.',
  BRAND_ARCHIVED: 'Restore the brand before using this draft.',
  ORGANIZATION_UNAVAILABLE: 'This workspace is unavailable.',
  PLAN_INACTIVE: 'This workspace plan is inactive.',
  PLAN_UNAVAILABLE: 'The workspace plan could not be loaded.',
  TRIAL_EXPIRED: 'Your workspace trial has expired.',
  DRAFT_CONTEXT_CHANGED:
    'Knowledge or community context changed. Verify and approve the draft again.',
  DRAFT_APPROVAL_BLOCKED: 'The draft has unresolved checks. Return to its review page.',
  PUBLICATION_ALREADY_RECORDED: 'A different publication is already recorded for this draft.',
  INVALID_COMMENT_URL: 'Use a comment permalink from this Reddit discussion.',
  UNAVAILABLE: 'The extension service could not complete this request. Please try again.',
};
export function extensionFailure(error: unknown, requestId?: ApiRequestId) {
  let code = 'UNAVAILABLE',
    status = 500;
  if (
    error instanceof ExtensionError ||
    error instanceof DraftError ||
    error instanceof KnowledgeError
  ) {
    code = error.code;
    status = error.status;
  } else if (error instanceof z.ZodError) {
    code = 'INVALID_INPUT';
    status = 400;
  } else if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    if (Object.hasOwn(messages, error.message)) {
      code = error.message;
      status = 409;
    }
    if ('code' in error && error.code === '42501') {
      code = 'FORBIDDEN';
      status = 403;
    }
    if (!Object.hasOwn(messages, error.message) && error.message.startsWith('INVALID_')) {
      code = 'INVALID_INPUT';
      status = 400;
    }
  }
  if (code === 'EXTENSION_SESSION_INVALID') status = 401;
  if (code === 'EXTENSION_RATE_LIMIT') status = 429;
  return {
    status,
    body: {
      error: apiError(
        Object.hasOwn(messages, code) ? code : 'UNAVAILABLE',
        Object.hasOwn(messages, code) ? messages[code]! : messages.UNAVAILABLE!,
        requestId,
      ),
    },
  };
}
