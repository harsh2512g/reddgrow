import { readBrandMonitoring } from '@/lib/phase3/read-api';
import { signalRoute, addCommunity } from '@/lib/phase3/api';
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => addCommunity(request, (await context.params).id));

export const GET = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => readBrandMonitoring(request, (await context.params).id, 'subreddits'));
