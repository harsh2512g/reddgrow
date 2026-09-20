import { signalRoute, editKeyword } from '@/lib/phase3/api';
export const PATCH = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => editKeyword(request, (await context.params).id));
export const DELETE = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => editKeyword(request, (await context.params).id, true));
