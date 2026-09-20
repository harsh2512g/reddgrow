import { z } from 'zod';
import { createServerSupabase } from '@/lib/auth/server';
import { verifiedUser } from '@/lib/auth/session';
import { hasTrustedOrigin } from '@/lib/auth/policy';
import { parseAuthBody } from '@/lib/auth/http';
import { getServerEnv } from '@/lib/env/server';
import {
  organizationInputSchema,
  organizationSchema,
  actionFailure,
} from '@/lib/organizations/schema';

const response = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
async function context(id: string) {
  if (!z.uuid().safeParse(id).success)
    return { error: response({ error: 'Organization unavailable.' }, 404) };
  const supabase = await createServerSupabase();
  const user = verifiedUser(await supabase.auth.getUser());
  if (!user) return { error: response({ error: 'Sign in to continue.' }, 401) };
  const membership = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (membership.error || !membership.data)
    return { error: response({ error: 'Organization unavailable.' }, 404) };
  return { supabase, role: membership.data.role };
}
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await context(id);
    if (auth.error) return auth.error;
    const result = await auth.supabase.rpc('get_organization_settings', { p_organization_id: id });
    if (result.error) return response({ error: 'Organization unavailable.' }, 404);
    const organization = z
      .array(organizationSchema.extend({ billing_email: z.string().nullable() }))
      .min(1)
      .parse(result.data)[0];
    return response({ organization, role: auth.role });
  } catch {
    return response({ error: 'Organization service unavailable.' }, 503);
  }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!hasTrustedOrigin(request.headers, getServerEnv().NEXT_PUBLIC_APP_URL))
      return response({ error: 'Request origin denied.' }, 403);
    const { id } = await params;
    const auth = await context(id);
    if (auth.error) return auth.error;
    if (auth.role !== 'owner' && auth.role !== 'admin')
      return response({ error: 'Your role does not allow this change.' }, 403);
    const input = await parseAuthBody(request, organizationInputSchema);
    if (auth.role === 'owner') z.email().parse(input.billingEmail);
    const result = await auth.supabase.rpc('update_organization', {
      p_organization_id: id,
      p_name: input.name,
      ...(auth.role === 'owner' ? { p_billing_email: input.billingEmail } : {}),
      p_timezone: input.timezone,
      p_default_currency: input.currency,
    });
    if (result.error) return response({ error: actionFailure(result.error).message }, 403);
    return response({ ok: true });
  } catch {
    return response({ error: 'Check your request and try again.' }, 400);
  }
}
