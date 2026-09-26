import 'server-only';
import { getServerEnv } from '../env/server';
import { localDraftsEnabled } from '../phase4/server';

/** Practice composers remain local even when the deployment draft workflow is enabled. */
export function localExtensionFixtureEnabled(): boolean {
  return (
    process.env.THREADSIGNAL_LOCAL === '1' &&
    getServerEnv().THREADSIGNAL_SUPABASE_MODE === 'local' &&
    localDraftsEnabled()
  );
}
