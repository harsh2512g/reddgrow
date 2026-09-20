import { draftRoute, getPersona, savePersona } from '@/lib/phase4/api';
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) =>
  draftRoute(async () => getPersona(request, (await context.params).id));
export const PATCH = (request: Request, context: { params: Promise<{ id: string }> }) =>
  draftRoute(async () => savePersona(request, (await context.params).id));
