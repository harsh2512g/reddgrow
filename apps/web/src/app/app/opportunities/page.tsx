import type { Metadata } from 'next';
import { loadOpportunities } from '@/lib/phase3/server';
import { BrandSelector, LocalSignalsNotice, SignalHeader } from '@/components/phase3/primitives';
import { OpportunityFeed } from '@/components/phase3/opportunities';
import { KnowledgeEmpty } from '@/components/phase2/primitives';
export const metadata: Metadata = { title: 'Conversation radar' };
export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const workspace = await loadOpportunities(await searchParams);
  if (!workspace.enabled) return <LocalSignalsNotice />;
  return (
    <>
      <SignalHeader
        eyebrow="03 / Find the meaningful signal"
        title="Fewer distractions. Better conversations."
        description="Explore real scored records from the mock discussion pipeline. Product evidence, intent, timing, and community rules explain every opportunity."
      />
      {workspace.brands.length > 0 && (
        <BrandSelector
          path="/app/opportunities"
          brands={workspace.brands}
          brandId={workspace.brand?.id}
        />
      )}
      {workspace.brand ? (
        <OpportunityFeed
          items={workspace.items}
          filters={{ ...workspace.filters, brandId: workspace.brand.id }}
          nextCursor={workspace.nextCursor}
          organizationId={workspace.organization.id}
          canAct={workspace.canAct}
          communities={workspace.communities}
          competitors={workspace.competitors}
          usage={workspace.usage}
          invalidFilters={workspace.invalidFilters}
        />
      ) : (
        <KnowledgeEmpty
          title="Give your radar some context."
          description="Create a brand, add verified product knowledge, and monitor a community. Relevant discussions become scored opportunities automatically."
          href="/app/brands/new"
          action="Create a brand"
        />
      )}
    </>
  );
}
