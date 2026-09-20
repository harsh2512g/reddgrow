import type { ServerEnv } from './env.js';

export const LOCAL_PROVIDERS = Object.freeze({
  reddit: 'mock',
  ai: 'mock',
  email: 'console',
  billing: 'mock',
  crawler: 'fixture',
} as const);

export function getProviderModes(env: ServerEnv) {
  return {
    reddit: env.REDDIT_PROVIDER,
    ai: env.AI_PROVIDER,
    email: env.EMAIL_PROVIDER,
    billing: env.BILLING_PROVIDER,
    crawler: env.CRAWLER_PROVIDER,
  };
}

export function assertLocalProviders(env: ServerEnv): void {
  const modes = getProviderModes(env);
  if (
    Object.keys(LOCAL_PROVIDERS).some(
      (key) =>
        modes[key as keyof typeof modes] !== LOCAL_PROVIDERS[key as keyof typeof LOCAL_PROVIDERS],
    )
  ) {
    throw new Error(
      'Phase 0 requires mock Reddit/AI/billing, console email, and fixture crawling.',
    );
  }
}
