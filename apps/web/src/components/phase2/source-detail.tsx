'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  FileText,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { publicWebsite, type KnowledgeSource } from '@threadsignal/knowledge';
import { PageHeading, PermissionNotice, ResultNotice } from '../phase1/primitives';
import type { ActionResult } from '../phase1/types';
import { knowledgeRequest, mutationSchema, requestMessage } from './api';
import { ProcessingRefresh } from './knowledge-list';
import { KnowledgeEmpty, SourceStatus, displayDate } from './primitives';
import type { Brand, KnowledgeDocument } from './types';

const sourceErrors: Record<string, string> = {
  INVALID_FILE:
    'The file could not be read safely. Upload a valid PDF, Markdown, or UTF-8 text file.',
  UNSUPPORTED_FILE: 'This format is not supported. Use PDF, Markdown, or plain text.',
  ENCRYPTED_PDF: 'This PDF is encrypted. Upload an unlocked copy you are authorized to use.',
  UNREADABLE_PDF: 'No readable text was found. Export a text-based PDF or upload a text version.',
  EMPTY_DOCUMENT:
    'The source did not contain readable text. Add a source with useful product information.',
  EXTRACTION_LIMIT: 'This source exceeds the extraction limit. Split it into smaller documents.',
  PARTIAL_CRAWL:
    'Some approved pages could not be processed. Available pages remain searchable; retry to process the rest.',
  CRAWL_FAILED:
    'Approved fixture pages could not be loaded. Review the selected website and retry.',
  PROCESSING_FAILED:
    'Processing could not finish. Retry this source once the knowledge worker is available.',
  LEASE_EXPIRED:
    'The processing worker stopped before completing this source. Retry once it is running.',
  STORAGE_UNAVAILABLE:
    'The private file could not be accessed. Retry once storage access is restored.',
};

