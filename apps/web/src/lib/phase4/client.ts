import { z } from 'zod';
export class DraftRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function draftRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  organizationId?: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (organizationId) headers.set('X-ThreadSignal-Organization', organizationId);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    throw new DraftRequestError(
      'NETWORK',
      'The workspace could not be reached. Your unsaved text is still here; retry when connected.',
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z
      .object({ error: z.object({ code: z.string().max(100), message: z.string().max(500) }) })
      .safeParse(payload);
    throw new DraftRequestError(
      error.success ? error.data.error.code : 'REQUEST_FAILED',
      error.success
        ? error.data.error.message
        : 'This action could not be completed. Please retry.',
    );
  }
  const parsed = z.object({ data: schema }).safeParse(payload);
  if (!parsed.success)
    throw new DraftRequestError(
      'INVALID_RESPONSE',
      'The workspace returned an unexpected response. Refresh before continuing.',
    );
  return parsed.data.data;
}
export const mutationIdSchema = z.object({ id: z.uuid() });
export const mutationVersionSchema = z.object({ version: z.number().int().positive() });
export const draftMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Please retry this action.';
export function draftFailureMessage(code: string | null) {
  const messages: Record<string, string> = {
    DRAFT_CONTEXT_TOO_LARGE:
      'There is too much product and community context for one draft. Shorten the brand profile or selected knowledge, then regenerate.',
    AI_TIMEOUT:
      'The writing provider took too long. Your saved versions are safe; retry generation or verification.',
    AI_RATE_LIMITED: 'The writing provider is busy. Wait briefly before retrying.',
    INVALID_DRAFT_RESPONSE: 'The writing provider returned an invalid result. Retry this step.',
    AI_UNAVAILABLE: 'The writing provider is temporarily unavailable. Try again later.',
    AI_REFUSED:
      'The writing provider could not fulfill this request. Review the instructions and try again.',
    DRAFT_CONTEXT_CHANGED:
      'Product knowledge or community context changed while processing. Verify the current version again.',
    POST_DELETED: 'The original discussion was removed. Draft actions are unavailable.',
    POST_STALE:
      'This discussion needs fresh monitoring data. Refresh its community before retrying.',
    OPPORTUNITY_UNAVAILABLE:
      'This opportunity was dismissed or archived. Reopen it before drafting.',
  };
  return (
    (code && messages[code]) ||
    'This processing step could not finish. Your saved versions remain available; retry generation or verification.'
  );
}
