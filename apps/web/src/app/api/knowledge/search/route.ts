import { knowledgeRoute, runSearch } from '@/lib/knowledge/api';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return knowledgeRoute(async () => runSearch(request));
}
