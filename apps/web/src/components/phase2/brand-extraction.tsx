'use client';
import { useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Sparkles } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import {
  extractionPreviewSchema,
  extractionLabels,
  type ExtractionPreview,
  type ExtractionSuggestion,
} from '@/lib/knowledge/extraction-schema';
import { knowledgeRequest, requestMessage } from './api';
import { ResultNotice } from '../phase1/primitives';
import type { ActionResult } from '../phase1/types';

export function BrandExtraction({
  brandId,
  organizationId,
  disabled,
  onApply,
}: {
  brandId: string;
  organizationId: string;
  disabled: boolean;
  onApply: (suggestions: ExtractionSuggestion[], checksum: string) => void;
}) {
  const [preview, setPreview] = useState<ExtractionPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  async function generate() {
    setPending(true);
    setPreview(null);
    setSelected([]);
    setResult(null);
    try {
      setPreview(
        await knowledgeRequest(`/api/brands/${brandId}/extract-product`, extractionPreviewSchema, {
          method: 'POST',
          headers: { 'X-ThreadSignal-Organization': organizationId },
          body: JSON.stringify({ operation: 'preview' }),
        }),
      );
    } catch (error) {
      setResult({ status: 'error', message: requestMessage(error) });
    } finally {
      setPending(false);
    }
  }
  async function apply() {
    if (!preview || !selected.length) return;
    setPending(true);
    setResult(null);
    try {
      await knowledgeRequest(
        `/api/brands/${brandId}/extract-product`,
        z.object({ current: z.literal(true) }),
        {
          method: 'POST',
          headers: { 'X-ThreadSignal-Organization': organizationId },
          body: JSON.stringify({ operation: 'validate', checksum: preview.checksum }),
        },
      );
      onApply(
        preview.suggestions.filter((item) => selected.includes(item.field)),
        preview.checksum,
      );
      setResult({
        status: 'success',
        message:
          'Selected suggestions are in the form. Review your changes, then save the brand profile.',
      });
      setPreview(null);
      setSelected([]);
    } catch (error) {
      setResult({ status: 'error', message: requestMessage(error) });
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel mb-6 space-y-5 p-6" aria-labelledby="brand-extraction-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="brand-extraction-title" className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles size={18} className="text-primary" /> Learn from your product sources
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
            Review suggestions from your included knowledge. Select each field you want to replace;
            your role, disclosure and approved links stay under your control.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || pending}
          onClick={() => void generate()}
        >
          {pending ? 'Checking sources…' : 'Suggest product details'}
        </Button>
      </div>
      {preview && (
        <div className="space-y-4">
          <p className="text-xs leading-6 text-muted-foreground">
            {preview.provider === 'mock'
              ? 'Local extraction copies a supported source sentence for review.'
              : 'AI suggestions need your review; a source quote does not guarantee the suggestion is correct.'}{' '}
            {preview.limited &&
              'This review uses the first eight included documents and up to 4,000 characters from each; other evidence was not analyzed.'}
          </p>
          {!preview.suggestions.length ? (
            <p role="status" className="rounded-xl border border-border p-4 text-sm">
              No supported suggestions are available.{' '}
              <Link
                href={`/app/knowledge?brandId=${brandId}`}
                className="font-semibold text-primary underline"
              >
                Add or review product knowledge
              </Link>
              , then try again.
            </p>
          ) : (
            <>
              {preview.suggestions.map((suggestion) => (
                <div key={suggestion.field} className="rounded-xl border border-border p-4">
                  <label className="flex items-start gap-3 font-semibold">
                    <input
                      type="checkbox"
                      className="mt-1 accent-primary"
                      checked={selected.includes(suggestion.field)}
                      disabled={disabled || pending}
                      onChange={(event) =>
                        setSelected((fields) =>
                          event.target.checked
                            ? [...fields, suggestion.field]
                            : fields.filter((field) => field !== suggestion.field),
                        )
                      }
                    />{' '}
                    Replace {extractionLabels[suggestion.field]}
                  </label>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7">
                    {Array.isArray(suggestion.value)
                      ? suggestion.value.join('\n')
                      : suggestion.value}
                  </p>
                  {suggestion.citations.map((citation, index) => {
                    const document = preview.documents.find(
                      (item) => item.id === citation.document_id,
                    );
                    return (
                      <figure
                        key={`${citation.document_id}-${index}`}
                        className="mt-3 border-l-2 border-primary/30 pl-3 text-xs leading-6 text-muted-foreground"
                      >
                        <blockquote>“{citation.quote}”</blockquote>
                        <figcaption>
                          {document ? (
                            <Link
                              className="font-semibold text-primary underline"
                              href={`/app/knowledge/${document.source_id}`}
                            >
                              {document.title || 'Review source'}
                            </Link>
                          ) : (
                            'Source unavailable'
                          )}
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              ))}
              <Button
                type="button"
                disabled={disabled || pending || !selected.length}
                onClick={() => void apply()}
              >
                Apply selected suggestions to form
              </Button>
            </>
          )}
        </div>
      )}
      <ResultNotice result={result} />
    </section>
  );
}
