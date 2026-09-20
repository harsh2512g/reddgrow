import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import type { AIProvider } from '@threadsignal/ai';
import type { CrawlerProvider } from '@threadsignal/crawler';
import { normalizeApprovedUrl } from '@threadsignal/crawler';
import { EMBEDDING_DIMENSIONS, MAX_TEXT_LENGTH } from './schema.js';

import { IngestionError, validateKnowledgeFile } from './files.js';
export { IngestionError, safeIngestionError, validateKnowledgeFile } from './files.js';
export type ExtractedDocument = {
  key: string;
  title: string;
  canonicalUrl: string | null;
  pageNumber: number | null;
  sectionHeading: string | null;
  content: string;
  checksum: string;
};
export type KnowledgeChunk = {
  index: number;
  content: string;
  tokenCount: number;
  checksum: string;
  sectionHeading: string | null;
  embedding: number[];
};
export type PreparedDocument = ExtractedDocument & { chunks: KnowledgeChunk[] };
export const contentChecksum = (content: string) =>
  createHash('sha256').update(content).digest('hex');

export function normalizeText(input: string): string {
  return (
    input
      .normalize('NFKC')
      .replace(/\r\n?/g, '\n')
      // Deliberately strip nonprinting controls while preserving tabs and newlines.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      .split('\n')
      .map((line) => line.replace(/[\t ]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
function extracted(
  content: string,
  data: Omit<ExtractedDocument, 'content' | 'checksum'>,
): ExtractedDocument {
  const normalized = normalizeText(content);
  if (!normalized) throw new IngestionError('empty_document');
  if (normalized.length > MAX_TEXT_LENGTH) throw new IngestionError('extraction_limit');
  return { ...data, content: normalized, checksum: contentChecksum(normalized) };
}

/** Text is split on words with a four-character token estimate and a ~100 token overlap. */
export function chunkDocument(document: ExtractedDocument): Omit<KnowledgeChunk, 'embedding'>[] {
  // Bound individual tokens too: a long unbroken string must never exceed chunk storage limits.
  const tokens = [...document.content.matchAll(/\S{1,200}/gu)];
  const words = tokens.map((token) => token[0]);
  const headings = [...document.content.matchAll(/^#{1,6}\s+(.+)$/gm)];
  const output: Omit<KnowledgeChunk, 'embedding'>[] = [];
  const seen = new Set<string>();
  let start = 0;
  while (start < words.length) {
    let end = start;
    let count = 0;
    while (end < words.length && (count < 750 || end === start)) {
      count += Math.max(1, Math.ceil(((words[end]?.length ?? 0) + 1) / 4));
      end++;
    }
    const content = words.slice(start, end).join(' ');
    const checksum = contentChecksum(content);
    if (!seen.has(checksum)) {
      const position = tokens[start]?.index ?? 0;
      const heading =
        headings.filter((item) => (item.index ?? 0) <= position).at(-1)?.[1] ??
        document.sectionHeading;
      output.push({
        index: output.length,
        content,
        tokenCount: count,
        checksum,
        sectionHeading: heading,
      });
      seen.add(checksum);
    }
    if (end >= words.length) break;
    let overlapStart = end;
    let overlap = 0;
    while (overlapStart > start + 1 && overlap < 100) {
      overlapStart--;
      overlap += Math.max(1, Math.ceil(((words[overlapStart]?.length ?? 0) + 1) / 4));
    }
    start = Math.max(start + 1, overlapStart);
  }
  return output;
}

export async function prepareDocuments(
  documents: ExtractedDocument[],
  ai: AIProvider,
  existing: ReadonlyMap<string, number[]> = new Map(),
): Promise<PreparedDocument[]> {
  const cache = new Map(existing);
  const all = documents.map((document) => ({ document, chunks: chunkDocument(document) }));
  const missing = [
    ...new Map(
      all
        .flatMap(({ chunks }) => chunks)
        .filter((chunk) => !cache.has(chunk.checksum))
        .map((chunk) => [chunk.checksum, chunk]),
    ).values(),
  ];
  for (let index = 0; index < missing.length; index += 50) {
    const batch = missing.slice(index, index + 50);
    const vectors = z
      .array(z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS))
      .length(batch.length)
      .parse(
        await ai.embed({
          texts: batch.map((chunk) => chunk.content),
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      );
    batch.forEach((chunk, offset) => {
      const vector = vectors[offset];
      if (vector) cache.set(chunk.checksum, vector);
    });
  }
  return all.map(({ document, chunks }) => ({
    ...document,
    chunks: chunks.map((chunk) => {
      const embedding = cache.get(chunk.checksum);
      if (!embedding) throw new IngestionError('processing_failed');
      return { ...chunk, embedding };
    }),
  }));
}

export async function crawlDocuments(
  input: { pages: string[]; approvedDomains: string[] },
  crawler: CrawlerProvider,
) {
  const urls = [
    ...new Set(input.pages.map((page) => normalizeApprovedUrl(page, input.approvedDomains))),
  ];
  if (!urls.length || urls.length > 100) throw new IngestionError('crawl_failed');
  const documents: ExtractedDocument[] = [];
  let failures = 0;
  for (const url of urls) {
    try {
      const page = await crawler.fetchPage({ url, approvedDomains: input.approvedDomains });
      documents.push(
        extracted(page.text, {
          key: page.url,
          title: page.title,
          canonicalUrl: page.url,
          pageNumber: null,
          sectionHeading: null,
        }),
      );
    } catch {
      failures++;
    }
  }
  if (!documents.length) throw new IngestionError('crawl_failed');
  return { documents, partial: failures > 0 };
}

export async function extractKnowledgeFile(input: {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<ExtractedDocument[]> {
  const extension = validateKnowledgeFile(input);
  if (extension === 'pdf') {
    const pages = await extractPdf(input.bytes);
    const documents = pages
      .filter((page) => page.text.trim())
      .map((page) =>
        extracted(page.text, {
          key: `page:${page.pageNumber}`,
          title: `${input.filename} · page ${page.pageNumber}`,
          canonicalUrl: null,
          pageNumber: page.pageNumber,
          sectionHeading: null,
        }),
      );
    if (!documents.length) throw new IngestionError('unreadable_pdf');
    return documents;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  } catch {
    throw new IngestionError('invalid_file');
  }
  return [
    extracted(text, {
      key: 'file',
      title: input.filename,
      canonicalUrl: null,
      pageNumber: null,
      sectionHeading: extension === 'txt' ? null : (text.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? null),
    }),
  ];
}
export function extractManualText(text: string, name: string) {
  return [
    extracted(text, {
      key: 'manual',
      title: name,
      canonicalUrl: null,
      pageNumber: null,
      sectionHeading: null,
    }),
  ];
}

const pdfResult = z.union([
  z.object({
    pages: z
      .array(
        z.object({
          pageNumber: z.number().int().min(1).max(100),
          text: z.string().max(MAX_TEXT_LENGTH),
        }),
      )
      .max(100),
  }),
  z.object({ error: z.enum(['encrypted_pdf', 'unreadable_pdf', 'extraction_limit']) }),
]);
/** Parser isolation bounds heap, wall time, pages and text. Child streams are never logged. */
async function extractPdf(bytes: Uint8Array) {
  const source = `const {parentPort,workerData} = require('node:worker_threads');
(async () => {
  let task;
  try {
    const pdf = await import(workerData.moduleUrl);
    pdf.GlobalWorkerOptions.workerSrc = workerData.workerUrl;
    task = pdf.getDocument({data:workerData.bytes,stopAtErrors:true,isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,verbosity:0});
    const document = await task.promise;
    if (document.numPages>100) throw new Error('extraction_limit');
    const pages=[]; let length=0;
    for(let index=1;index<=document.numPages;index++) {
      const page=await document.getPage(index);const content=await page.getTextContent();
      const text=content.items.filter(item => typeof item.str === 'string').map(item => item.str + (item.hasEOL?'\\n':' ')).join('');
      length+=text.length;if(length>500000)throw new Error('extraction_limit');
      pages.push({pageNumber:index,text});page.cleanup();
    }
    parentPort.postMessage({pages});
  } catch(error) {parentPort.postMessage({error:error?.name==='PasswordException'?'encrypted_pdf':error?.message==='extraction_limit'?'extraction_limit':'unreadable_pdf'});}
  finally {await task?.destroy();}
})();`;
  return new Promise<{ pageNumber: number; text: string }[]>((resolve, reject) => {
    const worker = new Worker(source, {
      eval: true,
      // Extraction does not need the parent's database or private-storage credentials.
      env: {},
      execArgv: [],
      stdout: true,
      stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
      workerData: {
        bytes: new Uint8Array(bytes),
        moduleUrl: import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'),
        workerUrl: import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
      },
    });
    // Drain parser diagnostics without exposing extracted content or attacker-controlled messages.
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = (
      error: IngestionError | null,
      pages: { pageNumber: number; text: string }[] = [],
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(pages);
    };
    const timer = setTimeout(() => finish(new IngestionError('extraction_timeout')), 15_000);
    worker.once('message', (message: unknown) => {
      const result = pdfResult.safeParse(message);
      if (!result.success) finish(new IngestionError('unreadable_pdf'));
      else if ('error' in result.data) finish(new IngestionError(result.data.error));
      else finish(null, result.data.pages);
    });
    worker.once('error', () => finish(new IngestionError('unreadable_pdf')));
    worker.once('exit', () => {
      if (!settled) finish(new IngestionError('unreadable_pdf'));
    });
  });
}
