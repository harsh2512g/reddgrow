import { operationsRoute } from '@/lib/phase8/http';
import { adminOverview } from '@/lib/phase8/admin';
export async function GET(request: Request) {
  return operationsRoute(() => adminOverview(request));
}
