import { notFound } from 'next/navigation';
import { loadBrand } from '@/lib/knowledge/server';
import { BrandOverview } from '@/components/phase2/brand-overview';
import { LocalKnowledgeNotice } from '@/components/phase2/primitives';

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const workspace = await loadBrand((await params).id);
  if (!workspace.localEnabled) return <LocalKnowledgeNotice />;
  if (!workspace.brand) notFound();
  return <BrandOverview brand={workspace.brand} canManage={workspace.canManage} />;
}
