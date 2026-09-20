import Link from 'next/link';
import type { Metadata } from 'next';
import { loadDrafts } from '@/lib/phase4/server';
import { DraftBadge, DraftHeader, LocalDraftsNotice } from '@/components/phase4/primitives';
import { BrandSelector, SignalRefresh } from '@/components/phase3/primitives';
import { KnowledgeEmpty, displayDate } from '@/components/phase2/primitives';
import { Button } from '@threadsignal/ui';
export const metadata: Metadata = { title: 'Draft evidence studio' };
export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const workspace = await loadDrafts(await searchParams);
  if (!workspace.enabled) return <LocalDraftsNotice />;
  return (
    <>
      <DraftHeader
        title="A good answer earns its place."
        description="Turn relevant conversations into useful replies. Every version keeps its sources, checks, and human review together."
      />
      <BrandSelector brands={workspace.brands} brandId={workspace.brand?.id} path="/app/drafts" />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {workspace.usage?.quantity ?? 0} / {workspace.usage?.limit ?? 0} draft generations this
          period
        </p>
        <div className="flex items-center gap-4">
          <Link
            href={`/app/settings/persona${workspace.brand ? `?brandId=${workspace.brand.id}` : ''}`}
            className="text-xs font-semibold text-primary"
          >
            Persona & disclosure
          </Link>
          <SignalRefresh automatic />
        </div>
      </div>
      <form action="/app/drafts" className="panel mb-6 flex flex-wrap items-end gap-4 p-5">
        <input type="hidden" name="brandId" value={workspace.brand?.id ?? ''} />
        <label className="min-w-48 flex-1 text-xs font-semibold">
          Search draft text
          <input
            name="q"
            defaultValue={workspace.filters.q}
            className="field-input mt-2"
            maxLength={100}
          />
        </label>
        <label className="text-xs font-semibold">
          Review status
          <select
            name="status"
            defaultValue={workspace.filters.status ?? ''}
            className="field-input mt-2"
          >
            <option value="">All statuses</option>
            {[
              'generating',
              'ready',
              'editing',
              'warning',
              'blocked',
              'approved',
              'rejected',
              'error',
            ].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline">
          Apply filters
        </Button>
      </form>
      {workspace.invalidFilters && (
        <p role="alert" className="mb-5 text-sm text-red-800">
          Some draft filters are invalid. Clear the filters and try again.
        </p>
      )}
      {!workspace.drafts.length ? (
        <KnowledgeEmpty
          title="Your next useful reply starts with a signal."
          description="Open an eligible opportunity and generate a draft. Your current brand persona and verified sources guide the first version."
          href={`/app/opportunities${workspace.brand ? `?brandId=${workspace.brand.id}` : ''}`}
          action="Explore opportunities"
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {workspace.drafts.map((draft) => (
            <Link
              key={draft.id}
              href={`/app/drafts/${draft.id}`}
              className="panel group block p-6 transition-colors hover:border-violet-300"
            >
              <div className="flex items-center justify-between gap-3">
                <DraftBadge status={draft.status} />
                <span className="font-mono text-[10px] text-muted-foreground">
                  v{draft.current_version || '—'}
                </span>
              </div>
              <h2 className="mt-4 text-base font-semibold leading-7 group-hover:text-primary">
                {workspace.titles.find((item) => item.id === draft.opportunity_id)?.summary ||
                  'Draft review'}
              </h2>
              <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-xs leading-7 text-muted-foreground">
                {draft.current_content ||
                  (draft.purged_at
                    ? 'The original discussion was removed.'
                    : 'Generation is queued. Open the studio to follow its progress.')}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4 text-[10px] text-muted-foreground">
                <span>Evidence: {draft.verification_status}</span>
                <span>Checks: {draft.compliance_status}</span>
                <span className="ml-auto">{displayDate(draft.updated_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {workspace.nextCursor && (
        <div className="mt-6 text-right">
          <Link
            className="text-xs font-semibold text-primary"
            href={`/app/drafts?${new URLSearchParams(Object.entries({ ...workspace.filters, brandId: workspace.brand?.id ?? '', cursor: workspace.nextCursor }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))}`}
          >
            Earlier drafts →
          </Link>
        </div>
      )}
    </>
  );
}
