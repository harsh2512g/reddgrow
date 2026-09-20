import { knowledgeRoute, uploadSource } from '@/lib/knowledge/api';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return knowledgeRoute(async () => uploadSource(request, (await context.params).id));
}
