// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { phase4Ids } from './phase4-fixture';
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  context: vi.fn(),
  database: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/phase4/server', () => ({ localDraftsEnabled: mocks.enabled }));
vi.mock('@/lib/phase4/api', () => ({
  draftContext: mocks.context,
  DraftError: class extends Error {},
}));
vi.mock('@/lib/phase5/database', () => ({ extensionDatabase: mocks.database }));
vi.mock('@/lib/phase5/rate-limit', () => ({
  enforceExtensionRateLimit: vi.fn().mockResolvedValue(undefined),
}));
import {
  extensionRoute,
  extensionOptions,
  exchangeConnection,
  currentConversation,
  extensionDraftAction,
  markDraftPublished,
  createConnection,
  hashExtensionSecret,
} from '../src/lib/phase5/api';
import { extensionId, extensionOrigin } from '../src/lib/phase5/policy';
const token = `tse_${'x'.repeat(43)}`;
function request(
  body?: unknown,
  headers: Record<string, string> = {},
  url = '/api/extension/exchange',
) {
  return new Request(`http://127.0.0.1:3000${url}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Host: '127.0.0.1:3000',
      'X-ThreadSignal-Extension': extensionId,
      Origin: extensionOrigin,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.context.mockResolvedValue({
    organization: { id: phase4Ids.organization, role: 'member' },
    supabase: { rpc: mocks.rpc },
  });
});
describe('extension API boundary', () => {
  it('ignores a forged correlation ID while preserving authorized error CORS', async () => {
    const req = request(
      { code: 'invalid' },
      { 'X-Request-ID': '10000000-0000-4000-8000-000000000001' },
    );
    const response = await extensionRoute(req, () => exchangeConnection(req), true);
    expect(response.status).toBe(400);
    expect(response.headers.get('access-control-allow-origin')).toBe(extensionOrigin);
    expect(response.headers.get('vary')).toBe('Origin');
    expect(response.headers.get('x-request-id')).not.toBe(req.headers.get('x-request-id'));
    expect(await response.json()).toMatchObject({
      error: {
        code: 'INVALID_INPUT',
        details: {},
        requestId: response.headers.get('x-request-id'),
      },
    });
  });
  it('accepts Next loopback normalization only with the exact incoming API Host', async () => {
    const req = new NextRequest(request({ code: 'deliberately-invalid-test-input' }));
    expect(new URL(req.url).origin).toBe('http://localhost:3000');
    expect((await extensionRoute(req, () => exchangeConnection(req), true)).status).toBe(400);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it.each(['localhost:3000', '127.0.0.2:3000', '127.0.0.1:3002', 'outside.example', ''])(
    'rejects another incoming Host even if Next normalizes the URL: %s',
    async (host) => {
      const req = new NextRequest(request({}, { Host: host }));
      expect((await extensionRoute(req, () => exchangeConnection(req), true)).status).toBe(403);
      expect(mocks.database).not.toHaveBeenCalled();
    },
  );
  it('fails closed before credentials or database access in hosted mode', async () => {
    mocks.enabled.mockReturnValue(false);
    const req = request({ code: `tsc_${'x'.repeat(43)}` });
    expect((await extensionRoute(req, () => exchangeConnection(req), true)).status).toBe(503);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it.each([
    { Origin: 'https://outside.example' },
    { 'X-ThreadSignal-Extension': 'a'.repeat(32) },
    { Cookie: 'session=browsercookie' },
  ])('rejects untrusted origins/IDs/browser cookies', async (headers) => {
    const req = request({}, headers);
    expect((await extensionRoute(req, () => exchangeConnection(req), true)).status).toBe(403);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('allows only exact extension preflights and never credentialed CORS', () => {
    const accepted = extensionOptions(
      request(undefined, {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type, x-threadsignal-extension',
      }),
    );
    expect(accepted.status).toBe(204);
    expect(accepted.headers.get('Access-Control-Allow-Origin')).toBe(extensionOrigin);
    expect(accepted.headers.has('Access-Control-Allow-Credentials')).toBe(false);
    expect(
      extensionOptions(
        request(undefined, { Origin: 'null', 'Access-Control-Request-Method': 'POST' }),
      ).status,
    ).toBe(403);
  });
  it('creates high entropy codes and stores only hashes', async () => {
    mocks.rpc.mockResolvedValue({
      data: { id: phase4Ids.draft, expires_at: '2026-09-17T10:00:00Z' },
      error: null,
    });
    const result = await createConnection(request({ name: 'My browser' }));
    expect(result.code).toMatch(/^tsc_[A-Za-z0-9_-]{43}$/);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'create_extension_connection_code',
      expect.objectContaining({ p_code_hash: hashExtensionSecret(result.code) }),
    );
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(result.code);
  });
  it('exchanges once via hashed code/token and validates the safe response', async () => {
    mocks.database.mockResolvedValue({
      session_id: phase4Ids.draft,
      organization_id: phase4Ids.organization,
      organization_name: 'Fixture',
      name: 'Browser',
      expires_at: '2026-10-17T10:00:00Z',
    });
    const code = `tsc_${'a'.repeat(43)}`;
    const result = await exchangeConnection(request({ code }));
    expect(result.token).toMatch(/^tse_[A-Za-z0-9_-]{43}$/);
    expect(mocks.database).toHaveBeenCalledWith('exchange', [
      hashExtensionSecret(code),
      hashExtensionSecret(result.token),
      extensionOrigin,
    ]);
  });
  it('requires a bearer token for current conversation and rejects arbitrary URLs', async () => {
    for (const headers of [{ Authorization: '' }, { Authorization: 'Bearer random' }]) {
      const req = request(
        undefined,
        headers,
        '/api/extension/current?redditUrl=https://www.reddit.com/r/saas/comments/abc/title',
      );
      expect((await extensionRoute(req, () => currentConversation(req), true)).status).toBe(401);
    }
    const req = request(
      undefined,
      {},
      '/api/extension/current?redditUrl=https://evil.test/r/saas/comments/abc/title',
    );
    expect((await extensionRoute(req, () => currentConversation(req), true)).status).toBe(400);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('binds handoff to current version and parsed discussion IDs', async () => {
    mocks.database.mockResolvedValue({ content: 'Verified reply', version: 3 });
    const req = request({
      expectedVersion: 3,
      redditUrl: 'https://old.reddit.com/r/SaaS/comments/abc123/title/',
    });
    const result = await extensionDraftAction(req, phase4Ids.draft, 'prepare');
    expect(result.version).toBe(3);
    expect(mocks.database).toHaveBeenCalledWith('prepare', [
      hashExtensionSecret(token),
      extensionOrigin,
      phase4Ids.draft,
      3,
      'abc123',
      'saas',
    ]);
  });
  it('rejects missing confirmation/post-only publication and oversized edits before SQL', async () => {
    for (const body of [
      { expectedVersion: 1, commentUrl: 'https://reddit.com/r/saas/comments/abc/thread/cmt/' },
      {
        expectedVersion: 1,
        commentUrl: 'https://reddit.com/r/saas/comments/abc/thread/',
        confirmed: true,
      },
    ]) {
      const req = request(body);
      expect(
        (
          await extensionRoute(
            req,
            () => extensionDraftAction(req, phase4Ids.draft, 'published'),
            true,
          )
        ).status,
      ).toBe(400);
    }
    const req = request({ expectedVersion: 1, content: 'a'.repeat(70000) });
    expect(
      (await extensionRoute(req, () => extensionDraftAction(req, phase4Ids.draft, 'save'), true))
        .status,
    ).toBe(413);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('web publication uses authenticated org and canonical comment URL', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await markDraftPublished(
      request({
        expectedVersion: 2,
        commentUrl: 'https://old.reddit.com/r/SaaS/comments/abc/title/cmt/?context=3',
        confirmed: true,
      }),
      phase4Ids.draft,
    );
    expect(mocks.rpc).toHaveBeenCalledWith('mark_draft_published', {
      p_organization_id: phase4Ids.organization,
      p_draft_id: phase4Ids.draft,
      p_expected_version: 2,
      p_comment_url: 'https://www.reddit.com/r/saas/comments/abc/thread/cmt/',
    });
  });
  it('returns fixed errors without leaking raw database messages, URL or bearer', async () => {
    mocks.database.mockRejectedValue(new Error(`password=${token}`));
    const req = request({ expectedVersion: 1, content: 'Edited text' });
    const response = await extensionRoute(
      req,
      () => extensionDraftAction(req, phase4Ids.draft, 'save'),
      true,
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(token);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
});
