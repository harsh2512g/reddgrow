import { MAX_UPLOAD_BYTES } from './schema.js';

export type IngestionErrorCode =
  | 'invalid_file'
  | 'unsupported_file'
  | 'encrypted_pdf'
  | 'unreadable_pdf'
  | 'empty_document'
  | 'extraction_limit'
  | 'extraction_timeout'
  | 'crawl_failed'
  | 'storage_unavailable'
  | 'processing_failed';
export class IngestionError extends Error {
  constructor(readonly code: IngestionErrorCode) {
    super(code);
    this.name = 'IngestionError';
  }
}
export function safeIngestionError(error: unknown): IngestionErrorCode {
  return error instanceof IngestionError ? error.code : 'processing_failed';
}
const fileTypes: Readonly<Record<string, readonly string[]>> = {
  pdf: ['application/pdf'],
  md: ['text/markdown', 'text/plain'],
  markdown: ['text/markdown', 'text/plain'],
  txt: ['text/plain'],
};
export function validateKnowledgeFile(input: {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  if (
    !input.filename ||
    input.filename.length > 150 ||
    // Filenames must reject control bytes, not interpret them as ordinary characters.
    // eslint-disable-next-line no-control-regex
    /[/\\\u0000-\u001F]/.test(input.filename) ||
    !input.bytes.length ||
    input.bytes.byteLength > MAX_UPLOAD_BYTES
  )
    throw new IngestionError('invalid_file');
  const extension = input.filename.split('.').at(-1)?.toLowerCase() ?? '';
  const types = fileTypes[extension];
  if (!types || !types.includes(input.mimeType.toLowerCase()))
    throw new IngestionError('unsupported_file');
  const header = new TextDecoder().decode(input.bytes.slice(0, 1024));
  if (extension === 'pdf' && !header.startsWith('%PDF-')) throw new IngestionError('invalid_file');
  if (
    extension !== 'pdf' &&
    (input.bytes.includes(0) || /^\s*(?:<!doctype\s+html|<html|<script|<svg|%PDF-)/i.test(header))
  )
    throw new IngestionError('invalid_file');
  return extension;
}
