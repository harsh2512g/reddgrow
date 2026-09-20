'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { ArrowUpRight, Search, Sparkles } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { searchResultSchema } from '@threadsignal/knowledge';
import { FormField, ResultNotice } from '../phase1/primitives';
import type { ActionResult } from '../phase1/types';
import { knowledgeRequest, requestMessage } from './api';
import { KnowledgeEmpty } from './primitives';
import type { Brand, SearchResult } from './types';

export function KnowledgeSearch({ brand }: { brand: Brand }) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<ActionResult | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  return (
    <div className="mt-6 space-y-6">
      <section className="panel p-6 sm:p-7">
        <form
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            const validated = z.string().trim().min(1).max(500).safeParse(query);
            if (!validated.success) {
              setNotice({
                status: 'error',
                message: 'Enter a question or phrase between 1 and 500 characters.',
              });
              return;
            }
            active.current?.abort();
            const controller = new AbortController();
            active.current = controller;
            const timer = setTimeout(() => controller.abort(), 15_000);
            setPending(true);
            setNotice(null);
            try {
              const data = await knowledgeRequest(
                `/api/knowledge/search?brandId=${encodeURIComponent(brand.id)}&q=${encodeURIComponent(validated.data)}`,
                z.array(searchResultSchema),
                { signal: controller.signal },
              );
              if (active.current !== controller) return;
              setResults(data);
              setSubmitted(validated.data);
            } catch (error) {
              if (active.current === controller)
                setNotice({ status: 'error', message: requestMessage(error) });
            } finally {
              clearTimeout(timer);
              if (active.current === controller) setPending(false);
            }
          }}
        >
          <FormField
            id="knowledge-query"
            label={`Search ${brand.name} knowledge`}
            hint="Ask about a capability, limitation, pricing detail, or use case."
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="knowledge-query"
                className="field-input min-w-0 flex-1"
                type="search"
                maxLength={500}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="What does the product support?"
              />
              <Button type="submit" disabled={pending}>
                <Search size={16} />
                {pending ? 'Searching…' : 'Search knowledge'}
              </Button>
            </div>
          </FormField>
        </form>
        <p className="mt-5 flex items-start gap-2 text-[11px] leading-6 text-muted-foreground">
          <Sparkles size={14} className="mt-1 shrink-0 text-primary" />
          Development search combines keyword matches with deterministic mock embeddings. Relevance
          scores are development signals, not verified answers.
        </p>
        <div className="mt-4">
          <ResultNotice result={notice} />
        </div>
      </section>
      <div aria-live="polite" aria-busy={pending}>
        {results === null ? (
          <KnowledgeEmpty
            title="Go from a question to its source."
            description="Search the included passages in this brand’s knowledge. Each result keeps the source title and page reference close at hand."
          />
        ) : results.length === 0 ? (
          <KnowledgeEmpty
            title="No matching knowledge yet."
            description={`No included passages matched “${submitted}”. Try a different phrase, or add a relevant source.`}
            href={`/app/knowledge?brandId=${brand.id}`}
            action="Review sources"
          />
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Evidence for your question</h2>
              <p className="text-xs text-muted-foreground">
                {results.length} {results.length === 1 ? 'passage' : 'passages'} · {submitted}
              </p>
            </div>
            <div className="space-y-4">
              {results.map((result, index) => (
                <article key={result.id} className="panel p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-50 font-mono text-[10px] text-primary">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold">{result.title}</h3>
                        <p className="mt-2 break-all text-[11px] leading-5 text-muted-foreground">
                          {result.source_url ?? 'Private document or team note'}
                          {result.page_number ? ` · Page ${result.page_number}` : ''}
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 font-mono text-[10px] text-primary">
                      Mock relevance {result.score.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-5 whitespace-pre-wrap break-words border-l-2 border-violet-200 pl-4 text-sm leading-7 text-foreground/85">
                    {result.content}
                  </p>
                  <Link
                    href={`/app/knowledge/${result.source_id}`}
                    className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-primary"
                  >
                    Review source <ArrowUpRight size={14} />
                  </Link>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
