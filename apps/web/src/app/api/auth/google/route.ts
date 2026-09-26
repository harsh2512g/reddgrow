import { z } from 'zod';
import { requestGoogleSignIn } from '@/lib/auth/actions';
import { authErrorResponse } from '@/lib/auth/errors';
import { parseAuthBody } from '@/lib/auth/http';

export async function POST(request: Request) {
  try {
    const input = await parseAuthBody(
      request,
      z.object({ next: z.string().max(1024).optional() }).strict(),
    );
    const url = await requestGoogleSignIn(input.next, request.headers);
    // The client navigates after receiving the PKCE cookies; a form 303 is blocked by CSP.
    return Response.json({ url }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
