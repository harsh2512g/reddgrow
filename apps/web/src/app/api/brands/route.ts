import { readBrands } from '@/lib/knowledge/read-api';
import { knowledgeRoute, createBrand } from '@/lib/knowledge/api';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return knowledgeRoute(async () => createBrand(request));
}

export async function GET(request: Request) {
  return knowledgeRoute(async () => readBrands(request));
}
