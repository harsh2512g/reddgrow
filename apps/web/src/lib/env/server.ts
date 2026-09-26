import 'server-only';
import { assertLocalProviders, parseServerEnv, parseDeploymentRuntime } from '@threadsignal/config';

export function getServerEnv() {
  const env = parseServerEnv(process.env);
  if (process.env.THREADSIGNAL_LOCAL === '1') assertLocalProviders(env);
  if (env.THREADSIGNAL_SUPABASE_MODE === 'deployment') parseDeploymentRuntime(env, 'web');
  return env;
}
