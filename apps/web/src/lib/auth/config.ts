import 'server-only';
import { getServerEnv } from '../env/server';
import { parseAuthConfiguration } from './config-policy';

/** Never infer service ownership from a localhost address alone. */
export function getAuthConfiguration() {
  return parseAuthConfiguration(getServerEnv(), {
    local: process.env.THREADSIGNAL_LOCAL === '1',
    servicesReady: process.env.THREADSIGNAL_SERVICES_READY === '1',
  });
}
