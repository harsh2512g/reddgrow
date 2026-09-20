import { operationsRoute } from '@/lib/phase8/http';
import { adminProviders } from '@/lib/phase8/admin';
export async function GET(request: Request) {
  return operationsRoute(() => adminProviders(request));
}
