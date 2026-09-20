import { describe, expect, it, vi } from 'vitest';
import { MockAIProvider } from '@threadsignal/ai';
import { FixtureCrawlerProvider } from '@threadsignal/crawler';
import {
  chunkDocument,
  contentChecksum,
  crawlDocuments,
  extractKnowledgeFile,
  extractManualText,
  normalizeText,
  prepareDocuments,
  safeIngestionError,
} from '../src/pipeline.js';

import { pdfFixture } from '../../../fixtures/knowledge/pdf.js';

describe('knowledge normalization and chunks', () => {
  it('normalizes compatibility characters, controls and whitespace deterministically', () => {
    expect(normalizeText('  Ａ\u0000\r\n\r\n\r\nB\t C  ')).toBe('A\n\nB C');
    expect(contentChecksum('same')).toBe(contentChecksum('same'));
  });
  it('retains source metadata and bounded chunks with overlap', () => {
    const text = Array.from({ length: 1600 }, (_, i) => `word${i}`).join(' ');
    const doc = extractManualText(text, 'Guide')[0]!;
    const chunks = chunkDocument(doc);
    expect(chunks.length).toBeGreaterThan(2);
    expect(
      chunks.slice(0, -1).every((chunk) => chunk.tokenCount >= 600 && chunk.tokenCount <= 900),
    ).toBe(true);
    expect(chunks[0]?.content.split(' ').at(-1)).toBe(
      chunks[1]?.content.split(' ').find((word) => word === chunks[0]?.content.split(' ').at(-1)),
    );
    expect(new Set(chunks.map((chunk) => chunk.checksum)).size).toBe(chunks.length);
  });
  it('bounds unbroken tokens and preserves section headings', () => {
    const doc = extractManualText('# API limits\n' + 'x'.repeat(20000), 'Guide')[0]!;
    const chunks = chunkDocument(doc);
    expect(chunks.every((chunk) => chunk.tokenCount <= 900 && chunk.content.length <= 20000)).toBe(
      true,
    );
    expect(chunks[0]?.sectionHeading).toBe('API limits');
  });
  it('does not re-embed unchanged chunks', async () => {
    const ai = new MockAIProvider();
    const embed = vi.spyOn(ai, 'embed');
    const docs = extractManualText(
      'API batches support fifty images and private storage.',
      'Limits',
    );
    const first = await prepareDocuments(docs, ai);
    const cache = new Map(
      first.flatMap((doc) => doc.chunks.map((chunk) => [chunk.checksum, chunk.embedding] as const)),
    );
    embed.mockClear();
    expect(await prepareDocuments(docs, ai, cache)).toEqual(first);
    expect(embed).not.toHaveBeenCalled();
  });
  it('ingests canonical fixture pages and marks partial failures', async () => {
    const result = await crawlDocuments(
      {
        pages: [
          'https://clarityscale.example/docs?ref=one',
          'https://clarityscale.example/docs#api',
          'https://clarityscale.example/missing',
        ],
        approvedDomains: ['clarityscale.example'],
      },
      new FixtureCrawlerProvider(),
    );
    expect(result.partial).toBe(true);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.canonicalUrl).toBe('https://clarityscale.example/docs');
  });
});

describe('private file extraction', () => {
  it.each(['notes.txt', 'notes.md', 'notes.markdown'])('extracts %s', async (filename) => {
    const docs = await extractKnowledgeFile({
      filename,
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('# Product\nBatch images remain private.'),
    });
    expect(docs[0]?.content).toContain('Batch images remain private.');
  });
  it('extracts PDF text with page provenance in a bounded parser worker', async () => {
    const docs = await extractKnowledgeFile({
      filename: 'guide.pdf',
      mimeType: 'application/pdf',
      bytes: pdfFixture('Private image storage supports batch processing.'),
    });
    expect(docs[0]?.pageNumber).toBe(1);
    expect(docs[0]?.content).toContain('Private image storage');
  }, 20000);
  it.each([
    {
      filename: 'data.exe',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('not supported'),
    },
    {
      filename: '../notes.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('unsafe filename'),
    },
    {
      filename: 'fake.pdf',
      mimeType: 'application/pdf',
      bytes: new TextEncoder().encode('plain text'),
    },
    {
      filename: 'fake.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('<html>not text</html>'),
    },
    { filename: 'binary.txt', mimeType: 'text/plain', bytes: new Uint8Array([0, 1, 2]) },
    { filename: 'invalid.txt', mimeType: 'text/plain', bytes: new Uint8Array([255, 255]) },
    { filename: 'empty.txt', mimeType: 'text/plain', bytes: new Uint8Array() },
  ])('rejects unsafe or unreadable input $filename', async (input) => {
    await expect(extractKnowledgeFile(input)).rejects.toThrow();
  });
  it('reports unreadable PDF without propagating parser content', async () => {
    await expect(
      extractKnowledgeFile({
        filename: 'broken.pdf',
        mimeType: 'application/pdf',
        bytes: new TextEncoder().encode('%PDF-1.4\nprivate malformed input'),
      }),
    ).rejects.toThrow('unreadable_pdf');
    expect(safeIngestionError(new Error('private customer content'))).toBe('processing_failed');
  }, 20000);
  it('rejects password-protected PDF documents with a distinct safe error', async () => {
    await expect(
      extractKnowledgeFile({
        filename: 'encrypted.pdf',
        mimeType: 'application/pdf',
        bytes: pdfFixture('Encrypted fixture text', true),
      }),
    ).rejects.toThrow('encrypted_pdf');
  }, 20000);
});
