import { readBrandMonitoring } from '@/lib/phase3/read-api';
import { signalRoute, addKeyword } from '@/lib/phase3/api';
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => addKeyword(request, (await context.params).id));

export const GET = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => readBrandMonitoring(request, (await context.params).id, 'keywords'));
