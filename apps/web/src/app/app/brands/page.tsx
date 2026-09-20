import type { Metadata } from 'next';
import { loadBrands } from '@/lib/knowledge/server';
import { BrandLibrary } from '@/components/phase2/brand-library';
import { LocalKnowledgeNotice } from '@/components/phase2/primitives';

export const metadata: Metadata = { title: 'Brands' };
export default async function BrandsPage() {
  const workspace = await loadBrands();
  if (!workspace.localEnabled) return <LocalKnowledgeNotice />;
  return (
    <BrandLibrary
      brands={workspace.brands}
      organizationName={workspace.organization.name}
      canManage={workspace.canManage}
    />
  );
}
