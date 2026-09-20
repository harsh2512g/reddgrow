import type { Metadata } from 'next';
import { PageHeading } from '@/components/phase1/primitives';
import { ActivityFeed } from '@/components/phase8/activity';
import { requireOrganization } from '@/lib/organizations/server';
import { localOpportunitiesEnabled } from '@/lib/phase3/server';
import { checked } from '@/lib/phase8/errors';
import { activityPageSchema } from '@/lib/phase8/contracts';
export const metadata: Metadata = { title: 'Workspace activity' };
export default async function ActivityPage() {
  const { supabase, organization } = await requireOrganization();
  const enabled = localOpportunitiesEnabled();
  const activity = enabled
    ? activityPageSchema.parse(
        checked(
          await supabase.rpc('get_organization_activity', {
            p_organization_id: organization.id,
            p_limit: 25,
          }),
        ),
      )
    : null;
  return (
    <>
      <PageHeading
        eyebrow="Workspace / activity"
        title="A clear record of your work."
        description="Review important changes, human decisions, and background processing. Sensitive document contents and credentials never appear in this feed."
      />
      {activity ? (
        <ActivityFeed initial={activity} organizationId={organization.id} />
      ) : (
        <p className="panel p-6 text-sm">
          Activity history is available in the verified local Supabase workspace.
        </p>
      )}
    </>
  );
}
