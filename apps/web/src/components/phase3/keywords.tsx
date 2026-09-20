'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { keywordInputSchema, type KeywordInput } from '@threadsignal/opportunities';
import { Button } from '@threadsignal/ui';
import { Sparkles, ScanText, Plus } from 'lucide-react';
import { actionResponseSchema, signalMessage, signalRequest } from '@/lib/phase3/client';
import type { KeywordRecord } from '@/lib/phase3/schema';
import { ResultNotice, PermissionNotice } from '../phase1/primitives';
import type { ActionResult } from '../phase1/types';
import { KnowledgeEmpty } from '../phase2/primitives';
import { SignalAction } from './primitives';

const suggestionSchema = z.object({ keywords: z.array(keywordInputSchema) });
const previewSchema = z.object({
  matches: z.array(
    z.object({
      post: z.object({
        id: z.string(),
        title: z.string(),
        body: z.string(),
        subreddit: z.string(),
      }),
      matched_terms: z.array(z.string()),
      excluded_terms: z.array(z.string()),
      matched: z.boolean(),
    }),
  ),
});
const keywordData = (keyword: KeywordRecord) => ({
  value: keyword.value,
  kind: keyword.kind,
  is_exclusion: keyword.is_exclusion,
  status: keyword.status,
  source: keyword.source,
});
export function KeywordStudio({
  brandId,
  organizationId,
  canManage,
  keywords,
}: {
  brandId: string;
  organizationId: string;
  canManage: boolean;
  keywords: KeywordRecord[];
}) {
  const [suggestions, setSuggestions] = useState<KeywordInput[] | null>(null);
  const [preview, setPreview] = useState<z.infer<typeof previewSchema>['matches'] | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();
  async function suggest() {
    setPending(true);
    setResult(null);
    try {
      setSuggestions(
        (
          await signalRequest(
            `/api/brands/${brandId}/keywords/suggest`,
            suggestionSchema,
            organizationId,
            { method: 'POST' },
          )
        ).keywords,
      );
    } catch (error) {
      setResult({ status: 'error', message: signalMessage(error) });
    } finally {
      setPending(false);
    }
  }
  async function accept(keyword: KeywordInput) {
    setPending(true);
    try {
      await signalRequest(`/api/brands/${brandId}/keywords`, actionResponseSchema, organizationId, {
        method: 'POST',
        body: JSON.stringify(keyword),
      });
      setSuggestions((current) => current?.filter((item) => item.value !== keyword.value) ?? null);
      setResult({ status: 'success', message: 'Suggested term added.' });
      router.refresh();
    } catch (error) {
      setResult({ status: 'error', message: signalMessage(error) });
    } finally {
      setPending(false);
    }
  }
  async function showPreview() {
    setPending(true);
    setResult(null);
    try {
      setPreview(
        (await signalRequest(`/api/brands/${brandId}/keywords/preview`, previewSchema)).matches,
      );
    } catch (error) {
      setResult({ status: 'error', message: signalMessage(error) });
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)]">
      <section className="space-y-5">
        {!canManage && <PermissionNotice />}
        <div className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Listen for the right language.</h2>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                Product terms guide relevance. Exclusions remove conversations you do not want to
                pursue.
              </p>
            </div>
            {canManage && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void suggest()}
                disabled={pending}
              >
                <Sparkles size={14} />
                Suggest terms
              </Button>
            )}
          </div>
          {canManage && (
            <div className="mt-6">
              <KeywordForm brandId={brandId} organizationId={organizationId} />
            </div>
          )}
        </div>
        <ResultNotice result={result} />
        {suggestions && (
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Review mock AI suggestions</h2>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              Derived from your product context. A suggestion becomes active only when you add it.
            </p>
            <div className="mt-4 space-y-2">
              {suggestions
                .filter(
                  (item) =>
                    !keywords.some(
                      (keyword) => keyword.value.toLowerCase() === item.value.toLowerCase(),
                    ),
                )
                .map((keyword) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-xl bg-violet-50/60 p-3"
                    key={keyword.value}
                  >
                    <span className="min-w-0 break-words text-xs">
                      {keyword.value}
                      <span className="ml-2 text-[10px] text-muted-foreground">{keyword.kind}</span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => void accept(keyword)}
                    >
                      Add term
                    </Button>
                  </div>
                ))}
            </div>
            {suggestions.every((item) =>
              keywords.some((keyword) => keyword.value.toLowerCase() === item.value.toLowerCase()),
            ) && (
              <p role="status" className="mt-3 text-xs text-muted-foreground">
                Your vocabulary already includes these suggestions.
              </p>
            )}
          </section>
        )}
        {keywords.length === 0 ? (
          <KnowledgeEmpty
            title="Give your radar a vocabulary."
            description="Add category, problem, recommendation, competitor, or technical terms. Preview the mock discussions they match."
          />
        ) : (
          <section className="panel divide-y divide-border">
            <div className="flex flex-wrap gap-5 p-5 text-xs font-semibold">
              <span>
                {keywords.filter((item) => item.status === 'active' && !item.is_exclusion).length}{' '}
                active terms
              </span>
              <span>{keywords.filter((item) => item.is_exclusion).length} exclusions</span>
              <span className="text-muted-foreground">
                {keywords.filter((item) => item.status === 'paused').length} paused
              </span>
            </div>
            {keywords.map((keyword) => (
              <article key={keyword.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="break-words text-sm font-semibold">{keyword.value}</h3>
                    <p className="mt-2 text-[10px] capitalize text-muted-foreground">
                      {keyword.kind} · {keyword.status} · {keyword.source}
                      {keyword.is_exclusion ? ' · Excluded' : ''}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <SignalAction
                        path={`/api/keywords/${keyword.id}`}
                        method="PATCH"
                        body={{
                          ...keywordData(keyword),
                          status: keyword.status === 'active' ? 'paused' : 'active',
                        }}
                        organizationId={organizationId}
                      >
                        {keyword.status === 'active' ? 'Pause' : 'Resume'}
                      </SignalAction>
                      <SignalAction
                        path={`/api/keywords/${keyword.id}`}
                        method="DELETE"
                        organizationId={organizationId}
                        confirm={`Remove “${keyword.value}” from this brand’s vocabulary?`}
                      >
                        Remove
                      </SignalAction>
                    </div>
                  )}
                </div>
                {canManage && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs font-semibold text-primary">
                      Edit term
                    </summary>
                    <div className="mt-4">
                      <KeywordForm
                        brandId={brandId}
                        organizationId={organizationId}
                        existing={keyword}
                      />
                    </div>
                  </details>
                )}
              </article>
            ))}
          </section>
        )}
      </section>
      <aside className="panel p-5 sm:p-6">
        <span className="inline-flex size-11 items-center justify-center rounded-xl bg-violet-50 text-primary">
          <ScanText size={23} />
        </span>
        <h2 className="mt-4 text-lg font-semibold">See what comes through.</h2>
        <p className="mt-3 text-xs leading-6 text-muted-foreground">
          Preview saved terms against synthetic discussions. Matches still need product evidence,
          intent scoring, and a community-rule review.
        </p>
        <Button
          type="button"
          className="mt-5"
          variant="outline"
          disabled={pending}
          onClick={() => void showPreview()}
        >
          {pending ? 'Loading…' : 'Preview matching posts'}
        </Button>
        {preview && (
          <div className="mt-5 space-y-3">
            <p role="status" className="text-xs font-semibold">
              {preview.filter((match) => match.matched).length} matches in {preview.length}{' '}
              previewed discussions
            </p>
            {preview.length === 0 && (
              <p className="text-xs leading-6 text-muted-foreground">
                No fixture posts are available yet.
              </p>
            )}
            {preview.map((match) => (
              <article
                key={match.post.id}
                className={`rounded-xl border p-4 ${match.matched ? 'border-violet-200 bg-violet-50/40' : 'border-border'}`}
              >
                <p className="text-[10px] font-semibold text-muted-foreground">
                  r/{match.post.subreddit} ·{' '}
                  {match.excluded_terms.length
                    ? 'Excluded'
                    : match.matched
                      ? 'Matched'
                      : 'No active term match'}
                </p>
                <h3 className="mt-2 text-xs font-semibold leading-6">{match.post.title}</h3>
                {match.matched_terms.length > 0 && (
                  <p className="mt-2 text-[10px] leading-5 text-primary">
                    Matches: {match.matched_terms.join(', ')}
                  </p>
                )}
                {match.excluded_terms.length > 0 && (
                  <p className="mt-2 text-[10px] leading-5 text-warning">
                    Exclusions: {match.excluded_terms.join(', ')}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
function KeywordForm({
  brandId,
  organizationId,
  existing,
}: {
  brandId: string;
  organizationId: string;
  existing?: KeywordRecord;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();
  const valueId = `keyword-value-${existing?.id ?? 'new'}`;
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const excluded = data.get('is_exclusion') === 'on' || data.get('kind') === 'exclusion';
        const parsed = keywordInputSchema.safeParse({
          value: data.get('value'),
          kind: excluded ? 'exclusion' : data.get('kind'),
          is_exclusion: excluded,
          status: existing?.status ?? 'active',
          source: existing?.source ?? 'manual',
        });
        if (!parsed.success) {
          setResult({
            status: 'error',
            message: 'Enter a term between 2 and 200 characters and select its category.',
          });
          return;
        }
        setPending(true);
        try {
          await signalRequest(
            existing ? `/api/keywords/${existing.id}` : `/api/brands/${brandId}/keywords`,
            actionResponseSchema,
            organizationId,
            { method: existing ? 'PATCH' : 'POST', body: JSON.stringify(parsed.data) },
          );
          setResult({ status: 'success', message: existing ? 'Term updated.' : 'Term added.' });
          if (!existing) form.reset();
          router.refresh();
        } catch (error) {
          setResult({ status: 'error', message: signalMessage(error) });
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending} className="space-y-4">
        <label htmlFor={valueId} className="block text-xs font-semibold">
          {existing ? 'Edit keyword' : 'Keyword or phrase'}
          <input
            id={valueId}
            name="value"
            className="field-input mt-2"
            defaultValue={existing?.value}
            maxLength={200}
            minLength={2}
            required
            placeholder="e.g. image optimization API"
          />
        </label>
        <div className="flex flex-wrap items-end gap-4">
          <label className="min-w-40 flex-1 text-xs font-semibold">
            Category
            <select
              className="field-input mt-2"
              name="kind"
              defaultValue={existing?.kind ?? 'category'}
            >
              {[
                'category',
                'problem',
                'recommendation',
                'alternative',
                'competitor',
                'technical',
                'exclusion',
              ].map((kind) => (
                <option key={kind} value={kind}>
                  {kind.charAt(0).toUpperCase() + kind.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 py-3 text-xs">
            <input
              type="checkbox"
              name="is_exclusion"
              defaultChecked={existing?.is_exclusion}
              className="accent-primary"
            />
            Exclude this term
          </label>
          <Button type="submit" size="sm">
            <Plus size={13} />
            {pending ? 'Saving…' : existing ? 'Save term' : 'Add keyword'}
          </Button>
        </div>
      </fieldset>
      <ResultNotice result={result} />
    </form>
  );
}
