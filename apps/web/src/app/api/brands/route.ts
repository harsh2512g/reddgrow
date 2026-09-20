import { knowledgeRoute, createBrand } from '@/lib/knowledge/api';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return knowledgeRoute(async () => createBrand(request));
}
