import { z } from 'zod';
import { apiError } from '../api-errors';
import { KnowledgeError } from '../knowledge/http';
export class AttributionError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
const messages: Record<string, string> = {
  LOCAL_ONLY: 'Attribution is available in the verified Supabase development workspace.',
  FORBIDDEN: 'Your role or this request is not allowed.',
  WORKSPACE_CHANGED: 'Your workspace changed. Reload before continuing.',
  INVALID_INPUT: 'Check the fields and try again.',
  UNAVAILABLE: 'Attribution could not complete this request. Please retry.',
  RATE_LIMITED: 'Too many requests. Wait a minute and try again.',
  TRACKING_DESTINATION_DENIED: 'Use an HTTPS destination on this brand’s approved domains.',
  TRACKING_LINK_UNAVAILABLE: 'This tracking link is unavailable.',
  TRACKING_LINK_NOT_FOUND: 'This link is unavailable in your workspace.',
  ADVANCED_ANALYTICS_PLAN_REQUIRED: 'Advanced competitor and style analytics require Growth.',
  TRACKING_PLAN_REQUIRED: 'Your current plan does not include this tracking feature.',
  TRACKING_LINK_LIMIT: 'Revoke an unused tracking link for this draft before adding another.',
  CONVERSION_KEY_INVALID: 'The conversion key is invalid or revoked.',
  CONVERSION_KEY_NOT_FOUND: 'This key is unavailable in your workspace.',
  CONVERSION_KEY_LIMIT: 'Revoke an existing key before creating another.',
  CONVERSION_CLICK_INVALID: 'This click is unavailable for attribution.',
  CONVERSION_ORIGIN_DENIED: 'This website is not an approved tracking origin.',
  CONVERSION_CONSENT_REQUIRED: 'Consent is required before sending browser events.',
  CONVERSION_RECEIPT_INVALID: 'This click receipt is invalid.',
  CONVERSION_OUTSIDE_WINDOW: 'The conversion is outside this workspace’s attribution window.',
  CONVERSION_DEDUPE_REQUIRED: 'Provide an external ID or idempotency key.',
  CONVERSION_IDEMPOTENCY_CONFLICT: 'This event ID was already used with different event details.',
  IDEMPOTENCY_CONFLICT: 'This event ID was already used with different event details.',
  DRAFT_NOT_FOUND: 'This draft is unavailable in your workspace.',
  DRAFT_NOT_APPROVED: 'Approve the current draft before creating a tracking link.',
  DRAFT_VERSION_CONFLICT: 'The draft changed. Refresh before creating a link.',
  VERIFICATION_REQUIRED: 'Verify and approve the current draft first.',
  DRAFT_CONTEXT_CHANGED: 'The supporting context changed. Verify and approve this draft again.',
  DRAFT_APPROVAL_BLOCKED: 'Resolve the draft checks before creating a link.',
  BRAND_NOT_FOUND: 'This brand is unavailable.',
  BRAND_ARCHIVED: 'Restore this brand before tracking new activity.',
  ORGANIZATION_UNAVAILABLE: 'This workspace is unavailable.',
  TRIAL_EXPIRED: 'The workspace trial has expired.',
  PLAN_INACTIVE: 'The workspace plan is inactive.',
  PLAN_UNAVAILABLE: 'The workspace plan is unavailable.',
};
export function attributionFailure(error: unknown) {
  let code = 'UNAVAILABLE',
    status = 500;
  if (error instanceof AttributionError || error instanceof KnowledgeError) {
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
    } else if (error.message.startsWith('INVALID_')) {
      code = 'INVALID_INPUT';
      status = 400;
    }
    if ('code' in error && error.code === '42501') {
      code = 'FORBIDDEN';
      status = 403;
    }
  }
  if (['TRACKING_LINK_UNAVAILABLE', 'TRACKING_LINK_NOT_FOUND'].includes(code)) status = 404;
  if (code === 'CONVERSION_KEY_INVALID') status = 401;
  if (!Object.hasOwn(messages, code)) code = 'UNAVAILABLE';
  return { status, error: apiError(code, messages[code]!) };
}
export function requireData<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data;
}
