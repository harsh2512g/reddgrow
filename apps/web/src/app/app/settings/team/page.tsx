import { TeamPanel } from '@/components/phase1/team-panel';
import { PageHeading } from '@/components/phase1/primitives';
import { loadTeam } from '@/lib/organizations/server';
import {
  inviteMemberAction,
  updateRoleAction,
  removeMemberAction,
  revokeInvitationAction,
} from '../../actions';
export default async function TeamSettings() {
  const { user, organization, members, invitations, plan, canManage } = await loadTeam();
  return (
    <>
      <PageHeading
        eyebrow="People & access"
        title="Good work is a team thing."
        description="Invite thoughtfully, define clear roles, and keep your workspace in the right hands."
      />
      <TeamPanel
        members={members.map((member) => ({
          id: member.user_id,
          email: member.email ?? member.full_name ?? 'Workspace member',
          role: member.role,
          isCurrentUser: member.user_id === user.id,
        }))}
        invitations={invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expires_at,
        }))}
        memberLimit={plan.seat_limit}
        canManage={canManage}
        inviteAction={inviteMemberAction.bind(null, organization.id)}
        updateRoleAction={updateRoleAction.bind(null, organization.id)}
        removeMemberAction={removeMemberAction.bind(null, organization.id)}
        revokeInvitationAction={revokeInvitationAction.bind(null, organization.id)}
      />
    </>
  );
}
