import { signalRoute, changeOpportunity } from '@/lib/phase3/api';
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => changeOpportunity(request, (await context.params).id, 'status', 'saved'));
