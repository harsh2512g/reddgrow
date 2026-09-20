import { operationsRoute } from '@/lib/phase8/http';
import { privacyRequests, privacyCreate } from '@/lib/phase8/privacy';
export async function GET(request: Request) {
  return operationsRoute(() => privacyRequests(request));
}
export async function POST(request: Request) {
  return operationsRoute(() => privacyCreate(request));
}
