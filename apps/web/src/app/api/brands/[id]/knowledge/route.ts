import { readSources } from '@/lib/knowledge/read-api';
import { knowledgeRoute, addSource } from '@/lib/knowledge/api';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return knowledgeRoute(async () => addSource(request, (await context.params).id));
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return knowledgeRoute(async () => readSources(request, (await context.params).id));
}
