import { z } from 'zod';

const errorResponse = z.object({ error: z.object({ message: z.string().max(500) }) });
export const createdSchema = z.object({ id: z.uuid() });
export const mutationSchema = createdSchema;

/** Only validated data and safe API messages reach interactive screens. */
export async function knowledgeRequest<S extends z.ZodType>(
  path: string,
  schema: S,
  init: RequestInit = {},
): Promise<z.output<S>> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    signal: init.signal ?? AbortSignal.timeout(30_000),
    headers: {
      ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const failure = errorResponse.safeParse(body);
    throw new Error(
      failure.success
        ? failure.data.error.message
        : 'The request could not be completed. Please try again.',
    );
  }
  return schema.parse(z.object({ data: z.unknown() }).parse(body).data);
}

export function requestMessage(error: unknown): string {
  return error instanceof Error && error.name === 'Error'
    ? error.message
    : 'The request could not finish. Please check your connection and try again.';
}
