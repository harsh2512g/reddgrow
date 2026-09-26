// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoBrand } from '@threadsignal/knowledge';
const mocks = vi.hoisted(() => ({
  organization: vi.fn(),
  rpc: vi.fn(),
  environment: vi.fn(),
  discover: vi.fn(),
  limit: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/organizations/server', () => ({ requireOrganization: mocks.organization }));
vi.mock('@/lib/env/server', () => ({ getServerEnv: mocks.environment }));
vi.mock('@/lib/env/runtime', () => ({ deploymentRuntime: () => ({ mode: 'deployment' }) }));
vi.mock('@/lib/knowledge/server', () => ({
  localKnowledgeEnabled: () => true,
  brandColumns: 'id',
  sourceColumns: 'id',
}));
vi.mock('@/lib/mutation-rate-limit', () => ({ enforceMutationRateLimit: mocks.limit }));
vi.mock('@threadsignal/crawler', () => ({
  discoverFixturePages: vi.fn(),
  SimpleCrawlerProvider: class {
    discoverPages = mocks.discover;
  },
}));
import { sourcePages, knowledgeRoute } from '../src/lib/knowledge/api';
const org = '10000000-0000-4000-8000-000000000001';
const brandId = '20000000-0000-4000-8000-000000000001';
let role = 'owner';
let status = 'active';
beforeEach(() => {
  vi.resetAllMocks();
  role = 'owner';
  status = 'active';
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({
      data: {
        id: brandId,
        organization_id: org,
        name: demoBrand.name,
        website_url: 'https://product.company.com',
        profile: demoBrand,
        status,
        created_at: '2026-09-26T00:00:00Z',
      },
      error: null,
    }),
  };
  mocks.organization.mockImplementation(async () => ({
    organization: { id: org, role },
    supabase: { from: () => query, rpc: mocks.rpc },
  }));
  mocks.environment.mockReturnValue({
    CRAWLER_PROVIDER: 'simple',
    MAX_SOLO_CRAWL_PAGES: 30,
    MAX_GROWTH_CRAWL_PAGES: 100,
  });
  mocks.discover.mockResolvedValue([{ url: 'https://product.company.com/', title: 'Product' }]);
});
const run = () =>
  knowledgeRoute(() =>
    sourcePages(new Request('https://app.company.com/api/brands/pages'), brandId),
  );
describe('approved company website preview', () => {
  it.each([
    ['trial', 30],
    ['solo', 30],
    ['growth', 100],
  ] as const)('uses the authorized %s page budget', async (plan_key, limit) => {
    mocks.rpc.mockResolvedValue({
      data: { organization_id: org, active: true, status: 'active', plan_key },
      error: null,
    });
    const result = await run();
    expect(result.status).toBe(200);
    expect(mocks.discover).toHaveBeenCalledWith(
      { url: 'https://product.company.com', approvedDomains: ['product.company.com'] },
      limit,
    );
    expect(mocks.rpc).toHaveBeenCalledWith('get_billing_subscription', { p_organization_id: org });
  });
  it.each(['member', 'viewer'])('refuses %s before any crawl', async (value) => {
    role = value;
    expect((await run()).status).toBe(403);
    expect(mocks.discover).not.toHaveBeenCalled();
  });
  it('refuses archived brands, inactive plans and unavailable authority before crawling', async () => {
    status = 'archived';
    expect((await run()).status).toBe(409);
    status = 'active';
    mocks.rpc.mockResolvedValue({
      data: { organization_id: org, active: false, status: 'expired', plan_key: 'trial' },
      error: null,
    });
    expect((await run()).status).toBe(409);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private' } });
    expect((await run()).status).toBe(503);
    expect(mocks.discover).not.toHaveBeenCalled();
  });
});
