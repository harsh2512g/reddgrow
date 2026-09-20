import { describe, expect, it, vi } from 'vitest';
import { knowledgePayload, retryDelaySeconds } from '../src/jobs/knowledge';
import { assertStoragePath, LocalKnowledgeStorage, WorkerKnowledgeStorage } from '../src/storage';
import { MAX_UPLOAD_BYTES } from '@threadsignal/knowledge';

const organization = '10000000-0000-4000-8000-000000000001';
const brand = '20000000-0000-4000-8000-000000000001';
const source = '30000000-0000-4000-8000-000000000001';
const path = `${organization}/${brand}/${source}/guide.pdf`;
describe('knowledge worker boundaries', () => {
  it('queue payload contains only a durable job identifier', () => {
    expect(knowledgePayload.parse({ jobId: source })).toEqual({ jobId: source });
    expect(() => knowledgePayload.parse({ jobId: source, text: 'customer content' })).toThrow();
    expect(() => knowledgePayload.parse({ jobId: source, token: 'not permitted' })).toThrow();
  });
  it('retries use bounded exponential backoff', () => {
    expect([1, 2, 3, 9].map(retryDelaySeconds)).toEqual([2, 4, 8, 30]);
  });
  it('restricts storage paths to the matching organization and brand', () => {
    expect(assertStoragePath(path, organization, brand)).toBe(path);
    expect(() => assertStoragePath(path, brand, organization)).toThrow();
    expect(() =>
      assertStoragePath(`${organization}/${brand}/${source}/../secret`, organization, brand),
    ).toThrow();
    expect(() =>
      assertStoragePath(`${organization}/${brand}/${source}/%2e%2e`, organization, brand),
    ).toThrow();
  });
  it('sends file reads only to the fixed local endpoint and forbids redirects', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('file bytes'));
    try {
      const storage = new LocalKnowledgeStorage('synthetic-unit-value');
      await storage.read(path, organization, brand);
      expect(fetch).toHaveBeenCalledWith(
        `http://127.0.0.1:54321/storage/v1/object/authenticated/knowledge-private/${path}`,
        expect.objectContaining({ redirect: 'error' }),
      );
    } finally {
      fetch.mockRestore();
    }
  });
  it('refuses file operations without the worker-only local credential', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(
        new LocalKnowledgeStorage(undefined).read(path, organization, brand),
      ).rejects.toThrow('storage_unavailable');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});

const projectRef = 'abcdefghijklmnopqrst';
const hostedStorage = {
  mode: 'personal-development' as const,
  projectRef,
  baseUrl: `https://${projectRef}.supabase.co`,
  key: `sb_secret_${'synthetic'.repeat(3)}`,
};

describe('personal hosted knowledge Storage', () => {
  it('uses only the matching project endpoint and apikey authentication for modern keys', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('safe fixture'));
    try {
      const storage = new WorkerKnowledgeStorage(hostedStorage);
      const bytes = await storage.read(path, organization, brand);
      expect(new TextDecoder().decode(bytes)).toBe('safe fixture');
      await storage.remove(path, organization, brand);
      expect(fetch.mock.calls[0]).toEqual([
        `${hostedStorage.baseUrl}/storage/v1/object/authenticated/knowledge-private/${path}`,
        expect.objectContaining({
          headers: { apikey: hostedStorage.key },
          redirect: 'error',
          signal: expect.any(AbortSignal),
        }),
      ]);
      expect(fetch.mock.calls[1]).toEqual([
        `${hostedStorage.baseUrl}/storage/v1/object/knowledge-private`,
        expect.objectContaining({
          method: 'DELETE',
          headers: { apikey: hostedStorage.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: [path] }),
          redirect: 'error',
        }),
      ]);
    } finally {
      fetch.mockRestore();
    }
  });

  it.each([
    { baseUrl: 'http://127.0.0.1:54321' },
    { baseUrl: `${hostedStorage.baseUrl}.example` },
    { baseUrl: `${hostedStorage.baseUrl}/other` },
    { projectRef: 'tsrqponmlkjihgfedcba' },
    { key: 'legacy.jwt.value' },
  ])('rejects mismatched storage configuration before fetch (%#)', (override) => {
    expect(() => new WorkerKnowledgeStorage({ ...hostedStorage, ...override })).toThrow(
      'storage_unavailable',
    );
  });

  it('validates tenant path before either network operation', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      const storage = new WorkerKnowledgeStorage(hostedStorage);
      await expect(storage.read(path, brand, organization)).rejects.toThrow('invalid_file');
      await expect(storage.remove(path, brand, organization)).rejects.toThrow('invalid_file');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it('bounds streamed content even when the remote Content-Length is absent', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_UPLOAD_BYTES + 1));
      },
      cancel,
    });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
    try {
      await expect(
        new WorkerKnowledgeStorage(hostedStorage).read(path, organization, brand),
      ).rejects.toThrow('invalid_file');
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      fetch.mockRestore();
    }
  });

  it('sanitizes remote failures and treats repeated deletion as successful', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error(`secret: ${hostedStorage.key}`))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    try {
      const storage = new WorkerKnowledgeStorage(hostedStorage);
      await expect(storage.read(path, organization, brand)).rejects.toThrow(
        /^storage_unavailable$/,
      );
      await expect(storage.remove(path, organization, brand)).resolves.toBeUndefined();
    } finally {
      fetch.mockRestore();
    }
  });
});
