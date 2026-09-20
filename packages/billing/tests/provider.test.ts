import { describe, expect, it } from 'vitest';
import { createBillingProvider } from '../src/index.js';

describe('billing connection foundation', () => {
  it('can prove local availability without enabling charges or creating trials', async () => {
    const provider = createBillingProvider();
    expect(await provider.checkConnection()).toEqual({
      provider: 'mock',
      available: true,
      paymentsEnabled: false,
    });
    expect(await provider.checkConnection()).toEqual(await provider.checkConnection());
    expect(provider.mode).toBe('mock');
  });

  it('requires explicit personal configuration for real billing selection', () => {
    expect(() => createBillingProvider('stripe')).toThrow('BILLING_CONFIGURATION');
  });
});
