import { safeRequestId } from '@threadsignal/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const requestId = safeRequestId(request.headers.get('x-request-id') ?? undefined);
  return Response.json(
    { status: 'ok', service: 'threadsignal-web', requestId },
    { headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId } },
  );
}
