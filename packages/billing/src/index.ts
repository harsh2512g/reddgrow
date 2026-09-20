import { BillingProviderError, type BillingProvider } from './contracts.js';
import { MockBillingProvider } from './mock.js';
import { StripeBillingProvider, type StripeBillingOptions } from './stripe.js';

export * from './contracts.js';
export * from './mock.js';
export * from './stripe.js';

export function createBillingProvider(
  mode: 'mock' | 'stripe' = 'mock',
  options?: StripeBillingOptions,
): BillingProvider {
  if (mode === 'mock') return new MockBillingProvider();
  if (!options) throw new BillingProviderError('BILLING_CONFIGURATION');
  return new StripeBillingProvider(options);
}
