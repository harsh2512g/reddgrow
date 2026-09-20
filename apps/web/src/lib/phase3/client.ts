import { z } from 'zod';
export const actionResponseSchema = z.object({ id: z.uuid() });
export async function signalRequest<T>(
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
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
  } catch {
    throw new Error('The workspace could not be reached. Check your connection and retry.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z.object({ error: z.object({ message: z.string().max(500) }) }).safeParse(body);
    throw new Error(
      error.success ? error.data.error.message : 'The request could not be completed.',
    );
  }
  const result = z.object({ data: schema }).safeParse(body);
  if (!result.success)
    throw new Error('The server returned an unexpected result. Reload and try again.');
  return result.data.data;
}
export const signalMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Please retry this change.';
