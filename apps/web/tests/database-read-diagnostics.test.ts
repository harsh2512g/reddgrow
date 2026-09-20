// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ warn: vi.fn(), user: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@threadsignal/shared', () => ({ createLogger: () => ({ warn: mocks.warn }) }));
vi.mock('react', () => ({ cache: <T extends (...args: never[]) => unknown>(action: T) => action }));
vi.mock('@/lib/auth/require-session', () => ({ requireUser: mocks.user }));
import {
  databaseReadDiagnostic,
  reportDatabaseReadFailure,
} from '../src/lib/database-read-diagnostics';
import { readResult } from '../src/lib/phase4/server';
import { loadWorkspace } from '../src/lib/organizations/server';

beforeEach(() => vi.clearAllMocks());
describe('safe database read diagnostics', () => {
  it('emits only fixed operations, recognized codes, bounded status and a timeout classification', () => {
    const error = {
      code: 'PGRST301',
      message: 'private-message',
      details: 'https://secret-host.example/private?token=secret-token',
      hint: 'private-hint',
      headers: { Cookie: 'private-cookie' },
      organization_id: 'private-id',
      content: 'private-content',
    };
    reportDatabaseReadFailure('drafts.review', error, 401);
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { operation: 'drafts.review', databaseCode: 'PGRST301', status: 401, timeout: null },
      'Database read failed',
    );
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toMatch(/private|secret|cookie|https/i);
  });
  it('rejects arbitrary codes and invalid statuses without logging the original error', () => {
    expect(
      databaseReadDiagnostic({ code: 'secret-token', message: 'private-content' }, 700),
    ).toEqual({
      databaseCode: null,
      status: null,
      timeout: null,
    });
    expect(databaseReadDiagnostic(null, Number.NaN)).toEqual({
      databaseCode: null,
      status: null,
      timeout: null,
    });
  });
  it('recognizes SDK timeout wrappers but does not misclassify generic aborts or SQL cancellations', () => {
    expect(
      databaseReadDiagnostic({ message: 'TimeoutError: private timeout context' }, 0).timeout,
    ).toBe(true);
    expect(
      databaseReadDiagnostic(new DOMException('private context', 'TimeoutError'), 0).timeout,
    ).toBe(true);
    expect(databaseReadDiagnostic({ name: 'AbortError', code: 'ABORT_ERR' }, 0).timeout).toBeNull();
    expect(
      databaseReadDiagnostic({ code: '57014', message: 'private SQL cancellation' }, 500),
    ).toEqual({ databaseCode: '57014', status: 500, timeout: null });
  });
  it('labels the actual Phase4 query failure and preserves the existing generic public error', () => {
    expect(() =>
      readResult(
        { data: null, error: { code: '42P01', message: 'private relation name' }, status: 404 },
        'drafts.claims',
      ),
    ).toThrow('Draft workspace data could not be loaded.');
    expect(mocks.warn).toHaveBeenCalledWith(
      { operation: 'drafts.claims', databaseCode: '42P01', status: 404, timeout: null },
      'Database read failed',
    );
    mocks.warn.mockClear();
    expect(readResult({ data: [], error: null, status: 200 }, 'drafts.list')).toEqual([]);
    expect(mocks.warn).not.toHaveBeenCalled();
  });
  it('labels membership lookup errors without exposing user identity or raw database details', async () => {
    const result = {
      data: null,
      error: { code: 'PGRST002', message: 'private schema details' },
      status: 503,
    };
    mocks.user.mockResolvedValue({
      user: { id: 'private-user' },
      supabase: { from: () => ({ select: () => ({ eq: async () => result }) }) },
    });
    await expect(loadWorkspace()).rejects.toThrow('Workspace membership could not be loaded.');
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      { operation: 'workspace.memberships', databaseCode: 'PGRST002', status: 503, timeout: null },
      'Database read failed',
    );
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('private');
  });
});
