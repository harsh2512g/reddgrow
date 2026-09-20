// @vitest-environment node
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  rpc: vi.fn(),
  auth: vi.fn(),
  download: vi.fn(),
  rate: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn(), notFound: vi.fn() }));
vi.mock('@/lib/phase3/server', () => ({ localOpportunitiesEnabled: mocks.enabled }));
vi.mock('@/lib/auth/require-session', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: mocks.auth },
    rpc: mocks.rpc,
    storage: { from: () => ({ download: mocks.download }) },
  }),
}));
vi.mock('@/lib/phase6/rate-limit', () => ({ enforceAttributionLimit: mocks.rate }));
vi.mock('@/lib/env/server', () => ({
  getServerEnv: () => ({
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
    REDDIT_PROVIDER: 'mock',
    AI_PROVIDER: 'mock',
    CRAWLER_PROVIDER: 'fixture',
    EMAIL_PROVIDER: 'console',
    BILLING_PROVIDER: 'mock',
  }),
}));
import { operationsRoute } from '../src/lib/phase8/http';
import {
  adminJobs,
  adminRetry,
  adminStatus,
  adminProviders,
  organizationActivity,
} from '../src/lib/phase8/admin';
import {
  privacyCreate,
  privacyDownload,
  privacyRequests,
  privacyRevoke,
} from '../src/lib/phase8/privacy';
import { OperationsError } from '../src/lib/phase8/errors';

