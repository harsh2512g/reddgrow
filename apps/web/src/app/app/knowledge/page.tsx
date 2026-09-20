import type { Metadata } from 'next';
import { loadKnowledge } from '@/lib/knowledge/server';
import { PageHeading } from '@/components/phase1/primitives';
import { BrandPicker, KnowledgeList } from '@/components/phase2/knowledge-list';
import {
  KnowledgeEmpty,
  KnowledgeIntro,
  LocalKnowledgeNotice,
} from '@/components/phase2/primitives';

export const metadata: Metadata = { title: 'Knowledge library' };
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string | string[] }>;
}) {
  const selected = (await searchParams).brandId;
  const workspace = await loadKnowledge(typeof selected === 'string' ? selected : undefined);
  if (!workspace.localEnabled) return <LocalKnowledgeNotice destination="/app/knowledge" />;
  return (
    <>
      <PageHeading
        eyebrow="The knowledge studio"
        title="A library you can stand behind."
        description="Bring verified product sources into one private, searchable space. What you include is always your choice."
      />
      <KnowledgeIntro
        title="Source first. Confidence follows."
        description="Review approved pages, preserve document references, and search the facts your team actually knows. Fixture crawling and mock embeddings are active."
      />
      {workspace.brands.length > 0 && (
        <BrandPicker
          brands={workspace.brands}
          {...(workspace.brand ? { selectedId: workspace.brand.id } : {})}
        />
      )}
      {workspace.brand ? (
        <KnowledgeList
          key={workspace.brand.id}
          brand={workspace.brand}
          sources={workspace.sources}
          canManage={workspace.canManage}
        />
      ) : (
        <div className="mt-6">
          <KnowledgeEmpty
            title={
              workspace.brands.length
                ? 'Choose a brand to open its library.'
                : 'First, make a home for your product.'
            }
            description={
              workspace.brands.length
                ? 'Use the product selector to review a brand’s private sources.'
                : 'Each source belongs to a brand. Create a product profile before adding your first source.'
            }
            href={workspace.canManage ? '/app/brands/new' : '/app/brands'}
            action={workspace.canManage ? 'Create a brand' : 'View brands'}
          />
        </div>
      )}
    </>
  );
}
