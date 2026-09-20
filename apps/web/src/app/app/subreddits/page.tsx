import type { Metadata } from 'next';
import { loadMonitoring } from '@/lib/phase3/server';
import { BrandSelector, LocalSignalsNotice, SignalHeader } from '@/components/phase3/primitives';
import { CommunityStudio } from '@/components/phase3/communities';
import { KnowledgeEmpty } from '@/components/phase2/primitives';
export const metadata: Metadata = { title: 'Community radar' };
export default async function CommunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string }>;
}) {
  const workspace = await loadMonitoring((await searchParams).brandId);
  if (!workspace.enabled) return <LocalSignalsNotice destination="/app/subreddits" />;
  return (
    <>
      <SignalHeader
        eyebrow="01 / Choose where to listen"
        title="Good conversations have a home."
        description="Follow relevant communities, understand their boundaries, and keep a thoughtful pulse on the discussions your product can help."
      />
      {workspace.brands.length > 0 && (
        <BrandSelector
          path="/app/subreddits"
          brands={workspace.brands}
          brandId={workspace.brand?.id}
        />
      )}
      {workspace.brand ? (
        <CommunityStudio
          brandId={workspace.brand.id}
          organizationId={workspace.organization.id}
          canManage={workspace.canManage && workspace.brand.status === 'active'}
          communities={workspace.communities}
          rules={workspace.rules}
        />
      ) : (
        <KnowledgeEmpty
          title="Start with your product."
          description="Create a brand profile before selecting communities. Its knowledge and audience shape your conversation radar."
          href="/app/brands/new"
          action="Create a brand"
        />
      )}
    </>
  );
}
