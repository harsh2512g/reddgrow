import { notFound } from 'next/navigation';
import { loadKnowledgeSource } from '@/lib/knowledge/server';
import { SourceDetail } from '@/components/phase2/source-detail';
import { LocalKnowledgeNotice } from '@/components/phase2/primitives';

export default async function KnowledgeSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const workspace = await loadKnowledgeSource((await params).id);
  if (!workspace.localEnabled) return <LocalKnowledgeNotice destination="/app/knowledge" />;
  if (!workspace.brand || !workspace.source) notFound();
  return (
    <SourceDetail
      key={workspace.source.id}
      brand={workspace.brand}
      source={workspace.source}
      documents={workspace.documents}
      canManage={workspace.canManage}
    />
  );
}
