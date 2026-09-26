import { knowledgeRoute } from '@/lib/knowledge/api';
import { extractProduct } from '@/lib/knowledge/extraction';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return knowledgeRoute(() => extractProduct(request, id));
}
