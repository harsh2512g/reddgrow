if (process.env.THREADSIGNAL_LOCAL !== '1') {
  throw new Error(
    'Install through node scripts/run-local.mjs pnpm install to use isolated public npm configuration.',
  );
}
