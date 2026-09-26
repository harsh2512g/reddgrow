import { z } from 'zod';
import { apiError, type ApiRequestId } from '../api-errors';
import { KnowledgeError } from '../knowledge/http';
import { AttributionError } from '../phase6/errors';

const messages = {
  UNAVAILABLE: 'This operation could not finish. Please retry.',
  LOCAL_ONLY: 'Operations are available in the verified Supabase development workspace.',
  UNAUTHENTICATED: 'Sign in before continuing.',
  FORBIDDEN: 'Your account does not have permission for this operation.',
  INVALID_INPUT: 'Check the fields and try again.',
  RATE_LIMITED: 'Too many requests. Wait a minute before trying again.',
  WORKSPACE_CHANGED: 'Your workspace changed. Reload before continuing.',
  NOT_FOUND: 'This record is no longer available.',
  JOB_NOT_RETRYABLE: 'This job cannot be retried. Refresh its current status.',
  IDEMPOTENCY_CONFLICT: 'This request was already used with different details.',
  ORGANIZATION_UNAVAILABLE: 'This organization is unavailable for this operation.',
  BILLING_CANCELLATION_REQUIRED:
    'Cancel the active Stripe subscription before deleting this organization.',
  EXPORT_TOO_LARGE:
    'This export exceeds the supported size. Contact the project operator for a complete assisted export.',
  EXPORT_UNAVAILABLE: 'This export expired, was revoked, or is not ready yet.',
  CONFIRMATION_REQUIRED: 'Enter the exact workspace slug to confirm deletion.',
} as const;
export class OperationsError extends Error {
  constructor(
    readonly code: keyof typeof messages,
    readonly status = 400,
  ) {
    super(code);
  }
}
export function operationFailure(error: unknown, requestId: ApiRequestId) {
  let code: keyof typeof messages = 'UNAVAILABLE';
  let status = 500;
  if (error instanceof OperationsError) {
    code = error.code;
    status = error.status;
  } else if (error instanceof z.ZodError) {
    code = 'INVALID_INPUT';
    status = 400;
  } else if (error instanceof KnowledgeError || error instanceof AttributionError) {
    code =
      error.code === 'RATE_LIMITED'
        ? 'RATE_LIMITED'
        : error.code === 'INVALID_INPUT'
          ? 'INVALID_INPUT'
          : 'UNAVAILABLE';
    status = error.status;
  } else if (error && typeof error === 'object') {
    if ('code' in error && error.code === '42501') {
      code = 'FORBIDDEN';
      status = 403;
    } else if ('message' in error && typeof error.message === 'string') {
      const message = error.message;
      if (message === 'EXPORT_RATE_LIMIT') {
        code = 'RATE_LIMITED';
        status = 429;
      } else if (
        [
          'BRAND_ARCHIVED',
          'PAGE_LIMIT',
          'POST_DELETED',
          'OPPORTUNITY_BLOCKED',
          'OPPORTUNITY_UNAVAILABLE',
          'POST_STALE',
          'SUBREDDIT_PAUSED',
          'JOB_CONTEXT_CHANGED',
          'JOB_ALREADY_RETRIED',
          'NOTIFICATION_RETRY_WINDOW_EXPIRED',
        ].includes(message)
      ) {
        code = 'JOB_NOT_RETRYABLE';
        status = 409;
      } else if (
        ['JOB_NOT_FOUND', 'SOURCE_NOT_FOUND', 'ORGANIZATION_NOT_FOUND'].includes(message)
      ) {
        code = 'NOT_FOUND';
        status = 404;
      } else if (['PLAN_INACTIVE', 'PLAN_UNAVAILABLE', 'TRIAL_EXPIRED'].includes(message)) {
        code = 'ORGANIZATION_UNAVAILABLE';
        status = 409;
      } else if (Object.hasOwn(messages, message)) {
        code = message as keyof typeof messages;
        status = 409;
      } else if (message.startsWith('INVALID_')) {
        code = 'INVALID_INPUT';
        status = 400;
      }
    }
  }
  return { status, error: apiError(code, messages[code], requestId) };
}

export function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data;
}
