import type { Metadata } from 'next';
import { loadOpportunity } from '@/lib/phase3/server';
import { LocalSignalsNotice } from '@/components/phase3/primitives';
import { OpportunityWorkspace } from '@/components/phase3/opportunities';
export const metadata: Metadata = { title: 'Opportunity research' };
export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const workspace = await loadOpportunity((await params).id);
  if (!workspace.enabled || !workspace.opportunity) return <LocalSignalsNotice />;
  return (
    <OpportunityWorkspace
      item={workspace.opportunity}
      rules={workspace.rules}
      organizationId={workspace.organization.id}
      canAct={workspace.canAct}
      monitoring={workspace.monitoring}
      competitors={workspace.competitors}
    />
  );
}
