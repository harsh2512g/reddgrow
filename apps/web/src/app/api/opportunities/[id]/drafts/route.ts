import { draftRoute, createDraft } from '@/lib/phase4/api';
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  draftRoute(async () => createDraft(request, (await context.params).id));
