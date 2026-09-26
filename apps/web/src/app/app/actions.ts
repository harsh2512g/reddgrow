'use server';

import { randomBytes, createHash } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createEmailProvider } from '@threadsignal/email';
import { hasOrganizationPermission, type OrganizationPermission } from '@threadsignal/config';
import { requireUser } from '@/lib/auth/require-session';
import { getAuthConfiguration } from '@/lib/auth/config';
import { hasTrustedOrigin, sessionCookieOptions } from '@/lib/auth/policy';
import { getServerEnv } from '@/lib/env/server';
import { requireOrganization, organizationCookie, loadWorkspace } from '@/lib/organizations/server';
import {
  actionFailure,
  organizationInputSchema,
  inviteInputSchema,
  memberInputSchema,
  tokenSchema,
} from '@/lib/organizations/schema';
import type { ActionResult } from '@/components/phase1/types';

async function assertOrigin() {
  if (!hasTrustedOrigin(await headers(), getServerEnv().NEXT_PUBLIC_APP_URL))
    throw new Error('FORBIDDEN');
}
async function selectOrganization(id: string) {
  const config = getAuthConfiguration();
  (await cookies()).set(
    organizationCookie,
    id,
    sessionCookieOptions(config.production, config.verifiedLocalHttp),
  );
}
async function authorized(permission: OrganizationPermission, organizationId: string) {
  await assertOrigin();
  const workspace = await requireOrganization(z.uuid().parse(organizationId));
  if (!hasOrganizationPermission(workspace.organization.role, permission))
    throw new Error('FORBIDDEN');
  return workspace;
}
function success(message: string): ActionResult {
  revalidatePath('/app', 'layout');
  return { status: 'success', message };
}

export async function createOrganizationAction(data: FormData): Promise<ActionResult> {
  let id: string;
  try {
    await assertOrigin();
    const input = organizationInputSchema.parse(Object.fromEntries(data));
    z.literal('true').parse(data.get('responsibleUse'));
    z.email().parse(input.billingEmail);
    const { supabase } = await requireUser();
    const result = await supabase.rpc('create_organization', {
      p_name: input.name,
      p_slug: input.slug,
      p_billing_email: input.billingEmail,
      p_timezone: input.timezone,
      p_default_currency: input.currency,
    });
    if (result.error) throw result.error;
    id = z.uuid().parse(result.data);
    await selectOrganization(id);
  } catch (error) {
    unstable_rethrow(error);
    return actionFailure(error);
  }
  revalidatePath('/app', 'layout');
  redirect('/app/onboarding');
}

export async function updateOrganizationAction(
  organizationId: string,
  data: FormData,
): Promise<ActionResult> {
  try {
    const { supabase, organization } = await authorized('manage_settings', organizationId);
    const input = organizationInputSchema.parse(Object.fromEntries(data));
    if (organization.role === 'owner') z.email().parse(input.billingEmail);
    const result = await supabase.rpc('update_organization', {
      p_organization_id: organization.id,
      p_name: input.name,
      ...(organization.role === 'owner' ? { p_billing_email: input.billingEmail } : {}),
      p_timezone: input.timezone,
      p_default_currency: input.currency,
    });
    if (result.error) throw result.error;
    return success('Organization settings saved.');
  } catch (error) {
    unstable_rethrow(error);
    return actionFailure(error);
  }
}

export async function switchOrganizationAction(data: FormData): Promise<ActionResult> {
  try {
    await assertOrigin();
    const id = z.uuid().parse(data.get('organizationId'));
    const workspace = await loadWorkspace();
    if (!workspace.organizations.some((item) => item.id === id)) throw new Error('FORBIDDEN');
    await selectOrganization(id);
  } catch (error) {
    unstable_rethrow(error);
    return actionFailure(error);
  }
  revalidatePath('/app', 'layout');
  redirect('/app');
}

