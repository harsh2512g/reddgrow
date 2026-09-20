import { z } from 'zod';

export class KnowledgeError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
const messages: Readonly<Record<string, string>> = {
  KNOWLEDGE_UNAVAILABLE: 'Knowledge processing is not enabled for this workspace yet.',
  WORKSPACE_CHANGED: 'Your active workspace changed. Reload this page before saving.',
  FORBIDDEN: 'Your role cannot make this change.',
  RATE_LIMITED: 'Too many changes. Wait a minute before trying again.',
  RATE_LIMIT_UNAVAILABLE: 'Request protection is temporarily unavailable. Please retry.',
  INVALID_INPUT: 'Check the fields and try again.',
  INVALID_FILE: 'The file is empty, too large, or its contents do not match its type.',
  UNSUPPORTED_FILE: 'Choose a PDF, Markdown, or plain-text file.',
  BRAND_LIMIT:
    'Your plan has reached its active brand limit. Archive a brand before adding another.',
  PAGE_LIMIT: 'Your plan has reached its website page limit.',
  SOURCE_LIMIT: 'This brand has reached its source limit.',
  BRAND_ARCHIVED: 'Restore this brand before adding or processing knowledge.',
  TRIAL_EXPIRED: 'The workspace trial has expired.',
  PLAN_UNAVAILABLE: 'The workspace plan is unavailable.',
  NOT_FOUND: 'This item is unavailable in your workspace.',
  UNAPPROVED_DOMAIN: 'Select pages on the approved brand website.',
  STORAGE_UNAVAILABLE: 'The private file could not be stored. Try again.',
  UPLOAD_CLEANUP_FAILED:
    'The source could not be saved and its private upload could not be removed. Restore storage access before retrying; a workspace owner may need to remove the unused upload.',
  PROCESSING_FAILED: 'The change could not be completed. Please try again.',
};
export function knowledgeErrorResponse(error: unknown) {
  const known =
    error instanceof KnowledgeError ? error : new KnowledgeError('PROCESSING_FAILED', 500);
  return Response.json(
    { error: { code: known.code, message: messages[known.code] ?? messages.PROCESSING_FAILED } },
    { status: known.status, headers: { 'Cache-Control': 'no-store' } },
  );
}
export function checkDatabaseError(error: { message: string; code?: string } | null) {
  if (!error) return;
  const code = Object.keys(messages).find((key) => error.message === key);
  if (code) throw new KnowledgeError(code, code === 'FORBIDDEN' ? 403 : 409);
  if (error.code === '42501') throw new KnowledgeError('FORBIDDEN', 403);
  if (/^(BRAND|SOURCE|DOCUMENT)_NOT_FOUND$/.test(error.message))
    throw new KnowledgeError('NOT_FOUND', 404);
  if (error.message.startsWith('INVALID_')) throw new KnowledgeError('INVALID_INPUT');
  throw new KnowledgeError('PROCESSING_FAILED', 500);
}
/** Bound actual streamed bytes before JSON or multipart parsing. */
export async function boundedBody(request: Request, limit: number) {
  if (Number(request.headers.get('content-length') ?? 0) > limit || !request.body)
    throw new KnowledgeError('INVALID_INPUT', 413);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new KnowledgeError('INVALID_INPUT', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function knowledgeJson<T>(request: Request, schema: z.ZodType<T>) {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
    throw new KnowledgeError('INVALID_INPUT');
  const bytes = await boundedBody(request, 2_100_000);
  try {
    return schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    throw new KnowledgeError('INVALID_INPUT');
  }
}
