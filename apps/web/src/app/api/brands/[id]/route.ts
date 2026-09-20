import { knowledgeRoute, updateBrand } from '@/lib/knowledge/api';
export const runtime = 'nodejs';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return knowledgeRoute(async () => updateBrand(request, (await context.params).id));
}
