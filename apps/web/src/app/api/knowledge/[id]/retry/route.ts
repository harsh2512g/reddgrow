import { knowledgeRoute, changeSource } from '@/lib/knowledge/api';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return knowledgeRoute(async () => changeSource(request, (await context.params).id, 'retry'));
}
