import { signalRoute, addCommunity } from '@/lib/phase3/api';
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => addCommunity(request, (await context.params).id));
