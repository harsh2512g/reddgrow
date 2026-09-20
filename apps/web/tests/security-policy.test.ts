import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestSecurity } from '../src/lib/security-policy';
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('../src/lib/auth/proxy-session', () => ({ refreshSession: mocks.refresh }));
import { proxy } from '../src/proxy';

describe('per-request content security policy', () => {
  it('uses unique server-generated nonces and disallows inline scripts/eval in a production build', () => {
    const first = requestSecurity({ development: false, local: false });
    const second = requestSecurity({ development: false, local: false });
    expect(first.nonce).toMatch(/^[A-Za-z0-9+/]{32}$/);
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.requestId).not.toBe(first.requestId);
    expect(first.policy).toContain(`script-src 'self' 'nonce-${first.nonce}' 'strict-dynamic';`);
    expect(first.policy).not.toContain('unsafe-eval');
    expect(first.policy).toContain("frame-ancestors 'none'");
    expect(first.policy).toContain("base-uri 'none'");
    expect(first.policy).toContain("object-src 'none'");
    expect(first.policy).toContain('upgrade-insecure-requests');
  });
  it('permits only loopback development websocket origins and does not upgrade local HTTP', () => {
    const { policy } = requestSecurity({ development: true, local: true });
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' ws://127.0.0.1:3000 ws://localhost:3002;");
    expect(policy).not.toContain('upgrade-insecure-requests');
    expect(requestSecurity({ development: false, local: true }).policy).not.toContain('ws:');
  });
});

describe('security proxy integration', () => {
  beforeEach(() => {
    vi.stubEnv('THREADSIGNAL_LOCAL', '1');
    vi.stubEnv('NODE_ENV', 'production');
    mocks.refresh.mockReset();
    mocks.refresh.mockImplementation(async (request: NextRequest) => {
      const response = NextResponse.next({ request: { headers: request.headers } });
      response.cookies.set('session-fixture', 'fresh', { httpOnly: true });
      return response;
    });
  });
  it('replaces forged trust headers and passes the same nonce to Next and browser', async () => {
    const request = new NextRequest('http://127.0.0.1:3000/app', {
      headers: {
        'x-nonce': 'forged',
        'x-request-id': 'forged',
        'content-security-policy': 'forged',
      },
    });
    const response = await proxy(request);
    const nonce = request.headers.get('x-nonce');
    expect(nonce).not.toBe('forged');
    expect(response.headers.get('content-security-policy')).toContain(`'nonce-${nonce}'`);
    expect(request.headers.get('content-security-policy')).toBe(
      response.headers.get('content-security-policy'),
    );
    expect(response.headers.get('x-request-id')).toBe(request.headers.get('x-request-id'));
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.cookies.get('session-fixture')?.httpOnly).toBe(true);
  });
  it('does not introduce authentication redirects into public tracking, webhooks, or public pages', async () => {
    for (const path of ['/', '/api/billing/webhook', '/api/v1/conversions', '/go/fixture']) {
      const response = await proxy(new NextRequest(`http://127.0.0.1:3000${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('x-request-id')).toBeTruthy();
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('retains session refresh on internal administration routes', async () => {
    await proxy(new NextRequest('http://127.0.0.1:3000/internal/admin/jobs'));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
