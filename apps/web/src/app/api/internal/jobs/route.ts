import { operationsRoute } from '@/lib/phase8/http';
import { adminJobs } from '@/lib/phase8/admin';
export async function GET(request: Request) {
  return operationsRoute(() => adminJobs(request));
}
