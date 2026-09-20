import { extensionRoute, extensionDraftAction, extensionOptions } from '@/lib/phase5/api';
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  extensionRoute(
    request,
    async () => extensionDraftAction(request, (await context.params).id, 'published'),
    true,
  );
export const OPTIONS = extensionOptions;
