// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProvider, AIUsage } from '@threadsignal/ai';

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  environment: vi.fn(),
  limit: vi.fn(),
  plan: vi.fn(),
}));
vi.mock('../src/lib/provider-plan', () => ({ requireActiveProviderPlan: mocks.plan }));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/phase7/database', () => ({ billingDatabase: mocks.database }));
vi.mock('../src/lib/env/server', () => ({ getServerEnv: mocks.environment }));
vi.mock('../src/lib/mutation-rate-limit', () => ({ enforceMutationRateLimit: mocks.limit }));
import { captureWebAIUsage, withWebAIUsage } from '../src/lib/env/ai-usage';

const scope = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  brandId: '20000000-0000-4000-8000-000000000001',
  userId: '30000000-0000-4000-8000-000000000001',
};
const real: AIProvider = { mode: 'openai', embed: vi.fn(), generateStructured: vi.fn() };
const receipt: AIUsage = {
  task: 'embedding',
  model: 'fixture-model',
  input_tokens: 12,
  output_tokens: 3,
  estimated_cost_usd: null,
  latency_ms: 1,
};
function metadata(index = 0) {
  const call = mocks.database.mock.calls[index];
  expect(call?.[0]).toBe('recordAIUsage');
  expect(call?.[2]).toBe(scope.userId);
  expect(call?.[1].slice(0, 2)).toEqual([scope.organizationId, scope.brandId]);
  expect(call?.[1][2]).toMatch(/^[a-f0-9-]{36}$/);
  return JSON.parse(call?.[1][4]) as Record<string, unknown>;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.database.mockResolvedValue(undefined);
  mocks.limit.mockResolvedValue(undefined);
  mocks.plan.mockResolvedValue(undefined);
  mocks.environment.mockReturnValue({ THREADSIGNAL_SUPABASE_MODE: 'local' });
});
describe('web AI operation accounting', () => {
  it.each(['knowledge.search', 'keyword.suggest', 'subreddit.suggest', 'brand.extract'] as const)(
    'rejects an inactive plan before %s incurs provider usage',
    async (task) => {
      const operation = vi.fn();
      mocks.plan.mockRejectedValue(new Error('PLAN_INACTIVE'));
      await expect(withWebAIUsage(scope, task, real, operation)).rejects.toThrow('PLAN_INACTIVE');
      expect(mocks.plan).toHaveBeenCalledWith(scope.organizationId);
      expect(operation).not.toHaveBeenCalled();
      expect(mocks.database).not.toHaveBeenCalled();
    },
  );
  it('budgets read-side embedding work before spending provider capacity', async () => {
    const operation = vi.fn();
    mocks.limit.mockRejectedValue(new Error('RATE_LIMITED'));
    await expect(withWebAIUsage(scope, 'knowledge.search', real, operation)).rejects.toThrow(
      'RATE_LIMITED',
    );
    expect(mocks.limit).toHaveBeenCalledWith('knowledge', scope.organizationId);
    expect(operation).not.toHaveBeenCalled();
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('isolates overlapping request receipts and passes only the verified user scope', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withWebAIUsage(scope, 'brand.extract', real, async () => {
      captureWebAIUsage(receipt);
      await pending;
      captureWebAIUsage({ ...receipt, input_tokens: 5 });
      return 'first';
    });
    const second = withWebAIUsage(scope, 'keyword.suggest', real, async () => {
      captureWebAIUsage({ ...receipt, input_tokens: 100, estimated_cost_usd: 0.02 });
      return 'second';
    });
    expect(await second).toBe('second');
    release();
    expect(await first).toBe('first');
    expect(metadata(0)).toMatchObject({ input_tokens: 100, estimated_cost_usd: 0.02 });
    expect(metadata(1)).toMatchObject({
      input_tokens: 17,
      output_tokens: 6,
      estimated_cost_usd: null,
    });
    expect(mocks.database.mock.calls[0]?.[1][2]).not.toBe(mocks.database.mock.calls[1]?.[1][2]);
  });
  it('records incurred usage when validation fails, without persisting input or errors', async () => {
    await expect(
      withWebAIUsage(scope, 'brand.extract', real, async () => {
        captureWebAIUsage(receipt);
        throw new Error('private provider response');
      }),
    ).rejects.toThrow('private provider response');
    expect(metadata()).toEqual({
      provider: 'openai',
      model: 'fixture-model',
      input_tokens: 12,
      output_tokens: 3,
      estimated_cost_usd: null,
    });
    expect(JSON.stringify(mocks.database.mock.calls)).not.toContain('private provider response');
  });
  it('keeps absent real token and cost receipts unknown', async () => {
    await withWebAIUsage(scope, 'knowledge.search', real, async () => 'result');
    expect(metadata()).toEqual({
      provider: 'openai',
      model: 'unreported',
      input_tokens: null,
      output_tokens: null,
      estimated_cost_usd: null,
    });
  });
  it('records deterministic zero cost in mock mode', async () => {
    await withWebAIUsage(
      scope,
      'subreddit.suggest',
      { ...real, mode: 'mock' },
      async () => 'result',
    );
    expect(metadata()).toEqual({
      provider: 'mock',
      model: 'deterministic',
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
    });
  });
  it('does not report partial retry usage as the complete operation total', async () => {
    await withWebAIUsage(scope, 'brand.extract', real, async () => {
      captureWebAIUsage(receipt);
      captureWebAIUsage({ ...receipt, input_tokens: null, output_tokens: null });
    });
    expect(metadata()).toMatchObject({
      input_tokens: null,
      output_tokens: null,
      estimated_cost_usd: null,
    });
  });
  it('fails closed when the authorized accounting bridge fails', async () => {
    mocks.database.mockRejectedValue(new Error('accounting unavailable'));
    await expect(
      withWebAIUsage(scope, 'knowledge.search', real, async () => 'result'),
    ).rejects.toThrow('accounting unavailable');
  });
  it('preserves the explicitly frozen Phase 2 development profile', async () => {
    mocks.environment.mockReturnValue({ THREADSIGNAL_SUPABASE_MODE: 'personal-development' });
    expect(
      await withWebAIUsage(
        scope,
        'knowledge.search',
        { ...real, mode: 'mock' },
        async () => 'result',
      ),
    ).toBe('result');
    expect(mocks.database).not.toHaveBeenCalled();
  });
});
