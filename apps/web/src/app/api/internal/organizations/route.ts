import { operationsRoute } from '@/lib/phase8/http';
import { adminOrganizations } from '@/lib/phase8/admin';
export async function GET(request: Request) {
  return operationsRoute(() => adminOrganizations(request));
}
