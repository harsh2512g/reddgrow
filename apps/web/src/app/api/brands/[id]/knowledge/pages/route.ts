import { knowledgeRoute, sourcePages } from '@/lib/knowledge/api';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return knowledgeRoute(async () => sourcePages(request, (await context.params).id));
}
