// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ environment: vi.fn(), drafts: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/env/server', () => ({ getServerEnv: mocks.environment }));
vi.mock('@/lib/phase4/server', () => ({ localDraftsEnabled: mocks.drafts }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
import { localExtensionFixtureEnabled } from '../src/lib/phase5/fixture';
import FixturePage from '../src/app/extension-fixture/reddit/r/[subreddit]/comments/[postId]/fixture/page';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.drafts.mockReturnValue(true);
});
describe('local extension practice isolation', () => {
  it.each([
    ['1', 'local', true],
    ['0', 'local', false],
    ['', 'local', false],
    ['1', 'personal-development', false],
    ['1', 'deployment', false],
    ['0', 'deployment', false],
  ] as const)(
    'requires both local launch and local Supabase mode: %s/%s',
    async (local, mode, expected) => {
      vi.stubEnv('THREADSIGNAL_LOCAL', local);
      mocks.environment.mockReturnValue({ THREADSIGNAL_SUPABASE_MODE: mode });
      expect(localExtensionFixtureEnabled()).toBe(expected);
      const result = FixturePage({
        params: Promise.resolve({ subreddit: 'saas', postId: 'fixture_001' }),
      });
      if (expected) await expect(result).resolves.toBeTruthy();
      else await expect(result).rejects.toThrow('NEXT_NOT_FOUND');
    },
  );
  it('retains the service-readiness gate in local mode', () => {
    vi.stubEnv('THREADSIGNAL_LOCAL', '1');
    mocks.environment.mockReturnValue({ THREADSIGNAL_SUPABASE_MODE: 'local' });
    mocks.drafts.mockReturnValue(false);
    expect(localExtensionFixtureEnabled()).toBe(false);
  });
});
