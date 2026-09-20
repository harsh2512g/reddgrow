import { signalRoute, communitySuggestions } from '@/lib/phase3/api';
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => communitySuggestions(request, (await context.params).id));
