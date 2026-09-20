import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/auth/server';
import { getAuthConfiguration } from '@/lib/auth/config';
import { callbackInputSchema, safeNextPath } from '@/lib/auth/policy';
import { enforceAuthRateLimit } from '@/lib/auth/rate-limit';
import { verifiedUser } from '@/lib/auth/session';

function finish(path: string, appUrl: string): NextResponse {
  return NextResponse.redirect(new URL(path, appUrl), {
    status: 303,
    headers: { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer' },
  });
}

export async function GET(request: Request) {
  let appUrl = 'http://127.0.0.1:3000';
  try {
    const config = getAuthConfiguration();
    appUrl = config.appUrl;
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
      return finish('/login?error=invalid_link', appUrl);
    if (params.has('error') || params.has('error_code'))
      return finish('/login?error=invalid_link', appUrl);
    const input = callbackInputSchema.safeParse(Object.fromEntries(params));
    if (!input.success) return finish('/login?error=invalid_link', appUrl);
    await enforceAuthRateLimit('callback');
    const supabase = await createServerSupabase({ writable: true });
    const result = input.data.code
      ? await supabase.auth.exchangeCodeForSession(
          input.data.code,
          input.data.sb_flow_id ? { flowId: input.data.sb_flow_id } : undefined,
        )
      : await supabase.auth.verifyOtp({
          token_hash: input.data.token_hash ?? '',
          type: input.data.type ?? 'email',
        });
    if (result.error || !verifiedUser(await supabase.auth.getUser()))
      return finish('/login?error=invalid_link', appUrl);
    return finish(safeNextPath(input.data.next), appUrl);
  } catch {
    return finish('/login?error=service_unavailable', appUrl);
  }
}
