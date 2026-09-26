import { z } from 'zod';
import { IngestionError } from '@threadsignal/knowledge/pipeline';
import { MAX_UPLOAD_BYTES } from '@threadsignal/knowledge';
import type { WorkerStorageConfig } from './config';

const pathSchema = z
  .string()
  .max(250)
  .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,150}$/);
export function assertStoragePath(path: string, organizationId: string, brandId: string) {
  if (
    !pathSchema.safeParse(path).success ||
    !z.uuid().safeParse(organizationId).success ||
    !z.uuid().safeParse(brandId).success ||
    !z.uuid().safeParse(path.split('/')[2]).success ||
    !path.startsWith(`${organizationId}/${brandId}/`) ||
    path.split('/').some((segment) => segment === '.' || segment === '..')
  )
    throw new IngestionError('invalid_file');
  return path;
}
export class WorkerKnowledgeStorage {
  constructor(private readonly config: WorkerStorageConfig) {
    if (
      config.mode === 'local'
        ? config.baseUrl !== 'http://127.0.0.1:54321'
        : !['personal-development', 'deployment'].includes(config.mode) ||
          !/^[a-z]{20}$/.test(config.projectRef) ||
          config.baseUrl !== `https://${config.projectRef}.supabase.co` ||
          !/^sb_secret_[A-Za-z0-9_-]{16,200}$/.test(config.key)
    )
      throw new IngestionError('storage_unavailable');
  }
  private headers() {
    if (!this.config.key) throw new IngestionError('storage_unavailable');
    // Modern secret keys are application keys, not JWTs. Supabase's gateway
    // resolves the apikey to service_role; no browser/user authorization is used.
    return this.config.mode === 'local'
      ? { apikey: this.config.key, Authorization: `Bearer ${this.config.key}` }
      : { apikey: this.config.key };
  }
  async read(path: string, organizationId: string, brandId: string): Promise<Uint8Array> {
    const safePath = assertStoragePath(path, organizationId, brandId);
    try {
      const response = await fetch(
        `${this.config.baseUrl}/storage/v1/object/authenticated/knowledge-private/${safePath}`,
        { headers: this.headers(), redirect: 'error', signal: AbortSignal.timeout(15_000) },
      );
      if (
        !response.ok ||
        Number(response.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES ||
        !response.body
      )
        throw new IngestionError('storage_unavailable');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_UPLOAD_BYTES) throw new IngestionError('invalid_file');
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    } catch (error) {
      if (error instanceof IngestionError) throw error;
      throw new IngestionError('storage_unavailable');
    }
  }
  async remove(path: string, organizationId: string, brandId: string) {
    const safePath = assertStoragePath(path, organizationId, brandId);
    try {
      const response = await fetch(`${this.config.baseUrl}/storage/v1/object/knowledge-private`, {
        method: 'DELETE',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [safePath] }),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok && response.status !== 404) throw new IngestionError('storage_unavailable');
      await response.body?.cancel();
    } catch (error) {
      if (error instanceof IngestionError) throw error;
      throw new IngestionError('storage_unavailable');
    }
  }
}

/** Existing local commands never accept a configurable remote Storage endpoint. */
export class LocalKnowledgeStorage extends WorkerKnowledgeStorage {
  constructor(key: string | undefined) {
    super({ mode: 'local', baseUrl: 'http://127.0.0.1:54321', key });
  }
}
