import type { Metadata } from 'next';
import { z } from 'zod';
import { TrackingStudio } from '@/components/phase6/tracking-studio';
import { loadTracking } from '@/lib/phase6/server';

export const metadata: Metadata = { title: 'Tracking links' };
export default async function TrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string; page?: string; draftId?: string }>;
}) {
  const { brandId, page, draftId } = await searchParams;
  const initialDraftId = z.uuid().optional().catch(undefined).parse(draftId);
  const pageNumber = z.coerce.number().int().min(1).max(10000).catch(1).parse(page);
  const workspace = await loadTracking(brandId, pageNumber, initialDraftId);
  return (
    <TrackingStudio
      key={`${workspace.organization.id}:${workspace.brand?.id ?? ''}:${workspace.pagination.page}:${initialDraftId ?? ''}`}
      enabled={workspace.enabled}
      organization={workspace.organization}
      canAct={workspace.canAct}
      brands={workspace.brands}
      brand={workspace.brand ?? null}
      apiOrigin={workspace.apiOrigin}
      links={workspace.links}
      initialDraftId={initialDraftId}
      pagination={workspace.pagination}
      drafts={workspace.drafts}
      features={workspace.features}
    />
  );
}
