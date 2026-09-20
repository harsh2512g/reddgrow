import { signalRoute, editCommunity } from '@/lib/phase3/api';
export const PATCH = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => editCommunity(request, (await context.params).id, 'update'));
export const DELETE = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => editCommunity(request, (await context.params).id, 'remove'));
