import 'server-only';
import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { createLogger, createObservability } from '@threadsignal/shared';
import { createServerSupabase } from '../auth/server';
import { verifiedUser } from '../auth/session';
import { hasTrustedOrigin } from '../auth/policy';
import { getServerEnv } from '../env/server';
import { boundedBody } from '../knowledge/http';
import { localOpportunitiesEnabled } from '../phase3/server';
import { enforceAttributionLimit } from '../phase6/rate-limit';
import { OperationsError, operationFailure } from './errors';

const observability = createObservability({});
const logger = createLogger({ service: 'web-operations' });

export async function operationsRoute(action: () => Promise<unknown>) {
  const requestId = crypto.randomUUID();
  const headers = { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId };
  try {
    if (!localOpportunitiesEnabled()) throw new OperationsError('LOCAL_ONLY', 503);
    const result = await observability.run('web.operations', { requestId }, action);
    if (result instanceof Response) {
      for (const [name, value] of Object.entries(headers)) result.headers.set(name, value);
      return result;
    }
    return Response.json({ data: result }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    const failure = operationFailure(error, requestId);
    logger.warn(
      {
        event: 'operations_request_failed',
        requestId,
        code: failure.error.code,
        status: failure.status,
      },
      'Operations request did not complete.',
    );
    return Response.json({ error: failure.error }, { status: failure.status, headers });
  }
}

export async function operationsSession(request: Request, mutation = false) {
  if (!localOpportunitiesEnabled()) throw new OperationsError('LOCAL_ONLY', 503);
  if (mutation && !hasTrustedOrigin(request.headers, getServerEnv().NEXT_PUBLIC_APP_URL))
    throw new OperationsError('FORBIDDEN', 403);
  const supabase = await createServerSupabase();
  const user = verifiedUser(await supabase.auth.getUser());
  if (!user) throw new OperationsError('UNAUTHENTICATED', 401);
  await enforceAttributionLimit('management', `operations:${user.id}`);
  return { supabase, user };
}

export async function operationsJson<T>(request: Request, schema: z.ZodType<T>) {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
    throw new OperationsError('INVALID_INPUT');
  const bytes = await boundedBody(request, 4096);
  try {
    return schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    throw new OperationsError('INVALID_INPUT');
  }
}

/** Refuse ambiguous repeated query parameters rather than silently picking one. */
export function operationsQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys())
    if (params.getAll(key).length !== 1) throw new OperationsError('INVALID_INPUT');
  return Object.fromEntries(params);
}
