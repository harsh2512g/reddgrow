import type { Metadata } from 'next';
import { loadKnowledge } from '@/lib/knowledge/server';
import { PageHeading } from '@/components/phase1/primitives';
import { BrandPicker } from '@/components/phase2/knowledge-list';
import { KnowledgeSearch } from '@/components/phase2/knowledge-search';
import { KnowledgeEmpty, LocalKnowledgeNotice } from '@/components/phase2/primitives';

export const metadata: Metadata = { title: 'Search knowledge' };
export default async function SearchKnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string | string[] }>;
}) {
  const selected = (await searchParams).brandId;
  const workspace = await loadKnowledge(typeof selected === 'string' ? selected : undefined);
  if (!workspace.localEnabled) return <LocalKnowledgeNotice destination="/app/knowledge/search" />;
  return (
    <>
      <PageHeading
        eyebrow="Find the supporting evidence"
        title="Ask the library."
        description="Explore included knowledge for one brand at a time. Every result leads back to its source."
      />
      {workspace.brands.length > 0 && (
        <BrandPicker
          search
          brands={workspace.brands}
          {...(workspace.brand ? { selectedId: workspace.brand.id } : {})}
        />
      )}
      {workspace.brand ? (
        <KnowledgeSearch key={workspace.brand.id} brand={workspace.brand} />
      ) : (
        <div className="mt-6">
          <KnowledgeEmpty
            title="Choose the product you want to understand."
            description="Create a brand and add sources before searching its knowledge."
            href="/app/brands"
            action="View brands"
          />
        </div>
      )}
    </>
  );
}
