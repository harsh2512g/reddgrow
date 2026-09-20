import { operationsRoute } from '@/lib/phase8/http';
import { adminStatus } from '@/lib/phase8/admin';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operationsRoute(() => adminStatus(request, id));
}
