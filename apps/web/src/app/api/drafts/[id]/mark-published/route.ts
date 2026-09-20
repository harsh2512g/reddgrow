import { extensionRoute, markDraftPublished } from '@/lib/phase5/api';
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  extensionRoute(request, async () => markDraftPublished(request, (await context.params).id));
