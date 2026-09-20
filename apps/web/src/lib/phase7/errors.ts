import { z } from 'zod';
import { KnowledgeError } from '../knowledge/http';
import { AttributionError } from '../phase6/errors';

const messages: Record<string, string> = {
  UNAVAILABLE: 'Billing or notifications could not complete this request. Please retry.',
  LOCAL_ONLY: 'This feature is available in the verified Supabase development workspace.',
  FORBIDDEN: 'Only the workspace owner can change billing.',
  WORKSPACE_CHANGED: 'Your workspace changed. Reload before continuing.',
  INVALID_INPUT: 'Check the fields and try again.',
  RATE_LIMITED: 'Too many requests. Wait a minute and try again.',
  BILLING_REQUEST_NOT_FOUND: 'This checkout is unavailable. Start a new checkout.',
  BILLING_REQUEST_EXPIRED: 'This checkout expired. Start a new checkout.',
  BILLING_PROVIDER_MISMATCH: 'This action is unavailable for the selected billing provider.',
  BILLING_EVENT_CONFLICT: 'The billing event conflicts with an existing record.',
  IDEMPOTENCY_CONFLICT: 'This request was already used with different details.',
  PLAN_INACTIVE: 'This subscription is inactive. Choose a plan to continue.',
  INVALID_WEBHOOK: 'The webhook signature or event is invalid.',
  BILLING_PERIOD_NOT_DUE: 'The current period has not ended. Usage is preserved until renewal.',
  BILLING_PORTAL_REQUIRED: 'Manage this existing subscription through the billing portal.',
};
const aliases: Record<string, string> = {
  CHECKOUT_EXPIRED: 'BILLING_REQUEST_EXPIRED',
  CHECKOUT_NOT_FOUND: 'BILLING_REQUEST_NOT_FOUND',
  MOCK_BILLING_ONLY: 'BILLING_PROVIDER_MISMATCH',
  BILLING_IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  BILLING_RATE_LIMIT: 'RATE_LIMITED',
};
export class BillingError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
export function billingFailure(error: unknown) {
  let code = 'UNAVAILABLE',
    status = 500;
  if (
    error instanceof BillingError ||
    error instanceof KnowledgeError ||
    error instanceof AttributionError
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
    if (aliases[error.message]) {
      code = aliases[error.message]!;
      status = 409;
    }
    if (Object.hasOwn(messages, error.message)) {
      code = error.message;
      status = 409;
    }
    if (error.message.startsWith('INVALID_')) {
      code = 'INVALID_INPUT';
      status = 400;
    }
    if ('code' in error && error.code === '42501') {
      code = 'FORBIDDEN';
      status = 403;
    }
  }
  if (code === 'RATE_LIMITED') status = 429;
  if (!Object.hasOwn(messages, code)) code = 'UNAVAILABLE';
  return { status, error: { code, message: messages[code]!, requestId: crypto.randomUUID() } };
}
export function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data;
}
