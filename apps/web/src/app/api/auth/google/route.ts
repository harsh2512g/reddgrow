import { z } from 'zod';
import { requestGoogleSignIn } from '@/lib/auth/actions';
import { authErrorResponse } from '@/lib/auth/errors';
import { parseAuthBody } from '@/lib/auth/http';

export async function POST(request: Request) {
  try {
    const input = await parseAuthBody(
      request,
      z.object({ next: z.string().max(1024).optional() }).strict(),
      true,
    );
    const url = await requestGoogleSignIn(input.next, request.headers);
    return new Response(null, {
      status: 303,
      headers: { Location: url, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
