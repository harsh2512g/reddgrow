import type { Metadata } from 'next';
import { loadPersona } from '@/lib/phase4/server';
import { DraftHeader, LocalDraftsNotice } from '@/components/phase4/primitives';
import { PersonaForm } from '@/components/phase4/persona';
import { BrandSelector } from '@/components/phase3/primitives';
import { KnowledgeEmpty } from '@/components/phase2/primitives';
import { z } from 'zod';
export const metadata: Metadata = { title: 'Persona & disclosure' };
export default async function PersonaPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string }>;
}) {
  const params = await searchParams;
  const brandId = z.uuid().safeParse(params.brandId);
  const workspace = await loadPersona(brandId.success ? brandId.data : undefined);
  if (!workspace.enabled) return <LocalDraftsNotice persona />;
  return (
    <>
      <DraftHeader
        title="Sound like yourself."
        description="Choose how you explain things, disclose your relationship, and set the boundaries your drafts must respect."
      />
      <BrandSelector
        brands={workspace.brands}
        brandId={workspace.brand?.id}
        path="/app/settings/persona"
      />
      {workspace.persona && workspace.brand ? (
        <PersonaForm
          key={workspace.brand.id}
          persona={workspace.persona}
          brandId={workspace.brand.id}
          organizationId={workspace.organization.id}
          canManage={workspace.canManage}
        />
      ) : (
        <KnowledgeEmpty
          title="Add a brand to define your voice."
          description="Your persona belongs to a brand and reflects your real relationship to it."
          href="/app/brands/new"
          action="Create a brand"
        />
      )}
    </>
  );
}
