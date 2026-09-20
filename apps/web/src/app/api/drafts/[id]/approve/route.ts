import { draftRoute, mutateDraft } from '@/lib/phase4/api';
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) =>
  draftRoute(async () => mutateDraft(request, (await context.params).id, 'approve'));
