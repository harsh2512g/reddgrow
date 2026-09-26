// @vitest-environment node
import { KnowledgeError } from '../src/lib/knowledge/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoBrand } from '@threadsignal/knowledge';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@threadsignal/database';

const mocks = vi.hoisted(() => ({
  environment: vi.fn(),
  organization: vi.fn(),
  mutationLimit: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
  in: vi.fn(),
  rpc: vi.fn(),
  order: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/provider-plan', () => ({ requireActiveProviderPlan: vi.fn() }));
vi.mock('../src/lib/phase7/database', () => ({ billingDatabase: vi.fn() }));
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
import {
  signalRoute,
  addCommunity,
  editCommunity,
  addKeyword,
  editKeyword,
  changeOpportunity,
  bulkDismiss,
  findCommunities,
  keywordSuggestions,
  communitySuggestions,
  listOpportunities,
} from '../src/lib/phase3/api';
import {
  decodeFeedCursor,
  loadSignalWorkspace,
  localOpportunitiesEnabled,
} from '../src/lib/phase3/server';
import { feedFilterSchema } from '../src/lib/phase3/schema';

const organizationId = '20000000-0000-4000-8000-000000000001';
const otherOrganizationId = '20000000-0000-4000-8000-000000000002';
const brandId = '30000000-0000-4000-8000-000000000001';
const targetId = '40000000-0000-4000-8000-000000000001';
const otherId = '40000000-0000-4000-8000-000000000002';
const origin = 'http://127.0.0.1:3000';
const brand = {
  id: brandId,
  organization_id: organizationId,
  name: demoBrand.name,
  website_url: demoBrand.website_url,
  profile: demoBrand,
  status: 'active',
  created_at: '2026-09-16T00:00:00Z',
};
function request(body: unknown = {}, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/opportunities`, {
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
function role(value: string) {
  mocks.organization.mockResolvedValue({
    user: { id: '50000000-0000-4000-8000-000000000001' },
    organization: { id: organizationId, role: value },
    supabase: { from: mocks.from, rpc: mocks.rpc },
  });
}
async function response(action: () => Promise<unknown>, status: number, code?: string) {
  const result = await signalRoute(action);
  expect(result.status).toBe(status);
  expect(result.headers.get('cache-control')).toContain('no-store');
  const body: unknown = await result.json();
  if (code)
    expect(body).toMatchObject({
      error: { code, details: {}, requestId: result.headers.get('x-request-id') },
    });
  return body;
}
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.stubEnv('THREADSIGNAL_LOCAL', '1');
  vi.stubEnv('THREADSIGNAL_SERVICES_READY', '1');
  mocks.environment.mockReturnValue({
    THREADSIGNAL_SUPABASE_MODE: 'local',
    REDDIT_PROVIDER: 'mock',
    AI_PROVIDER: 'mock',
    NEXT_PUBLIC_APP_URL: origin,
  });
  const builder = {
    select: mocks.select,
    eq: mocks.eq,
    maybeSingle: mocks.single,
    in: mocks.in,
    order: mocks.order,
  };
  mocks.from.mockReturnValue(builder);
  mocks.select.mockReturnValue(builder);
  mocks.eq.mockReturnValue(builder);
  mocks.single.mockResolvedValue({ data: brand, error: null });
  mocks.in.mockResolvedValue({ data: [{ id: targetId }], error: null });
  mocks.order.mockResolvedValue({ data: [brand], error: null });
  mocks.rpc.mockResolvedValue({ data: targetId, error: null });
  role('owner');
});
describe('Phase 3 local gate and authorization', () => {
  it('refuses a rate-limited community mutation before provider/database work', async () => {
    mocks.mutationLimit.mockRejectedValueOnce(new KnowledgeError('RATE_LIMITED', 429));
    await response(() => addCommunity(request({ name: 'SaaS' }), brandId), 429, 'RATE_LIMITED');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.mutationLimit).toHaveBeenCalledWith('opportunities', organizationId);
  });
  it('keeps hosted Phase 3 disabled even with hosted Phase 2 worker readiness', async () => {
    mocks.environment.mockReturnValue({
      THREADSIGNAL_SUPABASE_MODE: 'personal-development',
      THREADSIGNAL_HOSTED_KNOWLEDGE_READY: '1',
      NEXT_PUBLIC_APP_URL: origin,
    });
    expect(localOpportunitiesEnabled()).toBe(false);
    for (const action of [
      () => addCommunity(request({ name: 'SaaS' }), brandId),
      () => addKeyword(request({ value: 'batch images' }), brandId),
      () => changeOpportunity(request(), targetId, 'rescore'),
      () => findCommunities(request()),
    ]) {
      await response(action, 503, 'LOCAL_ONLY');
    }
    expect(mocks.organization).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(await loadSignalWorkspace()).toMatchObject({ enabled: false, brands: [] });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('requires local services readiness', async () => {
    vi.stubEnv('THREADSIGNAL_SERVICES_READY', '0');
    await response(() => findCommunities(request()), 503, 'LOCAL_ONLY');
    expect(mocks.organization).not.toHaveBeenCalled();
  });
  it('rejects forged origins before accessing the organization', async () => {
    await response(
      () =>
        addCommunity(request({ name: 'SaaS' }, { origin: 'https://untrusted.example' }), brandId),
      403,
      'FORBIDDEN',
    );
    expect(mocks.organization).not.toHaveBeenCalled();
  });
  it('rejects stale workspace identifiers before table access', async () => {
    await response(
      () =>
        changeOpportunity(
          request({}, { 'x-threadsignal-organization': otherOrganizationId }),
          targetId,
          'rescore',
        ),
      409,
      'WORKSPACE_CHANGED',
    );
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['member', 'viewer'])('rejects monitoring and keyword writes for %s', async (value) => {
    role(value);
    for (const action of [
      () => addCommunity(request({ name: 'SaaS' }), brandId),
      () => editCommunity(request({ priority: 4 }), targetId, 'update'),
      () => addKeyword(request({ value: 'image API' }), brandId),
      () => editKeyword(request(), targetId, true),
      () => communitySuggestions(request(), brandId),
    ])
      await response(action, 403, 'FORBIDDEN');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('allows member research actions but prevents viewer mutations', async () => {
    role('member');
    mocks.single.mockResolvedValue({ data: { id: targetId, brand_id: brandId }, error: null });
    await response(() => changeOpportunity(request(), targetId, 'status', 'saved'), 200);
    expect(mocks.eq).toHaveBeenCalledWith('organization_id', organizationId);
    expect(mocks.rpc).toHaveBeenCalledWith('set_opportunity_status', {
      p_id: targetId,
      p_status: 'saved',
      p_reason: null,
    });
    mocks.rpc.mockClear();
    role('viewer');
    await response(() => changeOpportunity(request(), targetId, 'rescore'), 403, 'FORBIDDEN');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not operate on unavailable or foreign tenant rows', async () => {
    mocks.single.mockResolvedValue({ data: null, error: null });
    await response(() => changeOpportunity(request(), targetId, 'rescore'), 404, 'NOT_FOUND');
    expect(mocks.eq).toHaveBeenCalledWith('organization_id', organizationId);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
describe('Phase 3 validated mutations and safe failure states', () => {
  it('normalizes a community and permits the explicit long fixture name', async () => {
    await response(() => addCommunity(request({ name: 'r/SaaS' }), brandId), 200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'add_brand_subreddit',
      expect.objectContaining({ p_name: 'saas', p_brand_id: brandId }),
    );
    await response(() => addCommunity(request({ name: 'ArtificialIntelligence' }), brandId), 200);
  });
  it('rejects invalid community settings and unknown fixture names', async () => {
    await response(
      () => addCommunity(request({ name: 'SaaS', settings: { priority: 10 } }), brandId),
      400,
      'INVALID_INPUT',
    );
    await response(
      () => addCommunity(request({ name: 'unknownfixture' }), brandId),
      404,
      'COMMUNITY_UNAVAILABLE',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('pauses monitoring without resetting existing priority, notes, or sorts', async () => {
    mocks.single.mockResolvedValue({ data: { id: targetId, brand_id: brandId }, error: null });
    await response(() => editCommunity(request({ status: 'paused' }), targetId, 'update'), 200);
    expect(mocks.rpc).toHaveBeenCalledWith('update_brand_subreddit', {
      p_id: targetId,
      p_settings: { status: 'paused' },
    });
  });
  it('refreshes only rules through the bodyless rules alias', async () => {
    mocks.single.mockResolvedValue({ data: { id: targetId, brand_id: brandId }, error: null });
    await response(() => editCommunity(request(), targetId, 'refresh', 'rules'), 200);
    expect(mocks.rpc).toHaveBeenCalledWith('refresh_brand_subreddit', {
      p_id: targetId,
      p_kind: 'rules',
    });
  });
  it('rejects inconsistent exclusion terms and unbounded keyword input', async () => {
    await response(
      () =>
        addKeyword(
          request({ value: 'free credits', kind: 'exclusion', is_exclusion: false }),
          brandId,
        ),
      400,
      'INVALID_INPUT',
    );
    await response(
      () => addKeyword(request({ value: 'x'.repeat(201) }), brandId),
      400,
      'INVALID_INPUT',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns deterministic suggestions scoped to the selected brand', async () => {
    const body = await response(() => keywordSuggestions(request(), brandId), 200);
    expect(body).toMatchObject({
      data: {
        keywords: expect.arrayContaining([expect.objectContaining({ source: 'suggested' })]),
      },
    });
    expect(mocks.eq).toHaveBeenCalledWith('organization_id', organizationId);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires a dismissal reason and never accepts blocked as a user action', async () => {
    for (const body of [
      { status: 'dismissed' },
      { status: 'blocked' },
      { status: 'saved', reason: 'unrecognized' },
    ]) {
      await response(
        () => changeOpportunity(request(body), targetId, 'status'),
        400,
        'INVALID_INPUT',
      );
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('preserves database blocked and plan-limit results without exposing SQL details', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'OPPORTUNITY_BLOCKED' },
    });
    await response(
      () => changeOpportunity(request(), targetId, 'status', 'saved'),
      409,
      'OPPORTUNITY_BLOCKED',
    );
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'KEYWORD_LIMIT' } });
    await response(
      () => addKeyword(request({ value: 'image API' }), brandId),
      409,
      'KEYWORD_LIMIT',
    );
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'XX001', message: 'private database connection details' },
    });
    const body = await response(
      () => changeOpportunity(request(), targetId, 'rescore'),
      500,
      'PROCESSING_FAILED',
    );
    expect(JSON.stringify(body)).not.toContain('private database');
  });
  it('validates bulk input and rejects the whole action when one row is unavailable', async () => {
    for (const ids of [[], [targetId, targetId], Array.from({ length: 101 }, () => targetId)])
      await response(
        () => bulkDismiss(request({ ids, reason: 'not_relevant' })),
        400,
        'INVALID_INPUT',
      );
    await response(
      () => bulkDismiss(request({ ids: [targetId, otherId], reason: 'not_relevant' })),
      404,
      'NOT_FOUND',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    await response(() => bulkDismiss(request({ ids: [targetId], reason: 'not_relevant' })), 200);
    expect(mocks.rpc).toHaveBeenCalledWith('bulk_dismiss_opportunities', {
      p_ids: [targetId],
      p_reason: 'not_relevant',
    });
  });
});
describe('stable feed input', () => {
  it('serializes competitor containment as JSONB through the installed Supabase client', async () => {
    const requests: URL[] = [];
    // Exercise the real PostgREST query builder; intercept its transport so no service is contacted.
    const transport = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      if (url.pathname === '/rest/v1/brands') return Response.json([brand]);
      if (url.pathname === '/rest/v1/rpc/get_opportunity_usage')
        return Response.json({
          quantity: 0,
          limit: 20,
          plan_key: 'trial',
          period_start: '2026-09-18T00:00:00Z',
          period_end: '2026-10-18T00:00:00Z',
        });
      if (
        ['/rest/v1/opportunities', '/rest/v1/subreddits', '/rest/v1/brand_competitors'].includes(
          url.pathname,
        )
      )
        return Response.json([]);
      throw new Error('Unexpected query in the isolated transport regression.');
    });
    const client = createClient<Database>(
      'http://127.0.0.1:54321',
      'synthetic-test-publishable-key',
      {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: transport },
      },
    );
    mocks.organization.mockResolvedValue({
      organization: { id: organizationId, role: 'owner' },
      supabase: client,
    });
    await response(
      () =>
        listOpportunities(
          new Request(`${origin}/api/opportunities?brandId=${brandId}&competitorId=${targetId}`),
        ),
      200,
    );
    const query = requests.find((url) => url.pathname === '/rest/v1/opportunities');
    expect(query?.searchParams.get('matched_competitor_ids')).toBe(`cs.["${targetId}"]`);
    expect(query?.searchParams.get('organization_id')).toBe(`eq.${organizationId}`);
    expect(query?.searchParams.get('brand_id')).toBe(`eq.${brandId}`);
    expect(query?.searchParams.get('order')).toBe('final_score.desc,id.desc');
  });
  it('returns an input error for a malformed API cursor before reading feed rows', async () => {
    await response(
      () => listOpportunities(new Request(`${origin}/api/opportunities?cursor=invalid_json`)),
      400,
      'INVALID_INPUT',
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('validates stable numeric cursors, sort agreement and SQL-like hostile values', () => {
    const valid = { sort: 'score', value: 81.2, id: targetId };
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(decodeFeedCursor(encode(valid), 'score')).toEqual(valid);
    for (const cursor of [
      encode({ ...valid, sort: 'engagement' }),
      encode({ ...valid, value: '0),id.gt.0' }),
      encode({ ...valid, id: 'or(1=1)' }),
      'not_base64!!',
    ])
      expect(() => decodeFeedCursor(cursor, 'score')).toThrow('page cursor is invalid');
  });
  it('defaults hidden low-score discussions and validates score/date/tenant filters', () => {
    expect(feedFilterSchema.parse({ minimumScore: '' }).minimumScore).toBe(40);
    expect(feedFilterSchema.parse({ minimumScore: '0', status: 'blocked' }).minimumScore).toBe(0);
    for (const input of [
      { minimumScore: '-1' },
      { minimumScore: '101' },
      { from: '2026-09-18', to: '2026-09-17' },
      { brandId: 'foreign-id' },
      { competitorId: 'bad-id' },
    ])
      expect(feedFilterSchema.safeParse(input).success).toBe(false);
  });
});
