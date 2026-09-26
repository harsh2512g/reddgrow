export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getServerEnv } = await import('./lib/env/server');
    const env = getServerEnv();
    if (
      env.THREADSIGNAL_SUPABASE_MODE === 'deployment' &&
      process.env.NEXT_PHASE !== 'phase-production-build'
    ) {
      const [{ default: postgres }, { verifyDeploymentDatabaseAuthority }, { deploymentRuntime }] =
        await Promise.all([
          import('postgres'),
          import('@threadsignal/database'),
          import('./lib/env/runtime'),
        ]);
      const deployment = deploymentRuntime(env);
      if (!deployment) throw new Error('Deployment runtime is unavailable.');
      const sql = postgres({
        ...deployment.database,
        max: 1,
        connect_timeout: 5,
        idle_timeout: 1,
        onnotice: () => undefined,
      });
      try {
        await verifyDeploymentDatabaseAuthority(sql, 'web');
      } finally {
        await sql.end({ timeout: 1 });
      }
    }
  }
}
