import { createLogger, safeRequestId } from '@threadsignal/shared';
import { getServerEnv } from '@/lib/env/server';
import { checkDependencies } from '@/lib/health/dependencies';
import { readinessSchema } from '@/lib/health/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = safeRequestId(request.headers.get('x-request-id') ?? undefined);
  let checks: {
    database: 'ready' | 'unavailable' | 'unconfigured';
    redis: 'ready' | 'unavailable' | 'unconfigured';
  } = { database: 'unconfigured', redis: 'unconfigured' };
  try {
    if (process.env.THREADSIGNAL_SERVICES_READY === '1') {
      checks = await checkDependencies(getServerEnv());
    }
  } catch {
    // Return only safe operational state, never configuration values or exceptions.
    checks = { database: 'unavailable', redis: 'unavailable' };
  }
  const ready = checks.database === 'ready' && checks.redis === 'ready';
  createLogger({ service: 'web' }).info({ requestId, ready }, 'Readiness checked');
  const result = readinessSchema.parse({
    status: ready ? 'ready' : 'unavailable',
    checks,
    requestId,
  });
  return Response.json(result, {
    status: ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId },
  });
}