export async function inviteMemberAction(
  organizationId: string,
  data: FormData,
): Promise<ActionResult> {
  try {
    const { supabase, organization } = await authorized('manage_members', organizationId);
    const input = inviteInputSchema.parse(Object.fromEntries(data));
    const env = getServerEnv();
    const provider = createEmailProvider(
      env.EMAIL_PROVIDER,
      undefined,
      env.EMAIL_PROVIDER === 'resend'
        ? { apiKey: env.RESEND_API_KEY!, from: env.EMAIL_FROM! }
        : undefined,
    );
    const token = randomBytes(32).toString('hex');
    const result = await supabase.rpc('invite_member', {
      p_organization_id: organization.id,
      p_email: input.email,
      p_role: input.role,
      p_token_hash: createHash('sha256').update(token).digest('hex'),
    });
    if (result.error) throw result.error;
    const url = `${env.NEXT_PUBLIC_APP_URL}/app/invitations/${token}`;
    try {
      await provider.send({
        to: input.email,
        subject: `Join ${organization.name} on ThreadSignal`,
        text: `Sign in with your invited email and accept this invitation: ${url}`,
        idempotencyKey: `invite_${z.uuid().parse(result.data)}`,
      });
    } catch {
      if (provider.mode === 'console')
        return {
          ...success(
            'Invitation created, but console delivery is unavailable. Share the private link below with your teammate.',
          ),
          invitationUrl: url,
        };
      await supabase.rpc('revoke_invitation', { p_invitation_id: z.uuid().parse(result.data) });
      throw new Error('DELIVERY_UNAVAILABLE');
    }
    return {
      ...success(
        provider.mode === 'console'
          ? 'Invitation created. Share the private link with your teammate; invitation emails are disabled.'
          : 'Invitation email sent.',
      ),
      ...(provider.mode === 'console' ? { invitationUrl: url } : {}),
    };
  } catch (error) {
    unstable_rethrow(error);
    return actionFailure(error);
  }
}

export async function acceptInvitationAction(token: string): Promise<ActionResult> {
  try {
    await assertOrigin();
    const verifiedToken = tokenSchema.parse(token);
    const { supabase } = await requireUser();
    const result = await supabase.rpc('accept_invitation', {
      p_token_hash: createHash('sha256').update(verifiedToken).digest('hex'),
    });
    if (result.error) throw result.error;
    await selectOrganization(z.uuid().parse(result.data));
  } catch (error) {
    unstable_rethrow(error);
    return actionFailure(error);
  }
  revalidatePath('/app', 'layout');
  redirect('/app');
}

export async function updateRoleAction(
  organizationId: string,
  data: FormData,
): Promise<ActionResult> {
  try {
    const { supabase, organization } = await authorized('manage_members', organizationId);
    const input = memberInputSchema.parse(Object.fromEntries(data));
    const result = await supabase.rpc('change_member_role', {
      p_organization_id: organization.id,
      p_user_id: input.memberId,
      p_role: input.role,
    });
    if (result.error) throw result.error;
    return success('Member role updated.');
  } catch (error) {
    unstable_rethrow(error);
    return actionFailure(error);
  }
}
export async function removeMemberAction(
  organizationId: string,
  data: FormData,
): Promise<ActionResult> {
  try {
    const { supabase, organization } = await authorized('manage_members', organizationId);
    const result = await supabase.rpc('remove_member', {
      p_organization_id: organization.id,
      p_user_id: z.uuid().parse(data.get('memberId')),
    });
    if (result.error) throw result.error;
    return success('Member removed.');
  } catch (error) {
    unstable_rethrow(error);
    return actionFailure(error);
  }
}
export async function revokeInvitationAction(
  organizationId: string,
  data: FormData,
): Promise<ActionResult> {
  try {
    const { supabase, organization } = await authorized('manage_members', organizationId);
    const invitationId = z.uuid().parse(data.get('invitationId'));
    const invitation = await supabase
      .from('organization_invitations')
      .select('id')
      .eq('id', invitationId)
      .eq('organization_id', organization.id)
      .maybeSingle();
    if (invitation.error || !invitation.data) throw new Error('INVITATION_INVALID');
    const result = await supabase.rpc('revoke_invitation', { p_invitation_id: invitationId });
    if (result.error) throw result.error;
    return success('Invitation revoked.');
  } catch (error) {
    unstable_rethrow(error);
    return actionFailure(error);
  }
}
export async function dataRequestAction(
  organizationId: string,
  data: FormData,
): Promise<ActionResult> {
  try {
    const { supabase, organization } = await authorized('request_data', organizationId);
    const kind = z.enum(['export', 'deletion']).parse(data.get('type'));
    const result = await supabase.rpc('request_organization_data', {
      p_organization_id: organization.id,
      p_kind: kind === 'deletion' ? 'delete' : 'export',
    });
    if (result.error) throw result.error;
    return success(
      'Your request was recorded. No data has been exported or deleted; processing is not available in this release.',
    );
  } catch (error) {
    unstable_rethrow(error);
    return actionFailure(error);
  }
}
