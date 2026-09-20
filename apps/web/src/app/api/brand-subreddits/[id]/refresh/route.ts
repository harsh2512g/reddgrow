import { signalRoute, editCommunity } from '@/lib/phase3/api';
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => editCommunity(request, (await context.params).id, 'refresh'));
