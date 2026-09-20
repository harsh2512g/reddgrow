import { describe, expect, it, vi } from 'vitest';
import { ExtensionApi } from '../src/background/api';
import { ExtensionController, type ExtensionPlatform } from '../src/background/controller';
import type { Credentials } from '../src/shared/messages';

const uuid = '00000000-0000-4000-8000-000000000001';
const url = 'http://127.0.0.1:3000/extension-fixture/reddit/r/SaaS/comments/fixture_001/fixture';
const credentials: Credentials = {
  token: `tse_${'a'.repeat(43)}`,
  session: {
    id: uuid,
    organizationId: uuid,
    organizationName: 'Synthetic workspace',
    name: 'Test extension',
    expiresAt: '2099-01-01T00:00:00Z',
  },
};
const current = {
  organization_id: uuid,
  organization_name: 'Synthetic workspace',
  opportunity: {
    id: uuid,
    brand_id: uuid,
    brand_name: 'Demo',
    title: 'Synthetic post',
    summary: 'An example',
    final_score: 95,
    risk_level: 'low',
    permalink: url,
    subreddit: 'SaaS',
    post_id: 'fixture_001',
  },
  draft: {
    id: uuid,
    version: 1,
    content: 'I work with the team.',
    strategy: 'Help first',
    approved_at: '2026-09-17T00:00:00Z',
    disclosure_included: true,
    compliance_status: 'pass',
    inserted_at: null,
    inserted_version: null,
    published_at: null,
    published_version: null,
    published_comment_url: null,
  },
  rules: [],
  claims: [],
  draft_unavailable_reason: null,
};
function setup(initial: Credentials | null = credentials) {
  let stored: unknown = initial;
  let tabUrl = url;
  const platform: ExtensionPlatform = {
    storage: {
      restrict: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(async () => stored),
      set: vi.fn(async (value) => {
        stored = value;
      }),
      clear: vi.fn(async () => {
        stored = null;
      }),
    },
    activeTab: vi.fn(async () => ({ id: 7, url: tabUrl })),
    tab: vi.fn(async () => ({ id: 7, url: tabUrl })),
    insert: vi.fn().mockResolvedValue({ ok: true, adapter: 'textarea' }),
  };
  const transport = vi.fn(async (input: string | URL | Request) => {
    const path = String(input);
    if (path.includes('/exchange')) return Response.json({ data: credentials });
    if (path.includes('/current')) return Response.json({ data: current });
    if (path.includes('/prepare'))
      return Response.json({ data: { content: current.draft.content, version: 1 } });
    if (path.includes('/disconnect')) return Response.json({ data: { revoked: true } });
    return Response.json({ data: { version: 2 } });
  });
  const controller = new ExtensionController(
    platform,
    new ExtensionApi(transport, 'ennpniajellhdhhblnbpoakkbhacfonk'),
  );
  return {
    controller,
    platform,
    transport,
    changeUrl: (value: string) => {
      tabUrl = value;
    },
    stored: () => stored,
  };
}
const target = { draftId: uuid, expectedVersion: 1 };

