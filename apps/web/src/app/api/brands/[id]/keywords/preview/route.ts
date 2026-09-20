import { signalRoute, keywordPreview } from '@/lib/phase3/api';
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) =>
  signalRoute(async () => keywordPreview(request, (await context.params).id));
