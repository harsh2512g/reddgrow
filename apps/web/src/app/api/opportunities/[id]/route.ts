import { signalRoute, opportunityDetail } from '@/lib/phase3/api';
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => opportunityDetail(request, (await context.params).id));