export function SourceDetail({
  brand,
  source,
  documents,
  canManage,
}: {
  brand: Brand;
  source: KnowledgeSource;
  documents: KnowledgeDocument[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(documents[0]?.id ?? '');
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const selected = documents.find((document) => document.id === selectedId) ?? documents[0];
  const processing = ['pending', 'processing', 'deleting'].includes(source.status);
  const deleting = source.status === 'deleting' || Boolean(source.deleted_at);

  async function mutate(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
    setPending(true);
    setResult(null);
    try {
      await knowledgeRequest(path, mutationSchema, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      setResult({
        status: 'success',
        message:
          method === 'DELETE'
            ? 'Deletion has been queued. The worker will remove this source and its private file.'
            : method === 'PATCH'
              ? 'Search inclusion updated.'
              : 'The source has been queued for processing.',
      });
      setConfirmDelete(false);
      if (method === 'DELETE') router.push(`/app/knowledge?brandId=${brand.id}`);
      router.refresh();
    } catch (error) {
      setResult({ status: 'error', message: requestMessage(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Link
        href={`/app/knowledge?brandId=${brand.id}`}
        className="mb-6 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary"
      >
        <ArrowLeft size={14} /> Back to {brand.name} knowledge
      </Link>
      <PageHeading
        eyebrow="Source notebook"
        title={source.name}
        description={`A source in ${brand.name}’s private knowledge library. Review its extracted text and decide what belongs in search.`}
        action={<SourceStatus status={source.status} />}
      />
      {!canManage && (
        <PermissionNotice>
          Your role can read this source. An owner or admin can change its search inclusion or
          processing state.
        </PermissionNotice>
      )}
      <ProcessingRefresh
        active={processing}
        version={`${source.id}:${source.generation}:${source.status}`}
      />
      {source.error_code && (
        <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-warning">
            {deleting ? 'File cleanup needs attention' : 'This source needs attention'}
          </p>
          <p className="mt-2 text-xs leading-6 text-warning">
            {deleting
              ? 'The source is hidden from search. Retry cleanup to remove any remaining private files and records.'
              : (sourceErrors[source.error_code] ??
                'Processing could not finish. Review this source and retry when the knowledge worker is available.')}
          </p>
        </div>
      )}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Extracted pages', value: String(source.page_count) },
          { label: 'Searchable passages', value: String(source.chunk_count) },
          { label: 'Last processed', value: displayDate(source.last_ingested_at) },
        ].map((item) => (
          <div className="panel p-5" key={item.label}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {item.label}
            </p>
            <p className="mt-3 text-sm font-semibold">{item.value}</p>
          </div>
        ))}
      </div>
      <section className="panel mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Source controls</p>
            <p className="mt-2 break-all text-xs leading-6 text-muted-foreground">
              {source.filename ??
                (source.type === 'manual'
                  ? 'Team-authored knowledge note'
                  : 'Approved fixture content')}{' '}
              · {source.type === 'file' ? 'Private original file' : 'Organization access only'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {source.storage_path && !deleting && (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/knowledge/${source.id}/download`} download>
                  <Download size={14} /> Download original
                </a>
              </Button>
            )}
            {canManage && !deleting && brand.status === 'active' && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending || processing}
                onClick={() => void mutate(`/api/knowledge/${source.id}/retry`, 'POST')}
              >
                <RefreshCw size={14} />
                {pending
                  ? 'Updating…'
                  : source.type === 'website' || source.type === 'webpage'
                    ? 'Re-crawl approved pages'
                    : 'Reprocess source'}
              </Button>
            )}
            {canManage && (!deleting || source.error_code) && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} />
                {deleting ? 'Retry cleanup' : 'Delete source'}
              </Button>
            )}
          </div>
        </div>
        {confirmDelete && (
          <div
            className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4"
            role="group"
            aria-label="Confirm source deletion"
          >
            <p className="text-sm font-semibold text-red-800">
              {deleting ? 'Retry removal of this source?' : `Delete “${source.name}”?`}
            </p>
            <p className="mt-2 text-xs leading-6 text-red-800">
              Its extracted pages and passages will leave search immediately. The background worker
              removes the original private file and related records.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setConfirmDelete(false)}
              >
                Keep source
              </Button>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => void mutate(`/api/knowledge/${source.id}`, 'DELETE')}
              >
                {pending
                  ? 'Queuing deletion…'
                  : deleting
                    ? 'Confirm cleanup retry'
                    : 'Confirm delete'}
              </Button>
            </div>
          </div>
        )}
        <div className="mt-4">
          <ResultNotice result={result} />
        </div>
      </section>
      {deleting ? (
        <KnowledgeEmpty
          title="This source is leaving the library."
          description="Its content is excluded from search. The worker is removing the file and related records. Return to the library to see the updated list."
          href={`/app/knowledge?brandId=${brand.id}`}
          action="Return to library"
        />
      ) : documents.length === 0 ? (
        <KnowledgeEmpty
          title={
            processing ? 'Turning your source into useful knowledge.' : 'No extracted pages yet.'
          }
          description={
            processing
              ? 'The worker reads the content, preserves its references, and prepares searchable passages. Status updates will appear here.'
              : 'When processing succeeds, you can preview each page and control whether it appears in search.'
          }
        />
      ) : (
        <section
          className="grid items-start gap-5 xl:grid-cols-[260px_minmax(0,1fr)]"
          aria-labelledby="extracted-pages-title"
        >
          <div className="panel overflow-hidden">
            <h2
              id="extracted-pages-title"
              className="border-b border-border p-5 text-sm font-semibold"
            >
              Extracted pages{' '}
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {documents.length}
              </span>
            </h2>
            <div className="max-h-[480px] overflow-y-auto p-2">
              {documents.map((document) => (
                <button
                  type="button"
                  key={document.id}
                  onClick={() => setSelectedId(document.id)}
                  aria-pressed={selected?.id === document.id}
                  className={`mb-1 flex w-full items-start gap-2.5 rounded-xl p-3 text-left ${selected?.id === document.id ? 'bg-violet-50 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  <FileText size={15} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block break-words text-xs font-semibold leading-5">
                      {document.title}
                    </span>
                    <span className="mt-1.5 block text-[10px]">
                      {document.page_number ? `Page ${document.page_number} · ` : ''}
                      {document.is_included ? 'Included in search' : 'Excluded from search'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          {selected && (
            <DocumentPreview
              key={selected.id}
              document={selected}
              canManage={canManage}
              pending={pending}
              onToggle={() =>
                void mutate(`/api/knowledge/documents/${selected.id}`, 'PATCH', {
                  included: !selected.is_included,
                })
              }
            />
          )}
        </section>
      )}
    </>
  );
}

function DocumentPreview({
  document,
  canManage,
  pending,
  onToggle,
}: {
  document: KnowledgeDocument;
  canManage: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const safeUrl = publicWebsite.safeParse(document.canonical_url);
  const content = expanded ? document.content : document.content.slice(0, 12_000);
  return (
    <article className="panel min-w-0 overflow-hidden">
      <div className="border-b border-border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Document preview{document.page_number ? ` · Page ${document.page_number}` : ''}
            </p>
            <h3 className="mt-3 break-words text-xl font-semibold tracking-tight">
              {document.title}
            </h3>
          </div>
          {canManage ? (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onToggle}>
              {document.is_included ? 'Exclude from search' : 'Include in search'}
            </Button>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {document.is_included && <Check size={13} />}
              {document.is_included ? 'Included in search' : 'Excluded from search'}
            </p>
          )}
        </div>
        {safeUrl.success && (
          <a
            href={safeUrl.data}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex max-w-full items-center gap-2 break-all text-xs leading-6 text-primary"
          >
            {safeUrl.data}
            <ExternalLink size={12} className="shrink-0" />
          </a>
        )}
        <p className="mt-3 text-[11px] leading-6 text-muted-foreground">
          Extracted content is reference material, not an instruction to follow. Review it for
          accuracy before including it in your knowledge.
        </p>
      </div>
      <div className="p-6 sm:p-8">
        <p className="whitespace-pre-wrap break-words text-sm leading-8 text-foreground/85">
          {content}
        </p>
        {document.content.length > 12_000 && (
          <Button
            variant="outline"
            type="button"
            className="mt-6"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Show shorter preview' : 'Show full extracted text'}
          </Button>
        )}
      </div>
    </article>
  );
}
