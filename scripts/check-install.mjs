// Hosted builds must not impersonate the local runtime: that flag selects loopback
// services and mock-only configuration elsewhere in the application.
const vercelBuild =
  process.env.VERCEL === '1' &&
  process.env.CI === '1' &&
  ['preview', 'production'].includes(process.env.VERCEL_ENV);

if (process.env.VERCEL === '1' && process.env.THREADSIGNAL_LOCAL !== undefined) {
  throw new Error('Remove THREADSIGNAL_LOCAL from Vercel; it is reserved for the local launcher.');
}

if (process.env.THREADSIGNAL_LOCAL !== '1' && !vercelBuild) {
  throw new Error(
    'Use ./scripts/local pnpm install locally. Vercel builds must expose VERCEL=1, CI=1 and VERCEL_ENV=preview or production.',
  );
}

// The repository .npmrc selects public npm. Reject conflicting lifecycle overrides
// without printing registry URLs, which can contain authentication information.
for (const name of ['npm_config_registry', 'NPM_CONFIG_REGISTRY']) {
  const value = process.env[name];
  if (
    value !== undefined &&
    !['https://registry.npmjs.org/', 'https://registry.npmjs.org'].includes(value)
  )
    throw new Error('ThreadSignal installs require the public npm registry.');
}
