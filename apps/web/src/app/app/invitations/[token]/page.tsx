import { notFound } from 'next/navigation';
import { InvitationPanel } from '@/components/phase1/invitation-panel';
import { PageHeading } from '@/components/phase1/primitives';
import { tokenSchema } from '@/lib/organizations/schema';
import { requireUser } from '@/lib/auth/require-session';
import { acceptInvitationAction } from '../../actions';
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!tokenSchema.safeParse(token).success) notFound();
  const { user } = await requireUser();
  return (
    <>
      <PageHeading
        eyebrow="An invitation to connect"
        title="There’s a place for you here."
        description={`Signed in as ${user.email ?? 'a verified user'}. Only the invited email can join this organization.`}
      />
      <InvitationPanel action={acceptInvitationAction.bind(null, token)} />
    </>
  );
}
