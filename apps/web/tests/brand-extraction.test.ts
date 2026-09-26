// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoBrand } from '@threadsignal/knowledge';
import type { AIProvider } from '@threadsignal/ai';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  environment: vi.fn(),
  enabled: vi.fn(),
  limit: vi.fn(),
  ai: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/provider-plan', () => ({ requireActiveProviderPlan: vi.fn() }));
vi.mock('../src/lib/phase7/database', () => ({ billingDatabase: vi.fn() }));
vi.mock('@/lib/organizations/server', () => ({ requireOrganization: mocks.context }));
vi.mock('@/lib/env/server', () => ({ getServerEnv: mocks.environment }));
vi.mock('@/lib/env/providers', () => ({ configuredAIProvider: mocks.ai }));
vi.mock('@/lib/mutation-rate-limit', () => ({ enforceMutationRateLimit: mocks.limit }));
vi.mock('@/lib/knowledge/server', () => ({
  localKnowledgeEnabled: mocks.enabled,
  brandColumns: 'id,organization_id,name,website_url,profile,status,created_at',
}));
import {
  extractProduct,
  generateProductExtraction,
  loadExtractionEvidence,
  assertExtractionCurrent,
} from '../src/lib/knowledge/extraction';
import { updateBrand } from '../src/lib/knowledge/api';
import { MockAIProvider } from '@threadsignal/ai';
const organization = '10000000-0000-4000-8000-000000000001';
const brandId = '20000000-0000-4000-8000-000000000001';
const documentId = '30000000-0000-4000-8000-000000000001';
const sourceId = '40000000-0000-4000-8000-000000000001';
const content = 'Example product organizes private project documents for engineering teams.';
const origin = 'http://127.0.0.1:3000';
let role = 'owner';
let found = true;
let rows: unknown[] = [];
const filters: unknown[][] = [];
const context = () => ({
  user: { id: '50000000-0000-4000-8000-000000000001' },
  organization: { id: organization, role },
  supabase: { from: mocks.from, rpc: mocks.rpc },
});
function request(input: unknown = { operation: 'preview' }, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/brands/${brandId}/extract-product`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin,
      'X-ThreadSignal-Organization': organization,
      ...headers,
    },
    body: JSON.stringify(input),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  role = 'owner';
  found = true;
  filters.length = 0;
  mocks.enabled.mockReturnValue(true);
  mocks.environment.mockReturnValue({ NEXT_PUBLIC_APP_URL: origin });
  mocks.context.mockImplementation(async () => context());
  mocks.ai.mockReturnValue(new MockAIProvider());
  mocks.rpc.mockResolvedValue({ data: brandId, error: null });
  rows = [
    {
      id: documentId,
      source_id: sourceId,
      title: 'Product guide',
      content,
      checksum: 'a'.repeat(64),
      source: { generation: 1, status: 'ready', deleted_at: null },
    },
  ];
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      order: () => query,
      limit: () => query,
      eq: (field: string, value: unknown) => {
        filters.push([table, field, value]);
        return query;
      },
      in: (field: string, value: unknown) => {
        filters.push([table, field, value]);
        return query;
      },
      is: (field: string, value: unknown) => {
        filters.push([table, field, value]);
        return query;
      },
      maybeSingle: async () => ({
        data: found
          ? {
              id: brandId,
              organization_id: organization,
              name: demoBrand.name,
              website_url: demoBrand.website_url,
              profile: demoBrand,
              status: 'active',
              created_at: '2026-09-20T00:00:00Z',
            }
          : null,
        error: null,
      }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return query;
  });
});
describe('brand extraction authorization and evidence', () => {
  it.each(['member', 'viewer'])(
    'rejects %s before reading product evidence or using AI',
    async (value) => {
      role = value;
      await expect(extractProduct(request(), brandId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.ai).not.toHaveBeenCalled();
    },
  );
  it('rejects untrusted origin and workspace changes before provider work', async () => {
    await expect(
      extractProduct(request(undefined, { origin: 'https://other.example' }), brandId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      extractProduct(request(undefined, { 'X-ThreadSignal-Organization': sourceId }), brandId),
    ).rejects.toMatchObject({ code: 'WORKSPACE_CHANGED' });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('does not read another workspace brand or invent a result for no evidence', async () => {
    found = false;
    await expect(extractProduct(request(), brandId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('brands');
    found = true;
    rows = [];
    expect(await extractProduct(request(), brandId)).toMatchObject({
      suggestions: [],
      documents: [],
    });
  });
  it('extracts a deterministic source sentence and scopes current included knowledge', async () => {
    const result = await extractProduct(request(), brandId);
    expect(result).toMatchObject({
      provider: 'mock',
      suggestions: [
        {
          field: 'description',
          value: content,
          citations: [{ document_id: documentId, quote: content }],
        },
      ],
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    for (const [field, value] of [
      ['organization_id', organization],
      ['brand_id', brandId],
      ['is_included', true],
      ['source.deleted_at', null],
    ])
      expect(filters).toContainEqual(['knowledge_documents', field, value]);
    expect(mocks.limit).toHaveBeenCalledWith('knowledge', organization);
  });
  it.each(['foreign', 'fabricated'])(
    'rejects %s citations even when the model output has a valid shape',
    async (kind) => {
      const evidence = await loadExtractionEvidence(await mocks.context(), brandId);
      const value = {
        suggestions: [
          {
            field: 'description',
            value: content,
            citations: [
              {
                document_id: kind === 'foreign' ? sourceId : documentId,
                quote: kind === 'fabricated' ? 'An unsupported product guarantee.' : content,
              },
            ],
          },
        ],
      };
      const provider = {
        mode: 'openai',
        generateStructured: async () => ({ value, provider: 'openai' }),
      } as unknown as AIProvider;
      await expect(generateProductExtraction(evidence, provider)).rejects.toMatchObject({
        code: 'EXTRACTION_INVALID',
      });
    },
  );
  it('refuses stale evidence at apply time and again before saving the brand', async () => {
    const preview = await extractProduct(request(), brandId);
    if (!('checksum' in preview)) throw new Error('Expected preview');
    rows = [];
    await expect(
      extractProduct(request({ operation: 'validate', checksum: preview.checksum }), brandId),
    ).rejects.toMatchObject({ code: 'EXTRACTION_STALE' });
    await expect(
      updateBrand(
        request({ profile: demoBrand, extraction: { checksum: preview.checksum } }),
        brandId,
      ),
    ).rejects.toMatchObject({ code: 'EXTRACTION_STALE' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects evidence changes during generation', async () => {
    const evidence = await loadExtractionEvidence(await mocks.context(), brandId);
    rows = [];
    await expect(
      assertExtractionCurrent(await mocks.context(), brandId, evidence.checksum),
    ).rejects.toMatchObject({ code: 'EXTRACTION_STALE' });
  });
  it('explicitly bounds documents and source text without calling it a full analysis', async () => {
    const document = rows[0];
    rows = Array.from({ length: 9 }, () => ({
      ...(document as Record<string, unknown>),
      content: content.repeat(80),
    }));
    const result = await loadExtractionEvidence(await mocks.context(), brandId);
    expect(result.documents).toHaveLength(8);
    expect(result.limited).toBe(true);
    expect(result.documents.every((item) => item.content.length === 4000)).toBe(true);
  });
});
