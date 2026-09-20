import { operationsRoute } from '@/lib/phase8/http';
import { privacyRevoke } from '@/lib/phase8/privacy';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operationsRoute(() => privacyRevoke(request, id));
}
