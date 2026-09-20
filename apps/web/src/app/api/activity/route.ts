import { operationsRoute } from '@/lib/phase8/http';
import { organizationActivity } from '@/lib/phase8/admin';
export async function GET(request: Request) {
  return operationsRoute(() => organizationActivity(request));
}