const org = '80000000-0000-4000-8000-000000000001';
const user = '80000000-0000-4000-8000-000000000002';
const id = '80000000-0000-4000-8000-000000000003';
const date = '2026-09-19T12:00:00Z';
function request(body?: unknown, extra: Record<string, string> = {}, path = '/api/internal/jobs') {
  return new Request(
    `http://127.0.0.1:3000${path}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://127.0.0.1:3000',
            'x-threadsignal-organization': org,
            ...extra,
          },
          body: JSON.stringify(body),
        },
  );
}
const receipt = {
  id,
  kind: 'export',
  status: 'requested',
  created_at: date,
  confirmed_at: date,
  completed_at: null,
  expires_at: null,
  error_code: null,
  download_available: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.rate.mockResolvedValue(undefined);
  mocks.auth.mockResolvedValue({
    data: {
      user: {
        id: user,
        email: 'operator@example.test',
        email_confirmed_at: date,
        is_anonymous: false,
      },
    },
    error: null,
  });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === 'platform_admin_session' ? true : { items: [], next_cursor: null },
    error: null,
  }));
});

describe('Phase 8 operation authority and bounded inputs', () => {
  it('fails closed outside the verified local profile before Supabase access', async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await operationsRoute(() => adminJobs(request()))).status).toBe(503);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects anonymous sessions with JSON 401 rather than a login redirect', async () => {
    mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
    const result = await operationsRoute(() => adminJobs(request()));
    expect(result.status).toBe(401);
    expect(result.headers.get('location')).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not treat an organization owner as a platform administrator', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect((await operationsRoute(() => adminJobs(request()))).status).toBe(403);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('platform_admin_session');
  });
  it('requires trusted origin before mutation authentication and SQL', async () => {
    const response = await operationsRoute(() =>
      adminStatus(
        request(
          { paused: true, reason: 'maintenance', requestId: id },
          { Origin: 'https://untrusted.example' },
        ),
        org,
      ),
    );
    expect(response.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
  it('refuses operations when the rate-limit store is unavailable', async () => {
    mocks.rate.mockRejectedValue(new OperationsError('UNAVAILABLE', 503));
    expect((await operationsRoute(() => adminJobs(request()))).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    '?limit=1000',
    '?limit=0',
    '?family=arbitrary',
    '?status=anything',
    '?before=2026-09-19T12:00:00Z',
    '?limit=10&limit=20',
    '?unknown=1',
  ])('rejects invalid or ambiguous pagination %s', async (query) => {
    const response = await operationsRoute(() =>
      adminJobs(request(undefined, {}, `/api/internal/jobs${query}`)),
    );
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalledWith('platform_admin_jobs', expect.anything());
  });
  it('validates the full paired pagination cursor and filters', async () => {
    const query = new URLSearchParams({
      family: 'knowledge',
      status: 'failed',
      before: date,
      beforeId: id,
      organizationId: org,
      limit: '10',
    });
    expect(
      (
        await operationsRoute(() =>
          adminJobs(request(undefined, {}, `/api/internal/jobs?${query}`)),
        )
      ).status,
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('platform_admin_jobs', {
      p_family: 'knowledge',
      p_status: 'failed',
      p_before: date,
      p_before_id: id,
      p_organization_id: org,
      p_limit: 10,
    });
  });
  it.each([
    { family: 'draft', reason: 'customer secret in a freeform note', requestId: id },
    { family: 'draft', reason: 'recovered', requestId: id, userId: user },
    { family: 'arbitrary', reason: 'recovered', requestId: id },
  ])('rejects uncontrolled retry notes, identity and job families', async (body) => {
    expect((await operationsRoute(() => adminRetry(request(body), id))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalledWith('platform_admin_retry_job', expect.anything());
  });
  it('sends only validated retry identity and an enumerated reason to Supabase', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === 'platform_admin_session' ? true : { job_id: id, replayed: true },
      error: null,
    }));
    expect(
      (
        await operationsRoute(() =>
          adminRetry(request({ family: 'privacy', reason: 'recovered', requestId: org }), id),
        )
      ).status,
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('platform_admin_retry_job', {
      p_family: 'privacy',
      p_job_id: id,
      p_reason: 'recovered',
      p_request_id: org,
    });
  });
  it.each([
    ['BRAND_ARCHIVED', 409],
    ['PAGE_LIMIT', 409],
    ['POST_DELETED', 409],
    ['OPPORTUNITY_BLOCKED', 409],
    ['OPPORTUNITY_UNAVAILABLE', 409],
    ['POST_STALE', 409],
    ['SUBREDDIT_PAUSED', 409],
    ['SOURCE_NOT_FOUND', 404],
    ['PLAN_UNAVAILABLE', 409],
    ['JOB_CONTEXT_CHANGED', 409],
    ['JOB_ALREADY_RETRIED', 409],
    ['NOTIFICATION_RETRY_WINDOW_EXPIRED', 409],
    ['JOB_NOT_FOUND', 404],
    ['ORGANIZATION_NOT_FOUND', 404],
    ['TRIAL_EXPIRED', 409],
    ['EXPORT_RATE_LIMIT', 429],
  ])('maps lifecycle failure %s without reporting a server crash', async (message, status) => {
    const response = await operationsRoute(async () => {
      throw { message };
    });
    expect(response.status).toBe(status);
  });
  it('returns a correlated safe error without database or customer contents', async () => {
    const response = await operationsRoute(async () => {
      throw new Error('customer secret fixture');
    });
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('customer secret');
    expect(body.error.requestId).toBe(response.headers.get('x-request-id'));
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('minimizes configured provider responses and makes no health claim', async () => {
    const response = await operationsRoute(() => adminProviders(request()));
    const data = (await response.json()).data;
    expect(data).toHaveLength(5);
    expect(data.every((item: { external_enabled: boolean }) => !item.external_enabled)).toBe(true);
    expect(Object.keys(data[0])).toEqual(['name', 'adapter', 'external_enabled']);
  });
  it('passes activity tenant through authenticated RLS without requiring platform access', async () => {
    expect(
      (
        await operationsRoute(() =>
          organizationActivity(request(undefined, {}, `/api/activity?organizationId=${org}`)),
        )
      ).status,
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_organization_activity', {
      p_organization_id: org,
      p_limit: 25,
    });
  });
});

describe('Phase 8 private exports and confirmed deletion', () => {
  it('accepts real SQL requested/delete/canceled receipts', async () => {
    mocks.rpc.mockResolvedValue({
      data: [receipt, { ...receipt, id: user, kind: 'delete', status: 'canceled' }],
      error: null,
    });
    expect(
      (
        await operationsRoute(() =>
          privacyRequests(request(undefined, {}, `/api/privacy/requests?organizationId=${org}`)),
        )
      ).status,
    ).toBe(200);
  });
  it('rejects stale workspace mutations before creating an export', async () => {
    expect(
      (
        await operationsRoute(() =>
          privacyCreate(
            request({ kind: 'export', organizationId: org }, { 'x-threadsignal-organization': id }),
          ),
        )
      ).status,
    ).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires explicit deletion confirmation and never promotes legacy requests', async () => {
    expect(
      (
        await operationsRoute(() =>
          privacyCreate(request({ kind: 'deletion', organizationId: org })),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('forwards the exact user confirmation to the owner-authorized SQL function', async () => {
    mocks.rpc.mockResolvedValue({ data: id, error: null });
    expect(
      (
        await operationsRoute(() =>
          privacyCreate(
            request({ kind: 'deletion', organizationId: org, confirmation: 'my-workspace' }),
          ),
        )
      ).status,
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('confirm_organization_deletion', {
      p_organization_id: org,
      p_confirmation: 'my-workspace',
    });
  });
  it('refuses export revocation against another workspace request', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(
      (await operationsRoute(() => privacyRevoke(request({ organizationId: org }), id))).status,
    ).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalledWith('revoke_organization_export', expect.anything());
  });
  it('bounds streamed JSON bodies', async () => {
    expect(
      (
        await operationsRoute(() =>
          privacyCreate(
            request({ kind: 'export', organizationId: org, padding: 'x'.repeat(5000) }),
          ),
        )
      ).status,
    ).toBe(413);
  });
  function artifact() {
    const bytes = new Uint8Array([31, 139, 8, 0]);
    const record = {
      id,
      path: `${org}/${id}/${user}.json.gz`,
      bucket: 'privacy-exports',
      expires_at: '2026-09-20T12:00:00Z',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    mocks.rpc.mockResolvedValue({ data: record, error: null });
    mocks.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
    return { bytes, record };
  }
  it('downloads only an authenticated integrity-checked artifact with attachment headers', async () => {
    const { bytes } = artifact();
    const response = await operationsRoute(() => privacyDownload(request(), id));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/gzip');
    expect(response.headers.get('content-disposition')).toContain('attachment;');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it('rejects malformed object paths before Storage access', async () => {
    const { record } = artifact();
    mocks.rpc.mockResolvedValue({ data: { ...record, path: '../../another/file' }, error: null });
    expect((await operationsRoute(() => privacyDownload(request(), id))).status).toBe(409);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it('rejects corrupted bytes and revocation during the object fetch', async () => {
    const { record } = artifact();
    mocks.download.mockResolvedValue({
      data: new Blob([new Uint8Array([1, 2, 3, 4])]),
      error: null,
    });
    expect((await operationsRoute(() => privacyDownload(request(), id))).status).toBe(409);
    artifact();
    mocks.rpc
      .mockResolvedValueOnce({ data: record, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    expect((await operationsRoute(() => privacyDownload(request(), id))).status).toBe(403);
  });
});
