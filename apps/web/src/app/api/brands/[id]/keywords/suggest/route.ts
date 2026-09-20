import { signalRoute, keywordSuggestions } from '@/lib/phase3/api';
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => keywordSuggestions(request, (await context.params).id));
