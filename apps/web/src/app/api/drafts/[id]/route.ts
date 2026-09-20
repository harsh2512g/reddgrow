import { draftRoute, getDraft, mutateDraft } from '@/lib/phase4/api';
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) =>
  draftRoute(async () => getDraft(request, (await context.params).id));
export const PATCH = (request: Request, context: { params: Promise<{ id: string }> }) =>
  draftRoute(async () => mutateDraft(request, (await context.params).id, 'save'));
