import { apiError, apiErrorResponse } from '../api-errors';
const definitions = {
  AUTH_UNAVAILABLE: {
    status: 503,
    message: 'Sign-in is temporarily unavailable. Start the project services and try again.',
  },
  AUTH_PROVIDER_UNAVAILABLE: {
    status: 503,
    message: 'Google sign-in is not enabled in this local environment. Use an email sign-in link.',
  },
  INVALID_INPUT: { status: 400, message: 'Enter a valid email address and try again.' },
  INVALID_ORIGIN: {
    status: 403,
    message: 'This request could not be verified. Reload this page and try again.',
  },
  RATE_LIMITED: {
    status: 429,
    message: 'Too many sign-in attempts. Wait a few minutes and try again.',
  },
  INVALID_LINK: {
    status: 400,
    message: 'This sign-in link is invalid or expired. Request a new link.',
  },
} as const;

export class AuthActionError extends Error {
  readonly status: number;
  constructor(
    readonly code: keyof typeof definitions,
    readonly retryAfter?: number,
  ) {
    super(definitions[code].message);
    this.name = 'AuthActionError';
    this.status = definitions[code].status;
  }
}

export function safeAuthError(error: unknown): AuthActionError {
  return error instanceof AuthActionError ? error : new AuthActionError('AUTH_UNAVAILABLE');
}

export function authErrorResponse(error: unknown): Response {
  const safe = safeAuthError(error);
  return apiErrorResponse(
    { status: safe.status, error: apiError(safe.code, safe.message) },
    safe.retryAfter ? { 'Retry-After': String(safe.retryAfter) } : undefined,
  );
}
