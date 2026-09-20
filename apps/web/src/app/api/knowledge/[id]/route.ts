import { knowledgeRoute, changeSource } from '@/lib/knowledge/api';
export const runtime = 'nodejs';
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return knowledgeRoute(async () => changeSource(request, (await context.params).id, 'delete'));
}
