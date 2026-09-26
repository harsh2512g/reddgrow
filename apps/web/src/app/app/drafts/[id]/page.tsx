import type { Metadata } from 'next';
import { loadDraft } from '@/lib/phase4/server';
import { DraftStudio } from '@/components/phase4/studio';
import { LocalDraftsNotice } from '@/components/phase4/primitives';
import { localExtensionFixtureEnabled } from '@/lib/phase5/fixture';
export const metadata: Metadata = { title: 'Draft review' };
export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const workspace = await loadDraft((await params).id);
  if (!workspace.enabled || !workspace.detail) return <LocalDraftsNotice />;
  return (
    <DraftStudio
      key={workspace.detail.draft.id}
      initial={workspace.detail}
      organizationId={workspace.organization.id}
      canAct={workspace.canAct}
      allowLocalFixture={localExtensionFixtureEnabled()}
    />
  );
}