describe('extension credentials and explicit handoff', () => {
  it('restricts storage before reading and returns metadata without tokens', async () => {
    const { controller, platform } = setup();
    const response = await controller.dispatch({ type: 'status' });
    expect(platform.storage.restrict).toHaveBeenCalledOnce();
    expect(vi.mocked(platform.storage.restrict).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(platform.storage.get).mock.invocationCallOrder[0]!,
    );
    expect(JSON.stringify(response)).not.toContain(credentials.token);
    expect(response).toEqual({ ok: true, data: { session: credentials.session } });
  });

  it('exchanges a code and persists the token only in background storage', async () => {
    const { controller, platform, stored } = setup(null);
    const response = await controller.dispatch({ type: 'connect', code: `tsc_${'b'.repeat(43)}` });
    expect(platform.storage.set).toHaveBeenCalledExactlyOnceWith(credentials);
    expect(stored()).toEqual(credentials);
    expect(JSON.stringify(response)).not.toContain(credentials.token);
  });

  it('does not inspect tabs or fetch during idle status and rejects unsupported messages', async () => {
    const { controller, platform, transport } = setup();
    await controller.dispatch({ type: 'status' });
    expect(platform.activeTab).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(await controller.dispatch({ type: 'submit', ...target })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(
      await controller.dispatch({ type: 'insert', ...target, text: 'unapproved' }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('looks up one URL then reauthorizes immediately before insertion and records afterward', async () => {
    const { controller, platform, transport } = setup();
    await controller.dispatch({ type: 'lookup' });
    expect(await controller.dispatch({ type: 'insert', ...target })).toEqual({
      ok: true,
      data: { inserted: true, recorded: true },
    });
    expect(platform.insert).toHaveBeenCalledExactlyOnceWith(7, current.draft.content, url);
    const requests = transport.mock.calls.map(([input]) => String(input));
    expect(requests[1]).toContain('/prepare');
    expect(requests[2]).toContain('/inserted');
  });

  it('refuses tab navigation after lookup', async () => {
    const { controller, platform, changeUrl } = setup();
    await controller.dispatch({ type: 'lookup' });
    changeUrl('https://example.com/');
    expect(await controller.dispatch({ type: 'insert', ...target })).toMatchObject({
      ok: false,
      error: { code: 'PAGE_CHANGED' },
    });
    expect(platform.insert).not.toHaveBeenCalled();
  });

  it('refuses a page change during server approval recheck', async () => {
    const { controller, platform, transport, changeUrl } = setup();
    await controller.dispatch({ type: 'lookup' });
    transport.mockImplementationOnce(async () => {
      changeUrl('https://example.com/');
      return Response.json({ data: { content: current.draft.content, version: 1 } });
    });
    expect(await controller.dispatch({ type: 'copy', ...target })).toMatchObject({
      ok: false,
      error: { code: 'PAGE_CHANGED' },
    });
    expect(platform.insert).not.toHaveBeenCalled();
  });

  it('blocks stale approval and clears revoked credentials without insertion', async () => {
    const { controller, platform, transport, stored } = setup();
    await controller.dispatch({ type: 'lookup' });
    transport.mockImplementationOnce(async () => new Response('', { status: 401 }));
    expect(await controller.dispatch({ type: 'insert', ...target })).toMatchObject({
      ok: false,
      error: { code: 'EXTENSION_UNAUTHORIZED' },
    });
    expect(stored()).toBeNull();
    expect(platform.insert).not.toHaveBeenCalled();
  });

  it('requires refreshed approval after saving an edited version', async () => {
    const { controller, platform } = setup();
    await controller.dispatch({ type: 'lookup' });
    expect(
      await controller.dispatch({ type: 'save', ...target, content: 'A changed reply.' }),
    ).toEqual({ ok: true, data: { version: 2 } });
    expect(await controller.dispatch({ type: 'insert', ...target })).toMatchObject({
      ok: false,
      error: { code: 'REFRESH_REQUIRED' },
    });
    expect(platform.insert).not.toHaveBeenCalled();
  });

  it('offers copy fallback without recording an unsuccessful insertion', async () => {
    const { controller, platform, transport } = setup();
    await controller.dispatch({ type: 'lookup' });
    vi.mocked(platform.insert).mockResolvedValueOnce({ ok: false, reason: 'COMPOSER_NOT_EMPTY' });
    expect(await controller.dispatch({ type: 'insert', ...target })).toMatchObject({
      ok: false,
      error: { code: 'COMPOSER_NOT_EMPTY' },
    });
    expect(transport.mock.calls.some(([input]) => String(input).endsWith('/inserted'))).toBe(false);
    expect(await controller.dispatch({ type: 'copy', ...target })).toEqual({
      ok: true,
      data: { content: current.draft.content },
    });
  });

  it('reports insertion truthfully if recording fails, without trying to insert twice', async () => {
    const { controller, platform, transport } = setup();
    await controller.dispatch({ type: 'lookup' });
    transport.mockImplementationOnce(async () =>
      Response.json({ data: { content: current.draft.content, version: 1 } }),
    );
    transport.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    expect(await controller.dispatch({ type: 'insert', ...target })).toEqual({
      ok: true,
      data: { inserted: true, recorded: false },
    });
    expect(platform.insert).toHaveBeenCalledOnce();
  });

  it('clears local credentials even if remote revocation cannot be confirmed', async () => {
    const { controller, transport, stored } = setup();
    transport.mockRejectedValueOnce(new Error('offline'));
    expect(await controller.dispatch({ type: 'disconnect' })).toEqual({
      ok: true,
      data: { revoked: false, session: null },
    });
    expect(stored()).toBeNull();
  });

  it('rejects non-Reddit tabs without making a lookup request', async () => {
    const { controller, transport, changeUrl } = setup();
    changeUrl('http://127.0.0.1:3000/app/settings/organization');
    expect(await controller.dispatch({ type: 'lookup' })).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_PAGE' },
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation and a matching comment before recording manual publication', async () => {
    const { controller, platform } = setup();
    await controller.dispatch({ type: 'lookup' });
    expect(
      await controller.dispatch({
        type: 'published',
        ...target,
        commentUrl: 'https://www.reddit.com/r/SaaS/comments/different/slug/abc/',
        confirmed: true,
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_COMMENT' } });
    expect(
      await controller.dispatch({ type: 'published', ...target, commentUrl: url }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(platform.insert).not.toHaveBeenCalled();
  });
});
