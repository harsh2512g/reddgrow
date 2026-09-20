import { signOut } from '@/lib/auth/actions';
import { authErrorResponse } from '@/lib/auth/errors';

export async function POST(request: Request) {
  try {
    await signOut(request.headers);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
