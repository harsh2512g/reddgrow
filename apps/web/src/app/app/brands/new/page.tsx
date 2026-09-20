import type { Metadata } from 'next';
import { loadBrands } from '@/lib/knowledge/server';
import { PageHeading } from '@/components/phase1/primitives';
import { BrandForm } from '@/components/phase2/brand-form';
import { LocalKnowledgeNotice } from '@/components/phase2/primitives';

export const metadata: Metadata = { title: 'Create a brand' };
export default async function NewBrandPage() {
  const workspace = await loadBrands();
  if (!workspace.localEnabled) return <LocalKnowledgeNotice destination="/app/brands/new" />;
  return (
    <>
      <PageHeading
        eyebrow="Build your product context"
        title="Every good answer starts with understanding."
        description="Tell your team’s product story with specific facts, approved links, and an honest voice. Add knowledge sources after saving."
      />
      <BrandForm organizationId={workspace.organization.id} canManage={workspace.canManage} />
    </>
  );
}
