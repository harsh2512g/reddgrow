// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ServerEnv } from '@threadsignal/config';
const state = vi.hoisted(() => ({ env: {} as Partial<ServerEnv> }));
const create = vi.hoisted(() => vi.fn(() => ({ mode: 'openai' })));
vi.mock('server-only', () => ({}));
vi.mock('@threadsignal/ai', () => ({ createAIProvider: create }));
vi.mock('../src/lib/env/server', () => ({ getServerEnv: () => state.env }));
vi.mock('../src/lib/env/runtime', () => ({ deploymentRuntime: () => ({ mode: 'deployment' }) }));
vi.mock('../src/lib/env/ai-usage', () => ({ captureWebAIUsage: vi.fn() }));
import { configuredAIProvider } from '../src/lib/env/providers';

describe('configured server AI prices', () => {
  it('passes operator rates to the adapter and refreshes its cached configuration when rates change', () => {
    state.env = {
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'synthetic-key',
      AI_FAST_MODEL: 'fast',
      AI_SMART_MODEL: 'smart',
      AI_EMBEDDING_MODEL: 'embedding',
      AI_MAX_RETRIES: 2,
      AI_MODEL_COSTS_JSON: { smart: { inputPerMillion: 2, outputPerMillion: 4 } },
    };
    configuredAIProvider();
    expect(create).toHaveBeenLastCalledWith(
      'openai',
      expect.objectContaining({ modelCosts: state.env.AI_MODEL_COSTS_JSON }),
    );
    configuredAIProvider();
    expect(create).toHaveBeenCalledTimes(1);
    state.env.AI_MODEL_COSTS_JSON = { smart: { inputPerMillion: 3, outputPerMillion: 5 } };
    configuredAIProvider();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenLastCalledWith(
      'openai',
      expect.objectContaining({ modelCosts: state.env.AI_MODEL_COSTS_JSON }),
    );
  });
});
