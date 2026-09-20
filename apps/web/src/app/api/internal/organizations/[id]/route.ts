import { operationsRoute } from '@/lib/phase8/http';
import { adminOrganization } from '@/lib/phase8/admin';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operationsRoute(() => adminOrganization(request, id));
}
