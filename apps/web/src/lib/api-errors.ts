import { randomUUID } from 'node:crypto';

declare const generatedRequestId: unique symbol;
export type ApiRequestId = string & { readonly [generatedRequestId]: true };

/** Server-created correlation only: never take an ID, message or details from request headers. */
export const createApiRequestId = (): ApiRequestId => randomUUID() as ApiRequestId;
export function apiError(code: string, message: string, requestId = createApiRequestId()) {
  return { code, message, details: {} as Record<string, never>, requestId };
}
export type ApiError = ReturnType<typeof apiError>;

/** Call only after the feature's allowlisted error mapping; upstream errors are not envelopes. */
export function apiErrorResponse(
  failure: { status: number; error: ApiError },
  responseHeaders?: HeadersInit,
) {
  const headers = new Headers(responseHeaders);
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  headers.set('X-Request-ID', failure.error.requestId);
  return Response.json({ error: failure.error }, { status: failure.status, headers });
}
