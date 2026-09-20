import { MockRedditProvider, type MockRedditOptions } from './mock.js';
import { OAuthRedditProvider, type OAuthRedditOptions } from './oauth.js';
import type { RedditProvider } from './types.js';
export * from './types.js';
export * from './mock.js';
export * from './oauth.js';
export * from './fixtures.js';
/** Explicit configuration only; never discover credentials from process.env. */
export function createRedditProvider(
  mode: 'mock' | 'oauth' = 'mock',
  options?: MockRedditOptions | OAuthRedditOptions,
): RedditProvider {
  if (mode === 'mock') return new MockRedditProvider(options as MockRedditOptions | undefined);
  if (mode === 'oauth') return new OAuthRedditProvider(options as OAuthRedditOptions);
  throw new Error('Invalid Reddit provider mode.');
}
