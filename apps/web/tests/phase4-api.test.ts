// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeError } from '../src/lib/knowledge/http';
import { phase4Ids } from './phase4-fixture';
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  organization: vi.fn(),
  mutationLimit: vi.fn(),
  environment: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/mutation-rate-limit', () => ({
  enforceMutationRateLimit: mocks.mutationLimit,
}));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/phase4/server', () => ({
  localDraftsEnabled: mocks.enabled,
  loadDraft: vi.fn(),
  loadDrafts: vi.fn(),
  loadPersona: vi.fn(),
}));
vi.mock('@/lib/organizations/server', () => ({ requireOrganization: mocks.organization }));
vi.mock('@/lib/env/server', () => ({ getServerEnv: mocks.environment }));
import { draftRoute, mutateDraft, createDraft, savePersona } from '../src/lib/phase4/api';
const origin = 'http://127.0.0.1:3000';
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/drafts/${phase4Ids.draft}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-ThreadSignal-Organization': phase4Ids.organization,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.environment.mockReturnValue({ NEXT_PUBLIC_APP_URL: origin });
  const query = { select: mocks.select, eq: mocks.eq, maybeSingle: mocks.single };
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.single.mockResolvedValue({ data: { id: phase4Ids.draft }, error: null });
  mocks.rpc.mockResolvedValue({ data: 2, error: null });
  mocks.organization.mockResolvedValue({
    organization: { id: phase4Ids.organization, role: 'member' },
    supabase: { from: mocks.from, rpc: mocks.rpc },
  });
});
describe('draft mutation boundaries', () => {
  it('refuses generation while request protection is unavailable, before database access', async () => {
    mocks.mutationLimit.mockRejectedValueOnce(new KnowledgeError('RATE_LIMIT_UNAVAILABLE', 503));
    const result = await draftRoute(() => createDraft(request({}), phase4Ids.opportunity));
    expect(result.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.mutationLimit).toHaveBeenCalledWith('drafts', phase4Ids.organization);
  });
  it('refuses hosted access before authentication or a database read', async () => {
    mocks.enabled.mockReturnValue(false);
    const response = await draftRoute(() =>
      mutateDraft(request({ expectedVersion: 1 }), phase4Ids.draft, 'verify'),
    );
    expect(response.status).toBe(503);
    expect(mocks.organization).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('refuses untrusted origins before resolving credentials', async () => {
    const response = await draftRoute(() =>
      mutateDraft(
        request({ expectedVersion: 1 }, { Origin: 'https://outside.example' }),
        phase4Ids.draft,
        'verify',
      ),
    );
    expect(response.status).toBe(403);
    expect(mocks.organization).not.toHaveBeenCalled();
  });
  it('binds mutations to the organization rendered in the browser', async () => {
    const response = await draftRoute(() =>
      mutateDraft(
        request({ expectedVersion: 1 }, { 'X-ThreadSignal-Organization': phase4Ids.brand }),
        phase4Ids.draft,
        'verify',
      ),
    );
    expect(response.status).toBe(409);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('rejects viewers and refuses persona changes from members', async () => {
    const persona = await draftRoute(() => savePersona(request({}), phase4Ids.brand));
    expect(persona.status).toBe(403);
    mocks.organization.mockResolvedValue({
      organization: { id: phase4Ids.organization, role: 'viewer' },
      supabase: { from: mocks.from, rpc: mocks.rpc },
    });
    const response = await draftRoute(() =>
      mutateDraft(request({ expectedVersion: 1 }), phase4Ids.draft, 'verify'),
    );
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('checks tenant ownership before requesting a draft', async () => {
    mocks.single.mockResolvedValue({ data: null, error: null });
    const response = await draftRoute(() =>
      createDraft(request({ idempotencyKey: phase4Ids.check, options: {} }), phase4Ids.opportunity),
    );
    expect(response.status).toBe(404);
    expect(mocks.eq).toHaveBeenCalledWith('organization_id', phase4Ids.organization);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires explicit version compare-and-swap and preserves submitted whitespace', async () => {
    const response = await draftRoute(() =>
      mutateDraft(
        request({ expectedVersion: 1, content: '  A careful reply.\n' }),
        phase4Ids.draft,
        'save',
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('save_draft_edit', {
      p_draft_id: phase4Ids.draft,
      p_expected_version: 1,
      p_content: '  A careful reply.\n',
    });
    expect(await response.json()).toEqual({ data: { version: 2 } });
  });
  it('rejects missing versions, blank content and oversized edits before RPC', async () => {
    for (const body of [
      { content: 'A reply' },
      { expectedVersion: 1, content: '  ' },
      { expectedVersion: 1, content: 'a'.repeat(12001) },
    ]) {
      const response = await draftRoute(() => mutateDraft(request(body), phase4Ids.draft, 'save'));
      expect(response.status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    'DRAFT_APPROVAL_BLOCKED',
    'DRAFT_CONTEXT_CHANGED',
    'VERIFICATION_REQUIRED',
    'WARNINGS_ACKNOWLEDGEMENT_REQUIRED',
  ])('does not override SQL approval rejection %s', async (message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    const response = await draftRoute(() =>
      mutateDraft(
        request({ expectedVersion: 1, acknowledgeWarnings: true, acceptResponsibleUse: true }),
        phase4Ids.draft,
        'approve',
      ),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).not.toContain('PROCESSING_FAILED');
  });
  it('preserves idempotency keys and disallows extra generation authority fields', async () => {
    mocks.rpc.mockResolvedValue({ data: phase4Ids.draft, error: null });
    const response = await draftRoute(() =>
      createDraft(
        request({ idempotencyKey: phase4Ids.check, options: { length: 'concise' } }),
        phase4Ids.opportunity,
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('request_draft', {
      p_opportunity_id: phase4Ids.opportunity,
      p_idempotency_key: phase4Ids.check,
      p_options: { length: 'concise' },
    });
    mocks.rpc.mockClear();
    const invalid = await draftRoute(() =>
      createDraft(
        request({ idempotencyKey: phase4Ids.check, options: { skip_verification: true } }),
        phase4Ids.opportunity,
      ),
    );
    expect(invalid.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns safe errors and request IDs without raw database messages', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'private database failure detail' },
    });
    const response = await draftRoute(() =>
      mutateDraft(request({ expectedVersion: 1 }), phase4Ids.draft, 'verify'),
    );
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain('private database');
    expect(response.headers.get('X-Request-ID')).toBeTruthy();
  });
});
