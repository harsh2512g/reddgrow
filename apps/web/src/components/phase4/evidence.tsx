'use client';
import Link from 'next/link';
import { DRAFT_COMPLIANCE_CODES } from '@threadsignal/drafts';
import { BookOpen, Check, Circle, ShieldAlert } from 'lucide-react';
import type { DraftClaimRecord, DraftDetail } from '@/lib/phase4/schema';
import { DraftBadge } from './primitives';
import { displayDate } from '../phase2/primitives';
export function safeSourceUrl(value: string | null) {
  try {
    if (!value) return null;
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
export function ClaimHighlights({ text, claims }: { text: string; claims: DraftClaimRecord[] }) {
  const ranges = claims
    .filter((c) => ['unsupported', 'contradicted', 'partial'].includes(c.status))
    .flatMap((c) => {
      const start = text.indexOf(c.claim_text);
      return start < 0 ? [] : [{ start, end: start + c.claim_text.length, status: c.status }];
    })
    .sort((a, b) => a.start - b.start);
  let cursor = 0;
  const nodes: React.ReactNode[] = [];
  for (const range of ranges) {
    if (range.start < cursor) continue;
    nodes.push(
      text.slice(cursor, range.start),
      <mark
        key={range.start}
        title={range.status}
        className={
          range.status === 'partial'
            ? 'rounded bg-amber-100 text-amber-950'
            : 'rounded bg-red-100 text-red-950'
        }
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  }
  nodes.push(text.slice(cursor));
  return <p className="whitespace-pre-wrap break-words text-sm leading-8">{nodes}</p>;
}
export function EvidencePanel({ claims, stale }: { claims: DraftClaimRecord[]; stale: boolean }) {
  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <BookOpen size={17} className="text-primary" />
          Claim evidence
        </h2>
        <span className="font-mono text-xs text-muted-foreground">{claims.length} claims</span>
      </div>
      {stale && (
        <p
          role="status"
          className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-950"
        >
          Evidence is stale for the current edit or context. Save and verify before relying on these
          results.
        </p>
      )}
      {!claims.length ? (
        <p className="mt-4 text-xs leading-6 text-muted-foreground">
          Claim verification has not produced evidence for this version yet.
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {claims.map((claim, index) => (
            <article key={claim.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold text-muted-foreground">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <DraftBadge status={stale ? 'stale' : claim.status} />
                {!stale && ['stale', 'inferred'].includes(claim.evidence_kind) && (
                  <DraftBadge status={claim.evidence_kind} />
                )}
                <span className="text-[10px] text-muted-foreground">
                  {claim.confidence} confidence
                </span>
              </div>
              <p className="mt-3 text-xs font-medium leading-7">{claim.claim_text}</p>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">{claim.explanation}</p>
              {claim.provenance.map((source) => (
                <details key={source.chunk_id} className="mt-4 rounded-lg bg-muted/40 p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-primary">
                    {source.title}
                  </summary>
                  <blockquote className="mt-3 border-l-2 border-violet-200 pl-3 text-xs leading-6">
                    {source.excerpt}
                  </blockquote>
                  <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
                    {source.filename ?? 'Website documentation'}
                    {source.page_number ? ` · Page ${source.page_number}` : ''}
                    {source.section_heading ? ` · ${source.section_heading}` : ''}
                    <br />
                    Updated {displayDate(source.updated_at)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-semibold text-primary">
                    <Link href={`/app/knowledge/${source.source_id}`}>Review source</Link>
                    {safeSourceUrl(source.source_url) && (
                      <a
                        href={safeSourceUrl(source.source_url)!}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Source URL ↗
                      </a>
                    )}
                  </div>
                </details>
              ))}
            </article>
          ))}
        </div>
      )}
      {claims.some((c) => ['unsupported', 'contradicted'].includes(c.status)) && (
        <p className="mt-4 text-xs leading-6 text-red-800">
          Remove unsupported claims or{' '}
          <Link className="font-semibold underline" href="/app/knowledge">
            add a verified source
          </Link>
          . Contradicted claims cannot be overridden.
        </p>
      )}
    </section>
  );
}
export function CompliancePanel({ detail, stale }: { detail: DraftDetail; stale: boolean }) {
  const version = detail.versions.find((v) => v.version === detail.draft.current_version);
  const record = detail.checks.find((c) => c.draft_version_id === version?.id);
  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <ShieldAlert size={17} className="text-primary" />
        Independent checks
      </h2>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">
        All twelve checks apply to the saved version. Community rules still require human judgment.
      </p>
      <div className="mt-5 divide-y divide-border">
        {DRAFT_COMPLIANCE_CODES.map((code) => {
          const check = record?.checks.find((c) => c.code === code);
          const status = stale ? 'pending' : (check?.status ?? 'pending');
          return (
            <details key={code} className="py-3">
              <summary className="flex cursor-pointer items-center gap-2 text-xs">
                {status === 'pass' ? (
                  <Check size={14} className="shrink-0 text-emerald-700" />
                ) : (
                  <Circle size={12} className="shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 capitalize">{code.toLowerCase().replaceAll('_', ' ')}</span>
                <DraftBadge status={status} />
              </summary>
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                {stale
                  ? 'Recheck after saving or updating context.'
                  : (check?.message ?? 'This check has not completed.')}
              </p>
              {check?.suggested_fix && !stale && (
                <p className="mt-2 text-xs leading-6">
                  <strong>Suggested fix:</strong> {check.suggested_fix}
                </p>
              )}
            </details>
          );
        })}
      </div>
    </section>
  );
}
