import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/require-session';
import { reportDatabaseReadFailure } from '@/lib/database-read-diagnostics';
import {
  membershipSchema,
  organizationSchema,
  planSchema,
  memberSchema,
  invitationSchema,
} from './schema';

export const organizationCookie = 'threadsignal_organization';
export const organizationColumns =
  'id,name,slug,timezone,default_currency,status,trial_started_at,trial_ends_at,created_at,updated_at' as const;

/** A cookie selects a workspace; verified membership authorizes it on every request. */
export const loadWorkspace = cache(async () => {
  const { user, supabase } = await requireUser();
  const membershipsResult = await supabase
    .from('organization_members')
    .select('organization_id,role')
    .eq('user_id', user.id);
  if (membershipsResult.error) {
    reportDatabaseReadFailure(
      'workspace.memberships',
      membershipsResult.error,
      membershipsResult.status,
    );
    throw new Error('Workspace membership could not be loaded.');
  }
  const memberships = z.array(membershipSchema).parse(membershipsResult.data);
  const result = memberships.length
    ? await supabase
        .from('organizations')
        .select(organizationColumns)
        .in(
          'id',
          memberships.map((item) => item.organization_id),
        )
        .is('deleted_at', null)
        .order('created_at')
    : { data: [], error: null, status: 200 };
  if (result.error) {
    reportDatabaseReadFailure('workspace.organizations', result.error, result.status);
    throw new Error('Workspaces could not be loaded.');
  }
  const organizations = z
    .array(organizationSchema)
    .parse(result.data)
    .flatMap((organization) => {
      const membership = memberships.find((item) => item.organization_id === organization.id);
      return membership ? [{ ...organization, role: membership.role }] : [];
    });
  const selected = (await cookies()).get(organizationCookie)?.value;
  const active = organizations.find((item) => item.id === selected) ?? organizations[0];
  return { user, supabase, organizations, active };
});

export async function requireOrganization(id?: string) {
  const workspace = await loadWorkspace();
  const organization = id
    ? workspace.organizations.find((item) => item.id === id)
    : workspace.active;
  if (!organization) {
    if (id) notFound();
    redirect('/app/onboarding');
  }
  return { ...workspace, organization };
}

export async function loadPlan() {
  const workspace = await requireOrganization();
  const result = await workspace.supabase.rpc('get_organization_plan', {
    p_organization_id: workspace.organization.id,
  });
  if (result.error) throw new Error('The organization plan could not be loaded.');
  const plan = z.array(planSchema).min(1).parse(result.data)[0]!;
  return { ...workspace, plan };
}

export async function loadTeam() {
  const workspace = await loadPlan();
  const { organization, supabase } = workspace;
  const membersResult = await supabase.rpc('list_organization_members', {
    p_organization_id: organization.id,
  });
  if (membersResult.error) throw new Error('The team could not be loaded.');
  const members = z.array(memberSchema).parse(membersResult.data);
  const canManage = organization.role === 'owner' || organization.role === 'admin';
  const invitationsResult = canManage
    ? await supabase
        .from('organization_invitations')
        .select('id,email,role,expires_at')
        .eq('organization_id', organization.id)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at')
    : { data: [], error: null };
  if (invitationsResult.error) throw new Error('Invitations could not be loaded.');
  return {
    ...workspace,
    members,
    invitations: z.array(invitationSchema).parse(invitationsResult.data),
    canManage,
  };
}
