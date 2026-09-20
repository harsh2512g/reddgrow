import type { Metadata } from 'next';
import { getPlan } from '@threadsignal/config';
import { Dashboard } from '@/components/phase1/dashboard';
import { AttributionOverview } from '@/components/phase6/overview';
import { attributionEnabled, loadAnalytics } from '@/lib/phase6/server';
import { loadPlan } from '@/lib/organizations/server';
import { localKnowledgeEnabled } from '@/lib/knowledge/server';
export const metadata: Metadata = { title: 'Workspace overview' };
export default async function WorkspaceOverview() {
  if (attributionEnabled()) {
    const workspace = await loadAnalytics();
    if (workspace.analytics)
      return (
        <AttributionOverview
          organizationName={workspace.organization.name}
          report={workspace.analytics}
        />
      );
  }
  const { organization, plan } = await loadPlan();
  return (
    <Dashboard
      organization={{
        name: organization.name,
        slug: organization.slug,
        role: organization.role,
        createdAt: organization.created_at,
      }}
      memberCount={plan.seats_used}
      trialEndsAt={organization.trial_ends_at}
      planName={getPlan(plan.plan_key).name}
      localKnowledgeEnabled={localKnowledgeEnabled()}
    />
  );
}
