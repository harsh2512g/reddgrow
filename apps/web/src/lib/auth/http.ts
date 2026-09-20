import { z } from 'zod';
import { AuthActionError } from './errors';

/** Enforce the actual streamed size, not the caller-controlled Content-Length alone. */
export async function parseAuthBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  allowForm = false,
): Promise<T> {
  const mime = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (mime !== 'application/json' && !(allowForm && mime === 'application/x-www-form-urlencoded'))
    throw new AuthActionError('INVALID_INPUT');
  if (Number(request.headers.get('content-length') ?? '0') > 4096)
    throw new AuthActionError('INVALID_INPUT');
  if (!request.body) {
    const empty = schema.safeParse({});
    if (allowForm && mime === 'application/x-www-form-urlencoded' && empty.success)
      return empty.data;
    throw new AuthActionError('INVALID_INPUT');
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new AuthActionError('INVALID_INPUT');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const input: unknown =
      mime === 'application/json'
        ? JSON.parse(text)
        : Object.fromEntries(new URLSearchParams(text));
    const result = schema.safeParse(input);
    if (!result.success) throw new AuthActionError('INVALID_INPUT');
    return result.data;
  } catch {
    throw new AuthActionError('INVALID_INPUT');
  } finally {
    reader.releaseLock();
  }
}
