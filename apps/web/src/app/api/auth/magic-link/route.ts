import { requestMagicLink } from '@/lib/auth/actions';
import { authErrorResponse } from '@/lib/auth/errors';
import { parseAuthBody } from '@/lib/auth/http';
import { magicLinkInputSchema } from '@/lib/auth/policy';

export async function POST(request: Request) {
  try {
    const input = await parseAuthBody(request, magicLinkInputSchema);
    return Response.json(await requestMagicLink(input, request.headers), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
