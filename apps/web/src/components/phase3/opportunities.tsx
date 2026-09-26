'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import {
  Bookmark,
  Eye,
  ArrowRight,
  MessageSquare,
  SlidersHorizontal,
  ShieldAlert,
  ArrowUpRight,
  Radio,
} from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { dismissalReasonSchema } from '@threadsignal/opportunities';
import {
  opportunityWorkflowSchema,
  type FeedFilters,
  type Opportunity,
  type CommunityRule,
} from '@/lib/phase3/schema';
import { signalRequest, signalMessage } from '@/lib/phase3/client';
import { ScoreBadge, RiskBadge, SignalAction, SignalRefresh } from './primitives';
import { displayDate, KnowledgeEmpty } from '../phase2/primitives';
import { PermissionNotice, ResultNotice } from '../phase1/primitives';
import { GenerateDraftButton } from '../phase4/primitives';
import type { ActionResult } from '../phase1/types';

export function filterHref(
  filters: FeedFilters,
  changes: Partial<FeedFilters>,
  nextCursor?: string | null,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    ...filters,
    ...changes,
    cursor: nextCursor ?? undefined,
  })) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return `/app/opportunities?${params}`;
}
function titleCase(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
function safeExternal(value: string | null) {
  try {
    if (!value) return undefined;
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
function ageLabel(value: string) {
  const hours = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 3_600_000));
  return hours < 1
    ? 'Less than 1h'
    : hours < 24
      ? `${hours}h old`
      : `${Math.floor(hours / 24)}d old`;
}
const reasonOptions = dismissalReasonSchema.options;
export function OpportunityActions({
  item,
  organizationId,
  canAct,
  compact = false,
}: {
  item: Opportunity;
  organizationId: string;
  canAct: boolean;
  compact?: boolean;
}) {
  const [reason, setReason] = useState<(typeof reasonOptions)[number]>('not_relevant');
  if (!canAct) return <p className="text-xs text-muted-foreground">Viewer access · Read only</p>;
  return (
    <div className="space-y-3">
      <GenerateDraftButton
        opportunityId={item.id}
        organizationId={organizationId}
        disabled={
          item.is_blocked || item.post.is_deleted || item.post.is_locked || item.post.is_archived
        }
      />
      <div className="flex flex-wrap gap-2">
        <SignalAction
          path={`/api/opportunities/${item.id}/save`}
          organizationId={organizationId}
          disabled={item.is_blocked || item.post.is_deleted || item.status === 'saved'}
        >
          <Bookmark size={13} />
          {item.status === 'saved' ? 'Saved' : 'Save'}
        </SignalAction>
        <SignalAction
          path={`/api/opportunities/${item.id}/status`}
          method="PATCH"
          body={{ status: 'monitoring' }}
          organizationId={organizationId}
          disabled={item.is_blocked || item.post.is_deleted || item.status === 'monitoring'}
        >
          <Eye size={13} />
          Monitor
        </SignalAction>
        {!compact && (
          <>
            <SignalAction
              path={`/api/opportunities/${item.id}/rescore`}
              organizationId={organizationId}
              disabled={item.post.is_deleted}
            >
              Re-evaluate
            </SignalAction>
            <SignalAction
              path={`/api/opportunities/${item.id}/status`}
              method="PATCH"
              body={{ status: 'archived' }}
              organizationId={organizationId}
              disabled={item.status === 'archived'}
            >
              Archive
            </SignalAction>
            {['dismissed', 'archived'].includes(item.status) && (
              <SignalAction
                path={`/api/opportunities/${item.id}/status`}
                method="PATCH"
                body={{ status: 'new' }}
                organizationId={organizationId}
                disabled={item.is_blocked || item.post.is_deleted}
              >
                Return to new
              </SignalAction>
            )}
          </>
        )}
      </div>
      <details>
        <summary className="w-fit cursor-pointer text-[11px] font-semibold text-muted-foreground">
          Dismiss with a reason
        </summary>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs">
            Dismissal reason
            <select
              aria-label={`Dismissal reason for ${item.post.title ?? 'deleted post'}`}
              className="field-input mt-2"
              value={reason}
              onChange={(event) => setReason(dismissalReasonSchema.parse(event.target.value))}
            >
              {reasonOptions.map((option) => (
                <option key={option} value={option}>
                  {titleCase(option)}
                </option>
              ))}
            </select>
          </label>
          <SignalAction
            path={`/api/opportunities/${item.id}/dismiss`}
            body={{ reason }}
            organizationId={organizationId}
            disabled={item.status === 'dismissed'}
          >
            Dismiss opportunity
          </SignalAction>
        </div>
      </details>
    </div>
  );
}
export function OpportunityFeed({
  items,
  filters,
  nextCursor,
  organizationId,
  canAct,
  communities,
  competitors,
  usage,
  invalidFilters,
}: {
  items: Opportunity[];
  filters: FeedFilters;
  nextCursor: string | null;
  organizationId: string;
  canAct: boolean;
  communities: { id: string; name: string }[];
  competitors: { id: string; name: string }[];
  usage: { quantity: number; limit: number; plan_key: string } | null;
  invalidFilters: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState<(typeof reasonOptions)[number]>('not_relevant');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();
  const eligible = selected.filter((id) => items.some((item) => item.id === id));
  async function dismiss() {
    setPending(true);
    try {
      const done = await signalRequest(
        '/api/opportunities/dismiss',
        z.object({ count: z.number().int() }),
        organizationId,
        { method: 'POST', body: JSON.stringify({ ids: eligible, reason }) },
      );
      setSelected([]);
      setResult({ status: 'success', message: `${done.count} opportunities dismissed.` });
      router.refresh();
    } catch (error) {
      setResult({ status: 'error', message: signalMessage(error) });
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-6">
      {usage && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="panel flex items-center justify-between p-4">
            <span className="text-xs text-muted-foreground">Period allowance</span>
            <span className="font-mono text-sm font-semibold">
              {usage.quantity} <span className="text-muted-foreground">/ {usage.limit}</span>
            </span>
          </div>
          <div className="panel flex items-center justify-between p-4">
            <span className="text-xs text-muted-foreground">High score on this page</span>
            <span className="font-mono text-sm font-semibold text-positive">
              {items.filter((item) => item.final_score >= 80 && !item.is_blocked).length}
            </span>
          </div>
          <div className="panel flex items-center justify-between p-4">
            <span className="text-xs text-muted-foreground">Blocked on this page</span>
            <span className="font-mono text-sm font-semibold">
              {items.filter((item) => item.is_blocked).length}
            </span>
          </div>
        </div>
      )}
      {usage && usage.quantity >= usage.limit && (
        <PermissionNotice>
          Your opportunity allowance is full for this period. Existing research remains available.{' '}
          <Link href="/app/settings/billing" className="font-semibold underline">
            Review plan limits
          </Link>
          .
        </PermissionNotice>
      )}
      <form key={JSON.stringify(filters)} action="/app/opportunities" className="panel p-5">
        <input type="hidden" name="brandId" value={filters.brandId ?? ''} />
        <input type="hidden" name="view" value={filters.view} />
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-48 flex-1 text-xs font-semibold">
            Search titles
            <input
              name="q"
              defaultValue={filters.q}
              maxLength={150}
              className="field-input mt-2"
              placeholder="A problem, tool, or requirement"
            />
          </label>
          <label className="text-xs font-semibold">
            Status
            <select className="field-input mt-2" name="status" defaultValue={filters.status ?? ''}>
              <option value="">All statuses</option>
              {opportunityWorkflowSchema.options.map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold">
            Sort
            <select className="field-input mt-2" name="sort" defaultValue={filters.sort}>
              <option value="score">Opportunity score</option>
              <option value="freshness">Freshness score</option>
              <option value="engagement">Engagement score</option>
            </select>
          </label>
          <Button type="submit">
            <SlidersHorizontal size={14} />
            Apply filters
          </Button>
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-semibold text-primary">
            Community, intent, risk, score & date filters
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs font-semibold">
              Community
              <select
                name="subreddit"
                defaultValue={filters.subreddit ?? ''}
                className="field-input mt-2"
              >
                <option value="">All communities</option>
                {communities.map((item) => (
                  <option key={item.id} value={item.id}>
                    r/{item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold">
              Intent
              <select
                name="intent"
                defaultValue={filters.intent ?? ''}
                className="field-input mt-2"
              >
                <option value="">All intents</option>
                {[
                  'recommendation',
                  'alternative',
                  'comparison',
                  'problem',
                  'research',
                  'support',
                  'other',
                ].map((value) => (
                  <option key={value} value={value}>
                    {titleCase(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold">
              Risk
              <select name="risk" defaultValue={filters.risk ?? ''} className="field-input mt-2">
                <option value="">All risks</option>
                {['low', 'medium', 'high', 'blocked'].map((value) => (
                  <option key={value} value={value}>
                    {titleCase(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold">
              Minimum score
              <input
                name="minimumScore"
                type="number"
                min={0}
                max={100}
                defaultValue={filters.minimumScore}
                className="field-input mt-2"
              />
            </label>
            <label className="text-xs font-semibold">
              Competitor
              <select
                name="competitorId"
                defaultValue={filters.competitorId ?? ''}
                className="field-input mt-2"
              >
                <option value="">Any competitor context</option>
                {competitors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold">
              Posted from
              <input
                name="from"
                type="date"
                defaultValue={filters.from}
                className="field-input mt-2"
              />
            </label>
            <label className="text-xs font-semibold">
              Posted through
              <input name="to" type="date" defaultValue={filters.to} className="field-input mt-2" />
            </label>
          </div>
          <p className="mt-4 text-[10px] leading-5 text-muted-foreground">
            Scores below 40 are hidden by default. Select Blocked to review hard blocks, regardless
            of their score. Freshness and engagement sort by their scored components.
          </p>
        </details>
      </form>
      {invalidFilters && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          Some filters are invalid. Choose valid dates and scores, then apply again.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'All', status: undefined },
            { label: 'Saved', status: 'saved' as const },
            { label: 'Blocked', status: 'blocked' as const },
          ].map((tab) => (
            <Link
              key={tab.label}
              href={filterHref(filters, { status: tab.status })}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${filters.status === tab.status ? 'border-primary bg-primary text-white' : 'border-border bg-white text-muted-foreground'}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-border bg-white p-1 text-xs">
            {(['cards', 'table'] as const).map((view) => (
              <Link
                key={view}
                href={filterHref(filters, { view })}
                aria-current={filters.view === view ? 'page' : undefined}
                className={`rounded-md px-3 py-1.5 ${filters.view === view ? 'bg-violet-50 font-semibold text-primary' : 'text-muted-foreground'}`}
              >
                {titleCase(view)}
              </Link>
            ))}
          </div>
          <SignalRefresh automatic />
        </div>
      </div>
      {!canAct && (
        <PermissionNotice>
          Your viewer role can research opportunities. An owner, admin, or member can save, dismiss,
          or re-evaluate them.
        </PermissionNotice>
      )}
      {canAct && items.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-white p-4">
          <label className="flex items-center gap-2 self-center text-xs">
            <input
              type="checkbox"
              checked={eligible.length === items.length}
              onChange={(event) =>
                setSelected(event.target.checked ? items.map((item) => item.id) : [])
              }
              className="accent-primary"
            />
            Select this page
          </label>
          <span className="self-center text-xs text-muted-foreground">
            {eligible.length} selected
          </span>
          <label className="min-w-40 text-xs">
            Bulk dismissal reason
            <select
              className="field-input mt-1"
              value={reason}
              onChange={(event) => setReason(dismissalReasonSchema.parse(event.target.value))}
            >
              {reasonOptions.map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || eligible.length === 0}
            onClick={() => void dismiss()}
          >
            {pending ? 'Dismissing…' : 'Dismiss selected'}
          </Button>
        </div>
      )}
      <ResultNotice result={result} />
      {items.length === 0 ? (
        <KnowledgeEmpty
          title="A quieter radar, for now."
          description="Try broader filters, or add a community and product knowledge. New monitoring queues discussions automatically; refresh while the local worker finds relevant conversations."
          href={`/app/subreddits?brandId=${filters.brandId ?? ''}`}
          action="Review monitored communities"
        />
      ) : filters.view === 'table' ? (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <caption className="sr-only">Scored opportunities</caption>
            <thead className="border-b border-border bg-muted/30 text-muted-foreground">
              <tr>
                {canAct && <th className="p-4">Select</th>}
                <th className="p-4">Conversation</th>
                <th className="p-4">Score</th>
                <th className="p-4">Intent</th>
                <th className="p-4">Risk</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  {canAct && (
                    <td className="p-4">
                      <input
                        aria-label={`Select ${item.post.title ?? 'deleted post'}`}
                        type="checkbox"
                        className="accent-primary"
                        checked={eligible.includes(item.id)}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? [...eligible, item.id]
                              : eligible.filter((id) => id !== item.id),
                          )
                        }
                      />
                    </td>
                  )}
                  <td className="max-w-md p-4">
                    <Link
                      className="font-semibold leading-6 hover:text-primary"
                      href={`/app/opportunities/${item.id}`}
                    >
                      {item.post.title ?? 'Deleted discussion'}
                    </Link>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      r/{item.subreddit.name} · {ageLabel(item.post.created_at_provider)}
                    </p>
                  </td>
                  <td className="p-4">
                    <ScoreBadge score={item.final_score} blocked={item.is_blocked} />
                  </td>
                  <td className="p-4">{titleCase(item.intent_category)}</td>
                  <td className="p-4">
                    <RiskBadge risk={item.risk_level} />
                  </td>
                  <td className="p-4">
                    {titleCase(item.opportunity_workflow_status ?? item.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {items.map((item) => (
            <article key={item.id} className="panel relative p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    {canAct && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.post.title ?? 'deleted post'}`}
                        className="accent-primary"
                        checked={eligible.includes(item.id)}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? [...eligible, item.id]
                              : eligible.filter((id) => id !== item.id),
                          )
                        }
                      />
                    )}
                    <span className="font-semibold text-primary">r/{item.subreddit.name}</span>
                    <span>· {ageLabel(item.post.created_at_provider)}</span>
                    <span>· {titleCase(item.opportunity_workflow_status ?? item.status)}</span>
                    {item.post.provider === 'mock' && <span>· Synthetic discussion</span>}
                  </div>
                  <h2 className="text-base font-semibold leading-7 tracking-tight">
                    <Link href={`/app/opportunities/${item.id}`} className="hover:text-primary">
                      {item.post.title ?? 'Deleted discussion'}
                    </Link>
                  </h2>
                </div>
                <ScoreBadge score={item.final_score} blocked={item.is_blocked} />
              </div>
              <p className="mt-4 line-clamp-3 text-xs leading-6 text-muted-foreground">
                {item.post.body ||
                  item.user_need ||
                  item.summary ||
                  'The original content was removed. This record keeps operational facts only.'}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-violet-100 bg-violet-50 px-2 py-1 text-[10px] text-primary">
                  {titleCase(item.intent_category)}
                </span>
                <RiskBadge risk={item.risk_level} />
                <span className="text-[10px] text-muted-foreground">
                  Buying intent {Math.round(item.buying_intent)}/100
                </span>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <MessageSquare size={12} />
                  {item.post.num_comments}
                </span>
              </div>
              <div className="mt-5 rounded-xl border border-border bg-muted/25 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Why it matches
                </p>
                <p className="mt-2 text-xs leading-6">
                  {item.reasoning_summary || 'Content removed by the provider.'}
                </p>
                {item.matched_competitor_ids.length > 0 && (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Competitor context:{' '}
                    {item.matched_competitor_ids
                      .map(
                        (id) =>
                          competitors.find((competitor) => competitor.id === id)?.name ??
                          'Referenced competitor',
                      )
                      .join(', ')}
                  </p>
                )}
              </div>
              {item.is_blocked && (
                <p className="mt-4 flex gap-2 text-xs leading-6 text-red-800">
                  <ShieldAlert size={15} className="mt-1 shrink-0" />
                  {item.risk_reasons[0] ?? 'This discussion is not actionable.'}
                </p>
              )}
              <div className="mt-5 border-t border-border pt-4">
                <OpportunityActions
                  item={item}
                  organizationId={organizationId}
                  canAct={canAct}
                  compact
                />
                <Link
                  className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-primary"
                  href={`/app/opportunities/${item.id}`}
                >
                  Explore the signal <ArrowRight size={14} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>{items.length} opportunities on this page</p>
        {nextCursor && (
          <Button asChild variant="outline">
            <Link href={filterHref(filters, {}, nextCursor)}>
              Next page <ArrowRight size={14} />
            </Link>
          </Button>
        )}
        {filters.cursor && (
          <Link href={filterHref(filters, {})} className="font-semibold text-primary">
            Back to first page
          </Link>
        )}
      </div>
    </div>
  );
}
const scoreParts = [
  ['semantic_relevance', 'Product relevance', 30],
  ['buying_intent', 'Buying intent', 25],
  ['freshness', 'Freshness', 15],
  ['engagement_velocity', 'Engagement', 10],
  ['rule_fit', 'Community rule fit', 10],
  ['competitor_context', 'Competitor context', 10],
] as const;
export function OpportunityWorkspace({
  item,
  rules,
  organizationId,
  canAct,
  monitoring,
  competitors = [],
}: {
  item: Opportunity;
  rules: CommunityRule[];
  organizationId: string;
  canAct: boolean;
  competitors?: { id: string; name: string; notes: string }[];
  monitoring: {
    internal_notes: string;
    internal_interpretation: string;
    allowed_reply_style: string;
  } | null;
}) {
  const original = safeExternal(item.post.permalink);
  return (
    <div className="space-y-6">
      <Link
        href={`/app/opportunities?brandId=${item.brand_id}`}
        className="inline-flex items-center gap-2 text-xs font-semibold text-primary"
      >
        ← Back to opportunities
      </Link>
      <section className="panel p-6 sm:p-8">
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="eyebrow">
              r/{item.subreddit.name}
              {item.post.provider === 'mock' ? ' · Synthetic discussion' : ''}
            </p>
            <h1 className="mt-4 max-w-3xl text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {item.post.title ?? 'This discussion was deleted.'}
            </h1>
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>{displayDate(item.post.created_at_provider)}</span>
              <span>{item.post.num_comments} comments</span>
              <span>{item.post.score} post score</span>
              <span>{titleCase(item.opportunity_workflow_status ?? item.status)}</span>
              <RiskBadge risk={item.risk_level} />
            </div>
          </div>
          <ScoreBadge score={item.final_score} blocked={item.is_blocked} />
        </div>
        {item.is_blocked && (
          <p
            role="status"
            className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800"
          >
            This opportunity is blocked. Review the reasons below; saving or monitoring cannot make
            it actionable.
          </p>
        )}
        {item.post.is_deleted ? (
          <p className="mt-6 text-sm leading-7 text-muted-foreground">
            The provider removed this content. Text and derived product context have been purged.
          </p>
        ) : (
          <p className="mt-6 whitespace-pre-wrap text-sm leading-8 text-muted-foreground">
            {item.post.body}
          </p>
        )}
        {original && (
          <a
            href={original}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-primary"
          >
            Original Reddit URL{item.post.provider === 'mock' ? ' (fixture)' : ''}{' '}
            <ArrowUpRight size={14} />
          </a>
        )}
      </section>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="space-y-6">
          <section className="panel p-6">
            <p className="eyebrow">The need behind the post</p>
            <h2 className="mt-4 text-lg font-semibold leading-8">
              {item.user_need || 'Content no longer available.'}
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">{item.reasoning_summary}</p>
            <div className="mt-5 rounded-xl bg-violet-50 p-4">
              <p className="text-xs font-semibold">
                Suggested response strategy: {titleCase(item.suggested_action)}
              </p>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                {item.suggested_action === 'blocked'
                  ? 'Do not pursue this conversation. Community rules or product limitations prevent a suitable reply.'
                  : item.suggested_action === 'ignore'
                    ? 'This discussion has little product fit or buying intent. Keep attention on stronger, relevant needs.'
                    : item.suggested_action === 'monitor'
                      ? 'Follow the discussion and wait for a clearer need before deciding to participate.'
                      : 'Start by answering the question, use verified product facts, and disclose your connection if you mention the product.'}
              </p>
            </div>
          </section>
          <section className="panel p-6">
            <h2 className="text-lg font-semibold">An explainable score.</h2>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              A weighted estimate from product fit, intent, timing, conversation activity, and
              community context. Review the explanation and supporting sources.
            </p>
            <div className="mt-6 space-y-5">
              {scoreParts.map(([key, label, weight]) => (
                <div key={key}>
                  <div className="mb-2 flex justify-between gap-3 text-xs">
                    <span>
                      {label}
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        {weight}% weight
                      </span>
                    </span>
                    <span className="font-mono font-semibold">{Math.round(item[key])}/100</span>
                  </div>
                  <progress
                    max={100}
                    value={item[key]}
                    aria-label={label}
                    className="h-2 w-full accent-primary"
                  />
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-border pt-4 text-sm">
              <span>Risk penalties</span>
              <span className="font-mono font-semibold text-warning">
                −{Math.round(item.penalty_score)}
              </span>
            </div>
            <p className="mt-4 text-[10px] text-muted-foreground">
              Evaluated {displayDate(item.evaluated_at)}. A score estimates relevance; it does not
              guarantee a welcome response.
            </p>
          </section>
          <section className="panel p-6">
            <h2 className="mb-5 text-lg font-semibold">Your next step</h2>
            <OpportunityActions item={item} organizationId={organizationId} canAct={canAct} />
            <p className="mt-5 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">
              Generate a source-backed draft, then inspect its evidence and independent checks in
              the draft studio. Every final Reddit submission stays manual.
            </p>
          </section>
        </div>
        <aside className="space-y-5">
          {item.matched_competitor_ids.length > 0 && (
            <section className="panel p-5">
              <h2 className="text-sm font-semibold">Competitor context</h2>
              <div className="mt-4 space-y-3">
                {item.matched_competitor_ids.map((id) => {
                  const competitor = competitors.find((entry) => entry.id === id);
                  return (
                    <div key={id}>
                      <p className="text-xs font-semibold">
                        {competitor?.name ?? 'Referenced competitor'}
                      </p>
                      {competitor?.notes && (
                        <p className="mt-2 text-xs leading-6 text-muted-foreground">
                          {competitor.notes}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          <section className="panel p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldAlert size={17} className="text-primary" />
              Community review
            </h2>
            <RiskBadge risk={item.risk_level} />
            <div className="mt-4 space-y-3">
              {item.risk_reasons.length ? (
                item.risk_reasons.map((reason, index) => (
                  <p
                    key={index}
                    className="rounded-lg bg-amber-50 p-3 text-xs leading-6 text-amber-950"
                  >
                    {reason}
                  </p>
                ))
              ) : (
                <p className="text-xs leading-6 text-muted-foreground">
                  No additional risk flags were found by the evaluator. Review the community’s
                  current rules yourself.
                </p>
              )}
            </div>
            <div className="mt-5 space-y-4 border-t border-border pt-4">
              {rules.length ? (
                rules.map((rule) => (
                  <div key={rule.id}>
                    <h3 className="text-xs font-semibold">{rule.title}</h3>
                    <p className="mt-1 text-xs leading-6 text-muted-foreground">
                      {rule.description}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">Rules have not been refreshed yet.</p>
              )}
            </div>
            {monitoring && (
              <div className="mt-4 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">
                <p>
                  <strong>Reply guidance:</strong> {titleCase(monitoring.allowed_reply_style)}
                </p>
                {monitoring.internal_interpretation && (
                  <p className="mt-2">
                    <strong>Team interpretation:</strong> {monitoring.internal_interpretation}
                  </p>
                )}
                {monitoring.internal_notes && (
                  <p className="mt-2">
                    <strong>Team notes:</strong> {monitoring.internal_notes}
                  </p>
                )}
              </div>
            )}
            <p className="mt-4 text-[10px] text-muted-foreground">
              Rules refreshed {displayDate(rules[0]?.last_synced_at ?? null)}
            </p>
          </section>
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Product fit & gaps</h2>
            <ul className="mt-4 space-y-2">
              {item.matched_capabilities.map((value, index) => (
                <li
                  key={index}
                  className="rounded-lg bg-emerald-50 p-3 text-xs leading-6 text-emerald-900"
                >
                  ✓ {value}
                </li>
              ))}
              {item.missing_capabilities.map((value, index) => (
                <li
                  key={index}
                  className="rounded-lg bg-amber-50 p-3 text-xs leading-6 text-amber-950"
                >
                  Gap: {value}
                </li>
              ))}
            </ul>
            {!item.matched_capabilities.length && !item.missing_capabilities.length && (
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                No product capability context is available.
              </p>
            )}
          </section>
          <section className="panel p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Radio size={16} className="text-primary" />
              Supporting knowledge
            </h2>
            <div className="mt-4 space-y-4">
              {item.knowledge_citations.map((citation) => (
                <div key={citation.chunk_id} className="rounded-xl border border-border p-4">
                  <p className="text-xs font-semibold">{citation.title}</p>
                  <blockquote className="mt-2 text-xs leading-6 text-muted-foreground">
                    {citation.excerpt}
                  </blockquote>
                  <Link
                    href={`/app/knowledge/${citation.source_id}`}
                    className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-primary"
                  >
                    Review source <ArrowRight size={12} />
                  </Link>
                </div>
              ))}
              {item.knowledge_citations.length === 0 && (
                <p className="text-xs leading-6 text-muted-foreground">
                  No verified knowledge citations are attached to this evaluation.
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
