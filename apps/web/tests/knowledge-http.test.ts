import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { brandInputSchema, demoBrand, sourceInputSchema } from '@threadsignal/knowledge';
import {
  boundedBody,
  knowledgeJson,
  knowledgeErrorResponse,
  checkDatabaseError,
  KnowledgeError,
} from '../src/lib/knowledge/http';

describe('knowledge request boundaries', () => {
  it('rejects malformed and private brand URLs without throwing outside validation', () => {
    for (const website_url of [
      'broken',
      'http://127.0.0.1',
      'https://127.0.0.1',
      'https://[::1]',
      'https://user:password@example.com',
      'https://intranet.local',
    ]) {
      expect(brandInputSchema.safeParse({ ...demoBrand, website_url }).success).toBe(false);
    }
    expect(brandInputSchema.safeParse(demoBrand).success).toBe(true);
    expect(
      brandInputSchema.safeParse({ ...demoBrand, allowed_links: ['https://another.example'] })
        .success,
    ).toBe(false);
    expect(
      brandInputSchema.safeParse({ ...demoBrand, tone: 'Custom', custom_tone: '' }).success,
    ).toBe(false);
  });
  it('requires explicit pages and meaningful manual text', () => {
    expect(
      sourceInputSchema.safeParse({ name: 'Fixture', type: 'website', pages: [] }).success,
    ).toBe(false);
    expect(
      sourceInputSchema.safeParse({ name: 'Fixture', type: 'manual', text: 'short' }).success,
    ).toBe(false);
  });
  it('bounds streamed bytes even when Content-Length is absent or dishonest', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(12));
        controller.enqueue(new Uint8Array(12));
        controller.close();
      },
    });
    const request = new Request('http://127.0.0.1/test', {
      method: 'POST',
      body,
      headers: { 'content-length': '1' },
      duplex: 'half',
    } as RequestInit);
    await expect(boundedBody(request, 20)).rejects.toMatchObject({ status: 413 });
  });
  it('accepts validated JSON and rejects malformed input and MIME', async () => {
    const request = (body: string, mime = 'application/json') =>
      new Request('http://127.0.0.1/test', {
        method: 'POST',
        body,
        headers: { 'content-type': mime },
      });
    await expect(
      knowledgeJson(request('{"name":"ok"}'), z.object({ name: z.string() })),
    ).resolves.toEqual({ name: 'ok' });
    await expect(knowledgeJson(request('{'), z.object({}))).rejects.toBeInstanceOf(KnowledgeError);
    await expect(knowledgeJson(request('{}', 'text/html'), z.object({}))).rejects.toBeInstanceOf(
      KnowledgeError,
    );
  });
  it('never exposes raw database or parser error details', async () => {
    const result = knowledgeErrorResponse(new Error('private uploaded text'));
    expect(await result.text()).not.toContain('private uploaded text');
    expect(() => checkDatabaseError({ message: 'secret query content', code: '42501' })).toThrow(
      'FORBIDDEN',
    );
    expect(() => checkDatabaseError({ message: 'BRAND_LIMIT' })).toThrow('BRAND_LIMIT');
  });
});
