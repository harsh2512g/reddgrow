import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalPrivacyStorage, WorkerPrivacyStorage, MAX_EXPORT_BYTES } from '../src/jobs/privacy';

describe('privacy Storage transport boundary', () => {
  afterEach(() => vi.unstubAllGlobals());
  const config = {
    mode: 'local' as const,
    baseUrl: 'http://127.0.0.1:54321' as const,
    key: 'synthetic-storage-test-key',
  };
  it('refuses hosted configuration and missing local worker authority', () => {
    expect(() => new LocalPrivacyStorage({ ...config, key: undefined })).toThrow(
      'PRIVACY_STORAGE_UNAVAILABLE',
    );
    expect(
      () =>
        new LocalPrivacyStorage({
          mode: 'personal-development',
          baseUrl: 'https://personal.example',
          projectRef: 'unused',
          key: '',
        }),
    ).toThrow('PRIVACY_STORAGE_UNAVAILABLE');
  });
  it('uploads only a bounded gzip artifact to the fixed private bucket without following redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const path = `${randomUUID()}/${randomUUID()}/${randomUUID()}.json.gz`;
    await new LocalPrivacyStorage(config).writeExport(path, new Uint8Array([31, 139]));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `http://127.0.0.1:54321/storage/v1/object/privacy-exports/${path}`,
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/gzip', 'x-upsert': 'true' },
    });
  });
  it('rejects traversal, oversized artifacts and cross-tenant original reads before HTTP', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const storage = new LocalPrivacyStorage(config),
      org = randomUUID(),
      brand = randomUUID();
    await expect(storage.writeExport(`${org}/../unexpected.gz`, new Uint8Array())).rejects.toThrow(
      'PRIVACY_STORAGE_UNAVAILABLE',
    );
    await expect(
      storage.writeExport(
        `${org}/${randomUUID()}/${randomUUID()}.json.gz`,
        new Uint8Array(MAX_EXPORT_BYTES + 1),
      ),
    ).rejects.toThrow('PRIVACY_STORAGE_UNAVAILABLE');
    await expect(storage.remove('knowledge-private', `${org}/../private.txt`)).rejects.toThrow(
      'PRIVACY_STORAGE_UNAVAILABLE',
    );
    await expect(
      storage.readOriginal(`${randomUUID()}/${brand}/${randomUUID()}/file.txt`, org, brand),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('removes an exact object name and treats already-absent objects idempotently', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    const path = `${randomUUID()}/${randomUUID()}/${randomUUID()}/source.txt`;
    await new LocalPrivacyStorage(config).remove('knowledge-private', path);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'DELETE',
      redirect: 'error',
      body: JSON.stringify({ prefixes: [path] }),
    });
  });
  it('discards provider error payloads and transport exceptions', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('private upstream payload', { status: 500 }))
      .mockRejectedValueOnce(new Error('private transport payload'));
    vi.stubGlobal('fetch', fetcher);
    const storage = new LocalPrivacyStorage(config);
    const path = `${randomUUID()}/${randomUUID()}/${randomUUID()}.json.gz`;
    await expect(storage.writeExport(path, new Uint8Array([1]))).rejects.toThrow(
      /^PRIVACY_STORAGE_UNAVAILABLE$/,
    );
    await expect(storage.remove('privacy-exports', path)).rejects.toThrow(
      /^PRIVACY_STORAGE_UNAVAILABLE$/,
    );
  });
  it('uses only the explicitly validated deployment project and a server apikey for private exports', async () => {
    const projectRef = 'abcdefghijklmnopqrst';
    const deployed = {
      mode: 'deployment' as const,
      projectRef,
      baseUrl: `https://${projectRef}.supabase.co`,
      key: `sb_secret_${'synthetic'.repeat(3)}`,
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const path = `${randomUUID()}/${randomUUID()}/${randomUUID()}.json.gz`;
    await new WorkerPrivacyStorage(deployed).writeExport(path, new Uint8Array([31, 139]));
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `${deployed.baseUrl}/storage/v1/object/privacy-exports/${path}`,
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'error',
      headers: { apikey: deployed.key },
    });
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
    expect(
      () => new WorkerPrivacyStorage({ ...deployed, baseUrl: 'https://unrelated.example.com' }),
    ).toThrow();
    expect(() => new LocalPrivacyStorage(deployed)).toThrow('PRIVACY_STORAGE_UNAVAILABLE');
  });
});
