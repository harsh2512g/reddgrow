import { operationsRoute } from '@/lib/phase8/http';
import { privacyDownload } from '@/lib/phase8/privacy';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return operationsRoute(() => privacyDownload(request, id));
}
