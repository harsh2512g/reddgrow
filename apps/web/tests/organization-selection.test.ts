import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  env: vi.fn(),
  headers: vi.fn(),
  setCookie: vi.fn(),
  workspace: vi.fn(),
  redirect: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/config', () => ({ getAuthConfiguration: mocks.config }));
vi.mock('@/lib/env/server', () => ({ getServerEnv: mocks.env }));
vi.mock('@/lib/auth/require-session', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/organizations/server', () => ({
  organizationCookie: 'threadsignal_organization',
  loadWorkspace: mocks.workspace,
  requireOrganization: vi.fn(),
}));
vi.mock('next/headers', () => ({
  headers: mocks.headers,
  cookies: async () => ({ set: mocks.setCookie }),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, unstable_rethrow: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));

import { switchOrganizationAction } from '../src/app/app/actions';

describe('organization selection cookie boundary', () => {
  const organizationId = '20000000-0000-4000-8000-000000000001';
  const data = () => {
    const form = new FormData();
    form.set('organizationId', organizationId);
    return form;
  };
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.env.mockReturnValue({ NEXT_PUBLIC_APP_URL: 'http://localhost:3002' });
    mocks.headers.mockResolvedValue(new Headers({ origin: 'http://localhost:3002' }));
    mocks.config.mockReturnValue({ production: true, verifiedLocalHttp: true });
    mocks.workspace.mockResolvedValue({ organizations: [{ id: organizationId }] });
    mocks.redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
  });
  it('keeps the selection usable for verified personal development HTTP in production builds', async () => {
    await expect(switchOrganizationAction(data())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.setCookie).toHaveBeenCalledWith('threadsignal_organization', organizationId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
    });
    expect(mocks.redirect).toHaveBeenCalledWith('/app');
  });
  it('requires Secure cookies outside the verified HTTP exception', async () => {
    mocks.config.mockReturnValue({ production: true, verifiedLocalHttp: false });
    await expect(switchOrganizationAction(data())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.setCookie).toHaveBeenCalledWith(
      'threadsignal_organization',
      organizationId,
      expect.objectContaining({ secure: true }),
    );
  });
  it('never writes a selection cookie when membership or origin is invalid', async () => {
    mocks.workspace.mockResolvedValue({ organizations: [] });
    expect(await switchOrganizationAction(data())).toMatchObject({ status: 'error' });
    expect(mocks.setCookie).not.toHaveBeenCalled();
    mocks.workspace.mockResolvedValue({ organizations: [{ id: organizationId }] });
    mocks.headers.mockResolvedValue(new Headers({ origin: 'http://127.0.0.1:3000' }));
    expect(await switchOrganizationAction(data())).toMatchObject({ status: 'error' });
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
  it('fails closed when the auth configuration cannot verify its HTTP exception', async () => {
    mocks.config.mockImplementation(() => {
      throw new Error('Unavailable profile');
    });
    expect(await switchOrganizationAction(data())).toMatchObject({ status: 'error' });
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
