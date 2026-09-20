import { knowledgeRoute, downloadSource } from '@/lib/knowledge/api';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return knowledgeRoute(async () => downloadSource(request, (await context.params).id));
}
