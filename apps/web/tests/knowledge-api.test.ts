// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoBrand } from '@threadsignal/knowledge';
import { parseServerEnv } from '@threadsignal/config';
import { KnowledgeError } from '../src/lib/knowledge/http';

const mocks = vi.hoisted(() => ({
  environment: vi.fn(),
  organization: vi.fn(),
  mutationLimit: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
  order: vi.fn(),
  rpc: vi.fn(),
  storage: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/mutation-rate-limit', () => ({
  enforceMutationRateLimit: mocks.mutationLimit,
}));
vi.mock('@/lib/organizations/server', () => ({ requireOrganization: mocks.organization }));
vi.mock('@/lib/env/server', () => ({ getServerEnv: mocks.environment }));
vi.mock('next/navigation', () => ({
  unstable_rethrow: vi.fn(),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import { POST as createBrandRoute } from '../src/app/api/brands/route';
import { PATCH as updateBrandRoute } from '../src/app/api/brands/[id]/route';
import { POST as addSourceRoute } from '../src/app/api/brands/[id]/knowledge/route';
import { POST as uploadRoute } from '../src/app/api/brands/[id]/knowledge/upload/route';
import { DELETE as deleteSourceRoute } from '../src/app/api/knowledge/[id]/route';
import { PATCH as documentRoute } from '../src/app/api/knowledge/documents/[id]/route';
import { GET as downloadRoute } from '../src/app/api/knowledge/[id]/download/route';
import {
  loadBrands,
  loadBrand,
  loadKnowledge,
  loadKnowledgeSource,
  localKnowledgeEnabled,
} from '../src/lib/knowledge/server';

const organizationId = '20000000-0000-4000-8000-000000000001';
const otherOrganizationId = '20000000-0000-4000-8000-000000000002';
const brandId = '30000000-0000-4000-8000-000000000001';
const sourceId = '40000000-0000-4000-8000-000000000001';
const origin = 'http://127.0.0.1:3000';
const hostedProfile = {
  THREADSIGNAL_SUPABASE_MODE: 'personal-development',
  THREADSIGNAL_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3002',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'synthetic_fixture'.repeat(2),
};
const brand = {
  id: brandId,
  organization_id: organizationId,
  name: demoBrand.name,
  website_url: demoBrand.website_url,
  profile: demoBrand,
  status: 'active',
  created_at: '2026-09-16T00:00:00Z',
};
const source = {
  id: sourceId,
  organization_id: organizationId,
  brand_id: brandId,
  name: 'Private guide',
  type: 'file',
  status: 'ready',
  source_url: null,
  storage_path: `${organizationId}/${brandId}/${sourceId}/guide.txt`,
  filename: 'guide.txt',
  mime_type: 'text/plain',
  error_code: null,
  page_count: 1,
  chunk_count: 1,
  generation: 1,
  created_at: '2026-09-16T00:00:00Z',
  updated_at: '2026-09-16T00:00:00Z',
  last_ingested_at: '2026-09-16T00:00:00Z',
  deleted_at: null,
};
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/brands`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'x-threadsignal-organization': organizationId,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
function fileRequest(filename = 'guide.txt') {
  const form = new FormData();
  form.set('name', 'Product guide');
  form.set(
    'file',
    new File(['The batch image API supports asynchronous image optimization.'], filename, {
      type: 'text/plain',
    }),
  );
  return new Request(`${origin}/api/brands/${brandId}/knowledge/upload`, {
    method: 'POST',
    headers: { origin },
    body: form,
  });
}

describe('knowledge HTTP and hosted isolation boundaries', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    vi.stubEnv('THREADSIGNAL_LOCAL', '1');
    vi.stubEnv('THREADSIGNAL_SERVICES_READY', '1');
    mocks.environment.mockReturnValue({
      THREADSIGNAL_SUPABASE_MODE: 'local',
      NEXT_PUBLIC_APP_URL: origin,
    });
    const builder = {
      select: mocks.select,
      eq: mocks.eq,
      maybeSingle: mocks.single,
      order: mocks.order,
    };
    mocks.from.mockReturnValue(builder);
    mocks.select.mockReturnValue(builder);
    mocks.eq.mockReturnValue(builder);
    mocks.order.mockResolvedValue({ data: [brand], error: null });
    mocks.single.mockResolvedValue({ data: brand, error: null });
    mocks.rpc.mockResolvedValue({ data: sourceId, error: null });
    mocks.storage.mockReturnValue({
      upload: mocks.upload,
      remove: mocks.remove,
      download: mocks.download,
    });
    mocks.upload.mockResolvedValue({ data: {}, error: null });
    mocks.remove.mockResolvedValue({ data: [], error: null });
    mocks.download.mockResolvedValue({ data: new Blob(['Private fixture document']), error: null });
    mocks.organization.mockResolvedValue({
      organization: { id: organizationId, role: 'owner' },
      supabase: { from: mocks.from, rpc: mocks.rpc, storage: { from: mocks.storage } },
    });
  });

  it('refuses a rate-limited write before allocating a brand or touching Storage', async () => {
    mocks.mutationLimit.mockRejectedValueOnce(new KnowledgeError('RATE_LIMITED', 429));
    const result = await createBrandRoute(request(demoBrand));
    expect(result.status).toBe(429);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.storage).not.toHaveBeenCalled();
    expect(mocks.mutationLimit).toHaveBeenCalledWith('knowledge', organizationId);
  });
  it('blocks hosted mutations before creating any authenticated client or database/storage query', async () => {
    mocks.environment.mockReturnValue(parseServerEnv(hostedProfile));
    for (const response of [
      await createBrandRoute(request(demoBrand)),
      await updateBrandRoute(request({ archived: true }), context(brandId)),
      await addSourceRoute(
        request({ name: 'Notes', type: 'manual', text: 'A product knowledge entry.' }),
        context(brandId),
      ),
      await uploadRoute(fileRequest(), context(brandId)),
      await deleteSourceRoute(request({}), context(sourceId)),
      await documentRoute(request({ included: false }), context(sourceId)),
      await downloadRoute(
        new Request(`${origin}/api/knowledge/${sourceId}/download`),
        context(sourceId),
      ),
    ]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: 'KNOWLEDGE_UNAVAILABLE' } });
    }
    expect(mocks.organization).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.storage).not.toHaveBeenCalled();
  });

  it('renders hosted knowledge explanations without issuing Phase 2 table queries', async () => {
    mocks.environment.mockReturnValue(parseServerEnv(hostedProfile));
    expect(await loadBrands()).toMatchObject({ brands: [], localEnabled: false });
    expect(await loadBrand(brandId)).toMatchObject({ brand: undefined, localEnabled: false });
    expect(await loadKnowledge(brandId)).toMatchObject({
      brand: undefined,
      sources: [],
      localEnabled: false,
    });
    expect(await loadKnowledgeSource(sourceId)).toMatchObject({
      source: undefined,
      documents: [],
      localEnabled: false,
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('enables hosted reads and writes only for the explicitly ready personal development profile', async () => {
    mocks.environment.mockReturnValue(
      parseServerEnv({ ...hostedProfile, THREADSIGNAL_HOSTED_KNOWLEDGE_READY: '1' }),
    );
    expect(localKnowledgeEnabled()).toBe(true);
    expect(await loadBrands()).toMatchObject({ brands: [brand], localEnabled: true });
    expect(mocks.eq).toHaveBeenCalledWith('organization_id', organizationId);
    const response = await createBrandRoute(
      request(demoBrand, { origin: hostedProfile.NEXT_PUBLIC_APP_URL }),
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'save_brand',
      expect.objectContaining({ p_organization_id: organizationId }),
    );
  });

  it.each(['THREADSIGNAL_LOCAL', 'THREADSIGNAL_SERVICES_READY'])(
    'keeps hosted access disabled without %s even when the hosted flag is set',
    async (flag) => {
      mocks.environment.mockReturnValue(
        parseServerEnv({ ...hostedProfile, THREADSIGNAL_HOSTED_KNOWLEDGE_READY: '1' }),
      );
      vi.stubEnv(flag, '0');
      expect(localKnowledgeEnabled()).toBe(false);
      expect(
        (await createBrandRoute(request(demoBrand, { origin: hostedProfile.NEXT_PUBLIC_APP_URL })))
          .status,
      ).toBe(503);
      expect(mocks.organization).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it('refuses a ready flag without the matching validated project URL', () => {
    for (const change of [
      { THREADSIGNAL_SUPABASE_PROJECT_REF: undefined },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://differentprojecthere.supabase.co' },
      { THREADSIGNAL_SUPABASE_MODE: 'hosted' },
    ]) {
      mocks.environment.mockReturnValue({
        ...hostedProfile,
        THREADSIGNAL_HOSTED_KNOWLEDGE_READY: '1',
        ...change,
      });
      expect(localKnowledgeEnabled()).toBe(false);
    }
  });

  it('preserves role and origin checks when hosted processing is ready', async () => {
    mocks.environment.mockReturnValue(
      parseServerEnv({ ...hostedProfile, THREADSIGNAL_HOSTED_KNOWLEDGE_READY: '1' }),
    );
    expect((await createBrandRoute(request(demoBrand))).status).toBe(403);
    expect(mocks.organization).not.toHaveBeenCalled();
    mocks.organization.mockResolvedValue({
      organization: { id: organizationId, role: 'viewer' },
      supabase: { from: mocks.from, rpc: mocks.rpc },
    });
    expect(
      (await createBrandRoute(request(demoBrand, { origin: hostedProfile.NEXT_PUBLIC_APP_URL })))
        .status,
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when local services ownership is not established', async () => {
    vi.stubEnv('THREADSIGNAL_SERVICES_READY', '0');
    const response = await createBrandRoute(request(demoBrand));
    expect(response.status).toBe(503);
    expect(mocks.organization).not.toHaveBeenCalled();
  });

  it('rejects missing, forged and cross-site origins before tenant access', async () => {
    for (const headers of [
      { origin: '' },
      { origin: 'https://attacker.example' },
      { 'sec-fetch-site': 'cross-site' },
    ]) {
      const response = await createBrandRoute(request(demoBrand, headers));
      expect(response.status).toBe(403);
    }
    expect(mocks.organization).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(['member', 'viewer'])(
    'rejects %s source mutations before querying brand records',
    async (role) => {
      mocks.organization.mockResolvedValue({
        organization: { id: organizationId, role },
        supabase: { from: mocks.from, rpc: mocks.rpc },
      });
      const response = await addSourceRoute(request({}), context(brandId));
      expect(response.status).toBe(403);
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it('rejects a stale organization selection rather than creating in the newly selected workspace', async () => {
    const response = await createBrandRoute(
      request(demoBrand, { 'x-threadsignal-organization': otherOrganizationId }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'WORKSPACE_CHANGED' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('binds brand and source mutations to the active organization before any RPC', async () => {
    mocks.single.mockResolvedValue({ data: null, error: null });
    const response = await updateBrandRoute(request({ archived: true }), context(brandId));
    expect(response.status).toBe(404);
    expect(mocks.eq).toHaveBeenCalledWith('id', brandId);
    expect(mocks.eq).toHaveBeenCalledWith('organization_id', organizationId);
    const sourceResponse = await deleteSourceRoute(request({}), context(sourceId));
    expect(sourceResponse.status).toBe(404);
    expect(mocks.eq).toHaveBeenCalledWith('id', sourceId);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('preserves SQL quota denial and never leaks raw database details', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'BRAND_LIMIT', code: 'P0001' },
    });
    const limited = await createBrandRoute(request(demoBrand));
    expect(limited.status).toBe(409);
    expect(await limited.json()).toMatchObject({ error: { code: 'BRAND_LIMIT' } });
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'synthetic private database details', code: 'XX000' },
    });
    const failed = await createBrandRoute(request(demoBrand));
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain('synthetic private database details');
    expect(failed.headers.get('cache-control')).toBe('no-store');
  });

  it('requires a valid complete brand profile before a mutation RPC', async () => {
    const response = await createBrandRoute(request({ ...demoBrand, disclosure_text: '' }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('prevents direct file-source JSON from bypassing original upload validation', async () => {
    const response = await addSourceRoute(
      request({
        name: 'Injected file',
        type: 'file',
        filename: 'guide.txt',
        mime_type: 'text/plain',
        storage_path: source.storage_path,
      }),
      context(brandId),
    );
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('scopes private downloads and returns attachments with no sniffing or caching', async () => {
    mocks.single.mockResolvedValue({ data: source, error: null });
    const response = await downloadRoute(
      new Request(`${origin}/api/knowledge/${sourceId}/download`),
      context(sourceId),
    );
    expect(mocks.eq).toHaveBeenCalledWith('organization_id', organizationId);
    expect(mocks.storage).toHaveBeenCalledWith('knowledge-private');
    expect(mocks.download).toHaveBeenCalledWith(source.storage_path);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="guide.txt"');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('Private fixture document');
  });

  it('does not download deleted sources or source IDs unavailable in the selected tenant', async () => {
    mocks.single.mockResolvedValueOnce({
      data: { ...source, deleted_at: '2026-09-16T00:00:00Z' },
      error: null,
    });
    expect(
      (
        await downloadRoute(
          new Request(`${origin}/api/knowledge/${sourceId}/download`),
          context(sourceId),
        )
      ).status,
    ).toBe(404);
    mocks.single.mockResolvedValueOnce({ data: null, error: null });
    expect(
      (
        await downloadRoute(
          new Request(`${origin}/api/knowledge/${sourceId}/download`),
          context(sourceId),
        )
      ).status,
    ).toBe(404);
    expect(mocks.storage).not.toHaveBeenCalled();
  });

  it('cleans up an original upload if the source allocation RPC rejects it', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'SOURCE_LIMIT' } });
    const response = await uploadRoute(fileRequest(), context(brandId));
    expect(response.status).toBe(409);
    const path = mocks.upload.mock.calls[0]?.[0];
    expect(typeof path).toBe('string');
    expect(mocks.remove).toHaveBeenCalledWith([path]);
  });

  it('cleans up an original upload when database transport throws after upload', async () => {
    mocks.rpc.mockRejectedValue(new Error('Synthetic transport failure'));
    const response = await uploadRoute(fileRequest(), context(brandId));
    expect(response.status).toBe(500);
    const path = mocks.upload.mock.calls[0]?.[0];
    expect(mocks.remove).toHaveBeenCalledWith([path]);
    expect(await response.text()).not.toContain('Synthetic transport failure');
  });

  it('normalizes a maximum-length upload filename before storing any original', async () => {
    const response = await uploadRoute(fileRequest(`${'a'.repeat(146)}.txt`), context(brandId));
    expect(response.status).toBe(200);
    const path: unknown = mocks.upload.mock.calls[0]?.[0];
    expect(typeof path).toBe('string');
    if (typeof path !== 'string') throw new Error('Expected private upload path');
    expect(path.length).toBeLessThanOrEqual(250);
    expect(path.endsWith('.txt')).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'add_knowledge_source',
      expect.objectContaining({ p_brand_id: brandId }),
    );
  });
});
