'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, RefreshCw, Search } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import type { KnowledgeSource } from '@threadsignal/knowledge';
import { PermissionNotice } from '../phase1/primitives';
import { KnowledgeEmpty, SourceIcon, SourceStatus, displayDate } from './primitives';
import { SourceForm } from './source-form';
import type { Brand } from './types';

export function BrandPicker({
  brands,
  selectedId,
  search = false,
}: {
  brands: Brand[];
  selectedId?: string;
  search?: boolean;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-white p-4">
      <div className="min-w-0 sm:min-w-64">
        <label
          htmlFor="knowledge-brand"
          className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Product context
        </label>
        <select
          id="knowledge-brand"
          value={selectedId ?? ''}
          className="field-input"
          onChange={(event) =>
            router.push(
              `/app/knowledge${search ? '/search' : ''}?brandId=${encodeURIComponent(event.target.value)}`,
            )
          }
        >
          {!selectedId && <option value="">Choose a brand</option>}
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
              {brand.status === 'archived' ? ' (archived)' : ''}
            </option>
          ))}
        </select>
      </div>
      {selectedId && (
        <Button asChild variant="outline">
          <Link
            href={
              search
                ? `/app/knowledge?brandId=${selectedId}`
                : `/app/knowledge/search?brandId=${selectedId}`
            }
          >
            {search ? <BookOpen size={15} /> : <Search size={15} />}
            {search ? 'Browse sources' : 'Search knowledge'}
          </Link>
        </Button>
      )}
    </div>
  );
}

export function ProcessingRefresh({ active, version }: { active: boolean; version: string }) {
  const router = useRouter();
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!active) return;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      router.refresh();
      if (ticks >= 20) {
        clearInterval(timer);
        setExpired(true);
      }
    }, 3_000);
    return () => clearInterval(timer);
  }, [active, version, router]);
  if (!active) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
      <p role="status" className="text-xs leading-6 text-primary">
        {expired
          ? 'Processing is taking longer. Check again to load the latest status.'
          : 'Your sources are processing. This view checks for updates automatically.'}
      </p>
      <Button variant="ghost" size="sm" type="button" onClick={() => router.refresh()}>
        <RefreshCw size={13} /> Check status
      </Button>
    </div>
  );
}

export function KnowledgeList({
  brand,
  sources,
  canManage,
}: {
  brand: Brand;
  sources: KnowledgeSource[];
  canManage: boolean;
}) {
  const processing = sources.some((source) =>
    ['pending', 'processing', 'deleting'].includes(source.status),
  );
  const version = sources
    .map((source) => `${source.id}:${source.generation}:${source.status}`)
    .join('|');
  return (
    <div className="mt-6 space-y-7">
      {!canManage && (
        <PermissionNotice>
          Members and viewers can read and search knowledge. Ask an owner or admin to add or change
          sources.
        </PermissionNotice>
      )}
      {brand.status === 'archived' && (
        <PermissionNotice>
          This brand is archived. Its existing knowledge remains available. An owner or admin can
          restore the brand before adding sources.
        </PermissionNotice>
      )}
      <section aria-labelledby="knowledge-sources-title">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="knowledge-sources-title" className="text-lg font-semibold tracking-tight">
            Your source library
          </h2>
          <span className="rounded-full border border-border bg-white px-3 py-1 font-mono text-xs text-muted-foreground">
            {sources.length} {sources.length === 1 ? 'source' : 'sources'}
          </span>
        </div>
        <ProcessingRefresh active={processing} version={version} />
        {sources.length === 0 ? (
          <KnowledgeEmpty
            title="Every useful answer starts with a source."
            description={
              canManage
                ? 'Add an approved website, upload a document, or write a note below to start building this brand’s knowledge.'
                : 'Your team has not added any sources for this brand yet.'
            }
          />
        ) : (
          <div className="space-y-3">
            {sources.map((source) => (
              <Link
                key={source.id}
                href={`/app/knowledge/${source.id}`}
                className="panel group flex items-start gap-4 p-5 transition-colors hover:border-primary/40"
              >
                <SourceIcon type={source.type} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="break-words text-sm font-semibold group-hover:text-primary">
                      {source.name}
                    </h3>
                    <SourceStatus status={source.status} />
                  </div>
                  <p className="mt-2 text-xs capitalize text-muted-foreground">
                    {source.type === 'file'
                      ? source.filename
                      : source.type === 'manual'
                        ? 'Team knowledge note'
                        : source.type === 'website'
                          ? 'Approved website pages'
                          : 'Approved webpage'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
                    <span>
                      {source.page_count} {source.page_count === 1 ? 'page' : 'pages'}
                    </span>
                    <span>
                      {source.chunk_count} searchable{' '}
                      {source.chunk_count === 1 ? 'passage' : 'passages'}
                    </span>
                    <span>Updated {displayDate(source.updated_at)}</span>
                  </div>
                  {source.error_code && (
                    <p className="mt-3 text-xs text-warning">
                      This source needs attention. Open it to review the next step.
                    </p>
                  )}
                </div>
                <ArrowUpRight
                  size={16}
                  className="mt-1 shrink-0 text-muted-foreground group-hover:text-primary"
                />
              </Link>
            ))}
          </div>
        )}
      </section>
      {canManage && brand.status === 'active' && <SourceForm key={brand.id} brand={brand} />}
    </div>
  );
}
