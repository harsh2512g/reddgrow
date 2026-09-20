import { describe, expect, it, vi } from 'vitest';
import { ExtensionApi, safeError } from '../src/background/api';

const parse = (value: unknown) => value;

describe('extension network boundary', () => {
  it('invokes native worker fetch without an invalid class receiver', async () => {
    const transport: typeof fetch = async function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Response.json({ ok: true });
    };
    await expect(
      new ExtensionApi(transport).request('/api/extension/current', parse),
    ).resolves.toEqual({ ok: true });
  });
  it('sends credentials only to the fixed local API with no cookies or redirects', async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    const api = new ExtensionApi(transport);
    await api.request('/api/extension/revoke', parse, {
      token: 'synthetic-token',
      method: 'POST',
      body: {},
    });
    expect(transport).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/extension/revoke',
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: expect.objectContaining({ Authorization: 'Bearer synthetic-token' }),
      }),
    );
  });

  it.each([
    'https://example.com/api/extension/current',
    '//example.com/api/extension/current',
    '/api/extension/../../secrets',
    '/api/extension/\\example.com',
  ])('rejects an unsupported target %s without fetching', async (target) => {
    const transport = vi.fn();
    await expect(new ExtensionApi(transport).request(target, parse)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('bounds response bodies and rejects invalid content types', async () => {
    for (const response of [
      new Response('x'.repeat(512_001), { headers: { 'content-type': 'application/json' } }),
      new Response('<html>'),
    ]) {
      const api = new ExtensionApi(vi.fn().mockResolvedValue(response));
      await expect(api.request('/api/extension/current', parse)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });

  it('never relays server text or unknown errors to the panel', async () => {
    const api = new ExtensionApi(
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { code: 'INTERNAL', message: 'private-value' } }, { status: 500 }),
        ),
    );
    const error: unknown = await api
      .request('/api/extension/current', parse)
      .catch((value: unknown) => value);
    expect(JSON.stringify(safeError(error))).not.toContain('private-value');
    expect(safeError(new Error('private-value')).code).toBe('UNAVAILABLE');
  });

  it.each([
    ['EXTENSION_CODE_INVALID', /create a new code.*integration settings/i],
    ['EXTENSION_SESSION_LIMIT', /disconnect one.*integration settings/i],
    ['EXTENSION_SESSION_NOT_FOUND', /connect the workspace again/i],
    ['EXTENSION_SESSION_INVALID', /connect the workspace again/i],
    ['EXTENSION_RATE_LIMIT', /wait a minute/i],
    ['INVALID_INPUT', /check the entered fields/i],
    ['WORKSPACE_CHANGED', /connect the intended workspace/i],
    ['DRAFT_NOT_FOUND', /look up the tab again/i],
    ['DRAFT_NOT_APPROVED', /review and approve/i],
    ['DRAFT_VERSION_CONFLICT', /look up this tab again/i],
    ['DRAFT_CONTEXT_CHANGED', /verify and approve/i],
    ['VERIFICATION_REQUIRED', /verify and approve/i],
    ['DRAFT_APPROVAL_BLOCKED', /fix them.*verify and approve/i],
    ['INVALID_COMMENT_URL', /comment permalink.*same reddit discussion/i],
    ['PUBLICATION_ALREADY_RECORDED', /review its existing comment link/i],
    ['POST_DELETED', /choose another opportunity/i],
    ['POST_STALE', /refresh community monitoring/i],
    ['OPPORTUNITY_BLOCKED', /choose another opportunity/i],
    ['OPPORTUNITY_UNAVAILABLE', /reopen this opportunity/i],
    ['SUBREDDIT_PAUSED', /resume community monitoring/i],
    ['BRAND_ARCHIVED', /restore the brand/i],
    ['ORGANIZATION_UNAVAILABLE', /check your workspace access/i],
    ['PLAN_INACTIVE', /active plan/i],
    ['PLAN_UNAVAILABLE', /check the plan/i],
    ['TRIAL_EXPIRED', /review the plan/i],
    ['LOCAL_ONLY', /start the local threadsignal app and worker/i],
    ['UNAVAILABLE', /check the local app and worker/i],
    ['FORBIDDEN', /workspace role/i],
  ] as const)(
    'explains a safe recovery action for the real service code %s',
    async (code, recovery) => {
      const api = new ExtensionApi(
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { error: { code, message: 'private upstream details' } },
              { status: 409 },
            ),
          ),
      );
      const error: unknown = await api
        .request('/api/extension/current', parse)
        .catch((value: unknown) => value);
      const safe = safeError(error);
      expect(safe.code).toBe(code);
      expect(safe.message).toMatch(recovery);
      expect(safe.message).not.toContain('private upstream details');
    },
  );

  it.each(['NEW_UNKNOWN_CODE', '__proto__', 'constructor', 'toString'])(
    'keeps unknown or inherited error code %s behind a fixed fallback',
    async (code) => {
      const api = new ExtensionApi(
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { error: { code, message: 'private upstream details' } },
              { status: 500 },
            ),
          ),
      );
      const error: unknown = await api
        .request('/api/extension/current', parse)
        .catch((value: unknown) => value);
      expect(safeError(error)).toEqual({
        code: 'REQUEST_FAILED',
        message: 'This action could not be completed. Check ThreadSignal and try again.',
      });
    },
  );

  it('distinguishes revoked credentials, rate limits and schema mismatches safely', async () => {
    for (const [status, code] of [
      [401, 'EXTENSION_UNAUTHORIZED'],
      [429, 'RATE_LIMITED'],
    ] as const) {
      await expect(
        new ExtensionApi(vi.fn().mockResolvedValue(new Response('', { status }))).request(
          '/api/extension/current',
          parse,
        ),
      ).rejects.toMatchObject({ code });
    }
    await expect(
      new ExtensionApi(vi.fn().mockResolvedValue(Response.json({}))).request(
        '/api/extension/current',
        () => {
          throw new Error('private-value');
        },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
