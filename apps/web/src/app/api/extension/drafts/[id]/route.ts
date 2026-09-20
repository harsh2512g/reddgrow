import { extensionRoute, extensionDraftAction, extensionOptions } from '@/lib/phase5/api';
export const PATCH = (request: Request, context: { params: Promise<{ id: string }> }) =>
  extensionRoute(
    request,
    async () => extensionDraftAction(request, (await context.params).id, 'save'),
    true,
  );
export const OPTIONS = extensionOptions;
