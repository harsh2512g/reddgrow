import type { Metadata } from 'next';
import { loadKeywords } from '@/lib/phase3/server';
import { BrandSelector, LocalSignalsNotice, SignalHeader } from '@/components/phase3/primitives';
import { KeywordStudio } from '@/components/phase3/keywords';
import { KnowledgeEmpty } from '@/components/phase2/primitives';
export const metadata: Metadata = { title: 'Keyword studio' };
export default async function KeywordsPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string }>;
}) {
  const workspace = await loadKeywords((await searchParams).brandId);
  if (!workspace.enabled) return <LocalSignalsNotice destination="/app/keywords" />;
  return (
    <>
      <SignalHeader
        eyebrow="02 / Tune your vocabulary"
        title="Hear the need behind the words."
        description="Choose the problems, categories, and comparisons worth listening for. Exclude the conversations that do not belong in your product’s world."
      />
      {workspace.brands.length > 0 && (
        <BrandSelector
          path="/app/keywords"
          brands={workspace.brands}
          brandId={workspace.brand?.id}
        />
      )}
      {workspace.brand ? (
        <KeywordStudio
          brandId={workspace.brand.id}
          organizationId={workspace.organization.id}
          canManage={workspace.canManage && workspace.brand.status === 'active'}
          keywords={workspace.keywords}
        />
      ) : (
        <KnowledgeEmpty
          title="A vocabulary needs a product."
          description="Create a brand and document what it does before tuning keyword matching."
          href="/app/brands/new"
          action="Create a brand"
        />
      )}
    </>
  );
}
