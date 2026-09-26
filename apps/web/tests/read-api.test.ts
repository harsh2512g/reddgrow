// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoBrand } from '@threadsignal/knowledge';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  owned: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  gt: vi.fn(),
  single: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/knowledge/api', () => ({ apiContext: mocks.context, ownedBrand: mocks.owned }));
vi.mock('../src/lib/knowledge/server', () => ({
  brandColumns: 'id,organization_id,name,website_url,profile,status,created_at',
  sourceColumns: 'id,organization_id,brand_id,name',
}));
import { readBrands, readSources, readSource, archiveBrand } from '../src/lib/knowledge/read-api';
import { knowledgeErrorResponse } from '../src/lib/knowledge/http';
const organization = '10000000-0000-4000-8000-000000000001';
const brand = '20000000-0000-4000-8000-000000000001';
const second = '20000000-0000-4000-8000-000000000002';
const row = {
  id: brand,
  organization_id: organization,
  name: demoBrand.name,
  website_url: demoBrand.website_url,
  profile: demoBrand,
  status: 'active',
  created_at: '2026-09-20T00:00:00Z',
};
let result: { data: unknown; error: unknown };
beforeEach(() => {
  vi.clearAllMocks();
  result = { data: [row, { ...row, id: second }], error: null };
  const builder = {
    select: mocks.select,
    eq: mocks.eq,
    order: mocks.order,
    limit: mocks.limit,
    gt: mocks.gt,
    maybeSingle: mocks.single,
    then: (resolve: (value: typeof result) => void) => Promise.resolve(resolve(result)),
  };
  for (const mock of [mocks.from, mocks.select, mocks.eq, mocks.order, mocks.limit, mocks.gt])
    mock.mockReturnValue(builder);
  mocks.context.mockResolvedValue({
    organization: { id: organization, role: 'owner' },
    supabase: { from: mocks.from, rpc: mocks.rpc },
  });
  mocks.owned.mockResolvedValue(row);
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});
const request = (query = '') => new Request(`http://127.0.0.1:3000/api/brands${query}`);
describe('bounded tenant API reads', () => {
  it('pages brands using UUID cursor and never exposes the Supabase context', async () => {
    const response = await readBrands(request('?limit=1'));
    expect(response.brands).toHaveLength(1);
    expect(response.next_cursor).toBe(brand);
    expect(mocks.eq).toHaveBeenCalledWith('organization_id', organization);
    expect(mocks.limit).toHaveBeenCalledWith(2);
    expect(Object.keys(response)).toEqual(['brands', 'next_cursor']);
    await readBrands(request(`?after=${brand}`));
    expect(mocks.gt).toHaveBeenCalledWith('id', brand);
  });
  it.each(['?limit=0', '?limit=101', '?after=not-an-id', '?limit=NaN'])(
    'rejects invalid pagination %s',
    async (query) => {
      const response = await readBrands(request(query)).catch(knowledgeErrorResponse);
      expect(response).toBeInstanceOf(Response);
      if (!(response instanceof Response)) throw new Error('Expected an API error');
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: 'INVALID_INPUT', details: {} },
      });
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );
  it('rejects invalid source IDs and pagination before a database read', async () => {
    for (const [query, id] of [
      ['', 'not-an-id'],
      ['?limit=101', brand],
    ]) {
      await expect(readSource(request(query), id!)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        status: 400,
      });
    }
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('keeps malformed database output a private server failure', async () => {
    result.data = [{ id: 'private-invalid-database-data' }];
    const response = await readBrands(request()).catch(knowledgeErrorResponse);
    if (!(response instanceof Response)) throw new Error('Expected an API error');
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private-invalid-database-data');
  });
  it('validates ownership before source enumeration and detail', async () => {
    mocks.owned.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await expect(readSources(request(), second)).rejects.toThrow('NOT_FOUND');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(await readBrands(request(), brand)).toEqual({ brand: row });
  });
  it('preserves the authorization failure before touching data', async () => {
    mocks.context.mockRejectedValue(new Error('sign-in required'));
    await expect(readBrands(request())).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('archives through the existing authorized SQL operation with a fresh workspace binding', async () => {
    await expect(archiveBrand(request(), brand)).rejects.toMatchObject({
      code: 'WORKSPACE_CHANGED',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    const req = new Request(request(), {
      method: 'DELETE',
      headers: { 'x-threadsignal-organization': organization },
    });
    expect(await archiveBrand(req, brand)).toEqual({ id: brand });
    expect(mocks.context).toHaveBeenLastCalledWith(req, true);
    expect(mocks.rpc).toHaveBeenCalledWith('archive_brand', {
      p_brand_id: brand,
      p_archived: true,
    });
  });
});
