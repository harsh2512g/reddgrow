import { readBrands, archiveBrand } from '@/lib/knowledge/read-api';
import { knowledgeRoute, updateBrand } from '@/lib/knowledge/api';
export const runtime = 'nodejs';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return knowledgeRoute(async () => updateBrand(request, (await context.params).id));
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return knowledgeRoute(async () => readBrands(request, (await context.params).id));
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return knowledgeRoute(async () => archiveBrand(request, (await context.params).id));
}
