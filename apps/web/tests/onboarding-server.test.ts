// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  knowledge: vi.fn(),
  pipeline: vi.fn(),
  billing: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/organizations/server', () => ({ loadWorkspace: mocks.workspace }));
vi.mock('@/lib/knowledge/server', () => ({ localKnowledgeEnabled: mocks.knowledge }));
vi.mock('@/lib/phase3/server', () => ({ localOpportunitiesEnabled: mocks.pipeline }));
vi.mock('@/lib/phase7/server', () => ({ billingEnabled: mocks.billing }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
import { loadOnboarding, loadWorkspaceChrome } from '../src/lib/onboarding/server';
const org = '10000000-0000-4000-8000-000000000001';
const brand = '20000000-0000-4000-8000-000000000001';
const source = '30000000-0000-4000-8000-000000000001';
type Result = { data: unknown; error: unknown; count: number | null };
const results: Record<string, Result> = {};
const filters: { table: string; field: string; value: unknown }[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  filters.length = 0;
  for (const key of Object.keys(results)) delete results[key];
  mocks.knowledge.mockReturnValue(true);
  mocks.pipeline.mockReturnValue(true);
  mocks.billing.mockReturnValue(false);
  mocks.workspace.mockResolvedValue({
    user: { id: 'user' },
    active: { id: org, role: 'owner' },
    organizations: [{ id: org, role: 'owner' }],
    supabase: { from: mocks.from, rpc: mocks.rpc },
  });
  mocks.rpc.mockResolvedValue({
    data: [
      {
        plan_key: 'trial',
        status: 'trialing',
        trial_ends_at: null,
        seat_limit: 1,
        seats_used: 1,
        seats_reserved: 0,
      },
    ],
    error: null,
  });
  results.brands = {
    data: [{ id: brand, name: 'Product', status: 'active' }],
    error: null,
    count: null,
  };
  results.knowledge_sources = {
    data: [{ id: source, status: 'ready', chunk_count: 2 }],
    error: null,
    count: null,
  };
  results.knowledge_documents = { data: [{ source_id: source }], error: null, count: null };
  for (const table of ['brand_subreddits', 'brand_keywords', 'opportunities'])
    results[table] = { data: null, error: null, count: 1 };
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      order: () => query,
      limit: () => query,
      eq: (field: string, value: unknown) => {
        filters.push({ table, field, value });
        return query;
      },
      is: () => query,
      not: () => query,
      gte: () => query,
      then: (resolve: (result: Result) => unknown) =>
        Promise.resolve(results[table] ?? { data: [], error: null, count: 0 }).then(resolve),
    };
    return query;
  });
});
describe('authorized setup reads', () => {
  it('uses only the verified active organization and its selected brand', async () => {
    const data = await loadOnboarding(brand);
    expect(data.state).toMatchObject({
      brandId: brand,
      knowledgeReady: 1,
      communities: 1,
      keywords: 1,
      opportunities: 1,
    });
    for (const table of [
      'brands',
      'knowledge_sources',
      'knowledge_documents',
      'brand_subreddits',
      'brand_keywords',
      'opportunities',
    ])
      expect(filters).toContainEqual({ table, field: 'organization_id', value: org });
    expect(filters).toContainEqual({
      table: 'brand_keywords',
      field: 'is_exclusion',
      value: false,
    });
  });
  it('rejects another tenant brand before querying its setup records', async () => {
    await expect(loadOnboarding('20000000-0000-4000-8000-000000000002')).rejects.toThrow(
      'NOT_FOUND',
    );
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it('never queries gated hosted business tables or billing usage', async () => {
    mocks.knowledge.mockReturnValue(false);
    mocks.pipeline.mockReturnValue(false);
    expect((await loadWorkspaceChrome()).brands).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_organization_plan', {
      p_organization_id: org,
    });
  });
  it('permits ready Phase 2 knowledge without reading later-phase hosted tables', async () => {
    mocks.pipeline.mockReturnValue(false);
    const data = await loadOnboarding(brand);
    expect(data.state).toMatchObject({
      knowledgeReady: 1,
      communities: 0,
      keywords: 0,
      opportunities: 0,
      pipelineEnabled: false,
    });
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual([
      'brands',
      'knowledge_sources',
      'knowledge_documents',
    ]);
  });
  it('does not count excluded evidence or failed jobs as a ready knowledge base', async () => {
    results.knowledge_documents = { data: [], error: null, count: null };
    expect((await loadOnboarding(brand)).state.knowledgeReady).toBe(0);
    results.knowledge_sources = {
      data: [{ id: source, status: 'failed', chunk_count: 2 }],
      error: null,
      count: null,
    };
    expect((await loadOnboarding(brand)).state).toMatchObject({
      knowledgeReady: 0,
      knowledgeFailed: 1,
    });
  });
  it('does not mask database failure as empty or completed progress', async () => {
    results.brand_keywords = { data: null, error: { message: 'private detail' }, count: null };
    await expect(loadOnboarding(brand)).rejects.toThrow(
      'Workspace setup could not be loaded. Please try again.',
    );
  });
});
