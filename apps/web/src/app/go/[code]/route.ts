import { trackingRedirect } from '@/lib/phase6/public';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  return trackingRedirect(request, (await params).code);
}
export const HEAD = GET;
