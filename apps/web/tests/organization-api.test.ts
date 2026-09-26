// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  membership: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/auth/server', () => ({ createServerSupabase: mocks.client }));
vi.mock('@/lib/env/server', () => ({
  getServerEnv: () => ({ NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000' }),
}));
import { GET, PATCH } from '../src/app/api/organizations/[id]/route';
const organization = '10000000-0000-4000-8000-000000000001';
const params = { params: Promise.resolve({ id: organization }) };
const request = (origin = 'http://127.0.0.1:3000') =>
  new Request(`http://127.0.0.1:3000/api/organizations/${organization}`, {
    method: 'PATCH',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
beforeEach(() => {
  vi.resetAllMocks();
  const builder = { select: () => builder, eq: () => builder, maybeSingle: mocks.membership };
  mocks.from.mockReturnValue(builder);
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        id: organization,
        email: 'member@example.com',
        email_confirmed_at: '2026-09-20T00:00:00Z',
      },
    },
    error: null,
  });
  mocks.membership.mockResolvedValue({ data: { role: 'viewer' }, error: null });
  mocks.client.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.rpc,
  });
});
async function denied(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({
    error: {
      code,
      message: expect.any(String),
      details: {},
      requestId: response.headers.get('x-request-id'),
    },
  });
  expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  expect(mocks.rpc).not.toHaveBeenCalled();
}
describe('organization error responses preserve authority', () => {
  it('rejects a foreign origin before authentication', async () => {
    await denied(await PATCH(request('https://outside.example'), params), 403, 'INVALID_ORIGIN');
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('requires a verified identity before membership access', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await denied(await GET(request(), params), 401, 'UNAUTHENTICATED');
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('keeps an inaccessible organization unavailable', async () => {
    mocks.membership.mockResolvedValue({ data: null, error: null });
    await denied(await GET(request(), params), 404, 'NOT_FOUND');
  });
  it('rejects viewers before parsing or executing a settings mutation', async () => {
    await denied(await PATCH(request(), params), 403, 'FORBIDDEN');
  });
});
