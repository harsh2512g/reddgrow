import 'server-only';
import { assertLocalProviders, parseServerEnv } from '@threadsignal/config';

export function getServerEnv() {
  const env = parseServerEnv(process.env);
  if (process.env.THREADSIGNAL_LOCAL === '1') assertLocalProviders(env);
  return env;
}
