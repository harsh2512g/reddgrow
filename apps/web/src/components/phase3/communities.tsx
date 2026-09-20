'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { communitySettingsSchema } from '@threadsignal/opportunities';
import { Button } from '@threadsignal/ui';
import { Search, Plus, ShieldCheck, Radio } from 'lucide-react';
import { signalRequest, signalMessage, actionResponseSchema } from '@/lib/phase3/client';
import type { Monitoring, CommunityRule } from '@/lib/phase3/schema';
import type { ActionResult } from '../phase1/types';
import { ResultNotice, PermissionNotice } from '../phase1/primitives';
import { RiskBadge, SignalAction, SignalRefresh } from './primitives';
import { displayDate, KnowledgeEmpty } from '../phase2/primitives';
const searchSchema = z.object({
  communities: z.array(
    z.object({
      name: z.string(),
      displayTitle: z.string(),
      description: z.string(),
      isNsfw: z.boolean(),
      reason: z.string().optional(),
    }),
  ),
});
export function CommunityStudio({
  brandId,
  organizationId,
  canManage,
  communities,
  rules,
}: {
  brandId: string;
  organizationId: string;
  canManage: boolean;
  communities: Monitoring[];
  rules: CommunityRule[];
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<z.infer<typeof searchSchema>['communities'] | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<ActionResult | null>(null);
  const router = useRouter();
  async function search(value = query, suggested = false) {
    setPending(true);
    setNotice(null);
    try {
      setResults(
        (
          await signalRequest(
            suggested
              ? `/api/brands/${brandId}/subreddits/suggest`
              : `/api/subreddits/search?q=${encodeURIComponent(value)}`,
            searchSchema,
            suggested ? organizationId : undefined,
            suggested ? { method: 'POST' } : undefined,
          )
        ).communities,
      );
    } catch (error) {
      setNotice({ status: 'error', message: signalMessage(error) });
    } finally {
      setPending(false);
    }
  }
  async function add(name: string) {
    setPending(true);
    setNotice(null);
    try {
      await signalRequest(
        `/api/brands/${brandId}/subreddits`,
        actionResponseSchema,
        organizationId,
        { method: 'POST', body: JSON.stringify({ name, settings: {} }) },
      );
      setNotice({
        status: 'success',
        message: `r/${name.replace(/^r\//i, '')} added. Rules and discussions are queued for review.`,
      });
      router.refresh();
    } catch (error) {
      setNotice({ status: 'error', message: signalMessage(error) });
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-6">
      {!canManage && <PermissionNotice />}
      {canManage && (
        <section className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Find your next community</h2>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                Search the read-only mock provider or add a community name. Monitoring starts
                immediately, then refreshes on schedule.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                setQuery('');
                void search('', true);
              }}
            >
              Suggest communities
            </Button>
          </div>
          <form
            className="mt-5 flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <div className="min-w-0 flex-1">
              <label className="mb-2 block text-xs font-semibold" htmlFor="community-search">
                Community name
              </label>
              <input
                id="community-search"
                className="field-input"
                placeholder="Try SaaS, webdev, or ecommerce"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={100}
              />
            </div>
            <Button type="submit" disabled={pending}>
              <Search size={15} />
              {pending ? 'Searching…' : 'Search communities'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !query.trim()}
              onClick={() => void add(query)}
            >
              Add by name
            </Button>
          </form>
          {results && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {results.length === 0 ? (
                <p role="status" className="text-sm text-muted-foreground">
                  No matching mock communities. Try a broader name.
                </p>
              ) : (
                results.map((community) => (
                  <div key={community.name} className="rounded-xl border border-border p-4">
                    <p className="text-sm font-semibold">r/{community.name}</p>
                    <p className="mt-1 text-xs leading-6 text-muted-foreground">
                      {community.displayTitle}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {community.description}
                    </p>
                    {community.reason && (
                      <p className="mt-3 rounded-lg bg-violet-50 p-3 text-xs leading-6 text-primary">
                        <strong>Mock AI suggestion:</strong> {community.reason}
                      </p>
                    )}
                    <Button
                      className="mt-3"
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        pending ||
                        community.isNsfw ||
                        communities.some(
                          (item) =>
                            item.subreddit.name.toLowerCase() === community.name.toLowerCase(),
                        )
                      }
                      onClick={() => void add(community.name)}
                    >
                      <Plus size={13} />
                      {community.isNsfw ? 'NSFW blocked' : 'Monitor community'}
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
          <div className="mt-4">
            <ResultNotice result={notice} />
          </div>
        </section>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">
          {communities.length} monitored {communities.length === 1 ? 'community' : 'communities'}{' '}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {communities.filter((item) => item.status === 'active').length} active
          </span>
        </p>
        <SignalRefresh automatic />
      </div>
      {communities.length === 0 ? (
        <KnowledgeEmpty
          title="Make room for useful conversations."
          description="Add a community to start gathering discussions and its rules. Your product context determines which conversations matter."
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {communities.map((community) => (
            <CommunityCard
              key={community.id}
              item={community}
              rules={rules.filter((rule) => rule.subreddit_id === community.subreddit_id)}
              organizationId={organizationId}
              canManage={canManage}
            />
          ))}
        </div>
      )}
      <p className="flex gap-2 text-xs leading-6 text-muted-foreground">
        <ShieldCheck className="mt-1 shrink-0" size={15} />
        Rules inform review. They never guarantee moderator acceptance, and ThreadSignal never
        publishes comments.
      </p>
    </div>
  );
}
function CommunityCard({
  item,
  rules,
  organizationId,
  canManage,
}: {
  item: Monitoring;
  rules: CommunityRule[];
  organizationId: string;
  canManage: boolean;
}) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  return (
    <article className="panel overflow-hidden">
      <div className="h-1 bg-gradient-to-r from-violet-400 via-indigo-200 to-white" />
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 font-mono text-primary">
              r/
            </span>
            <div className="min-w-0">
              <h2 className="break-words text-lg font-semibold">r/{item.subreddit.name}</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {item.status === 'active' ? 'Monitoring active' : 'Monitoring paused'} · Priority{' '}
                {item.priority}/5
              </p>
            </div>
          </div>
          {item.assessment ? (
            <RiskBadge risk={item.assessment.risk_level} />
          ) : (
            <span className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground">
              Not assessed
            </span>
          )}
        </div>
        <p className="mt-4 text-xs font-semibold">{item.subreddit.display_name}</p>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          {item.subreddit.description || 'The provider is fetching this community’s metadata.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          <span>Minimum score {item.minimum_score}</span>
          {item.assessment && (
            <span>
              Recent product fit {item.assessment.product_relevance}/100 · {item.assessment.count}{' '}
              assessed
            </span>
          )}
          <span>
            {item.subreddit.subscriber_count === null
              ? 'Audience unavailable'
              : `${item.subreddit.subscriber_count.toLocaleString()} synthetic subscribers`}
          </span>
          <span>{item.subreddit.is_nsfw ? 'NSFW · blocked' : 'NSFW: No'}</span>
          <span>Rule guidance: {item.allowed_reply_style.replaceAll('_', ' ')}</span>
        </div>
        <p className="mt-3 text-[10px] text-muted-foreground">
          Last sync: {displayDate(item.subreddit.last_synced_at)}
        </p>
        {item.sync?.failed && (
          <p
            role="status"
            className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-950"
          >
            {item.sync.paused
              ? 'The provider is paused after repeated authorization failures. Monitoring resumes only after the connection is repaired.'
              : 'The last sync could not finish. The worker will retry; use Sync now to request another attempt.'}
          </p>
        )}
        {item.sync && item.status === 'active' && !item.sync.paused && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Next scheduled check: {displayDate(item.sync.next_sync_at)}
          </p>
        )}
        <details className="mt-5 rounded-xl border border-border bg-muted/20 p-4">
          <summary className="cursor-pointer text-xs font-semibold">
            Community rules · {rules.length}
          </summary>
          <div className="mt-4 space-y-4">
            {rules.length === 0 ? (
              <p className="text-xs leading-6 text-muted-foreground">
                Rules are queued. Refresh this view after processing; review current rules before
                replying.
              </p>
            ) : (
              rules.map((rule) => (
                <div key={rule.id}>
                  <h3 className="text-xs font-semibold">{rule.title}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                    {rule.description}
                  </p>
                </div>
              ))
            )}
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground">
            Rules refreshed: {displayDate(rules[0]?.last_synced_at ?? null)}
          </p>
        </details>
        {canManage ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-semibold text-primary">
              Monitoring preferences & notes
            </summary>
            <form
              className="mt-4 space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const parsed = communitySettingsSchema.safeParse({
                  status: item.status,
                  priority: Number(data.get('priority')),
                  minimum_score: Number(data.get('minimum_score')),
                  allowed_reply_style: data.get('allowed_reply_style'),
                  internal_notes: data.get('internal_notes'),
                  internal_interpretation: data.get('internal_interpretation'),
                  monitor_new: data.get('monitor_new') === 'on',
                  monitor_hot: data.get('monitor_hot') === 'on',
                  monitor_rising: data.get('monitor_rising') === 'on',
                });
                if (
                  !parsed.success ||
                  !['monitor_new', 'monitor_hot', 'monitor_rising'].some(
                    (key) => data.get(key) === 'on',
                  )
                ) {
                  setResult({
                    status: 'error',
                    message: 'Use a valid priority, score, and at least one monitoring sort.',
                  });
                  return;
                }
                setPending(true);
                try {
                  await signalRequest(
                    `/api/brand-subreddits/${item.id}`,
                    actionResponseSchema,
                    organizationId,
                    { method: 'PATCH', body: JSON.stringify(parsed.data) },
                  );
                  setResult({ status: 'success', message: 'Monitoring preferences saved.' });
                  router.refresh();
                } catch (error) {
                  setResult({ status: 'error', message: signalMessage(error) });
                } finally {
                  setPending(false);
                }
              }}
            >
              <fieldset disabled={pending} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-semibold">
                    Priority
                    <input
                      aria-label={`Priority for ${item.subreddit.name}`}
                      name="priority"
                      type="number"
                      min={1}
                      max={5}
                      defaultValue={item.priority}
                      className="field-input mt-2"
                    />
                  </label>
                  <label className="text-xs font-semibold">
                    Minimum score
                    <input
                      name="minimum_score"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={item.minimum_score}
                      className="field-input mt-2"
                    />
                  </label>
                </div>
                <label className="block text-xs font-semibold">
                  Reply guidance
                  <select
                    name="allowed_reply_style"
                    defaultValue={item.allowed_reply_style}
                    className="field-input mt-2"
                  >
                    <option value="helpful">Helpful answer</option>
                    <option value="technical">Technical detail</option>
                    <option value="no_links">No links</option>
                    <option value="answer_only">Answer only</option>
                  </select>
                </label>
                <fieldset>
                  <legend className="mb-2 text-xs font-semibold">Monitor discussion sorts</legend>
                  <div className="flex flex-wrap gap-4">
                    {(['new', 'hot', 'rising'] as const).map((sort) => (
                      <label className="flex items-center gap-2 text-xs capitalize" key={sort}>
                        <input
                          type="checkbox"
                          name={`monitor_${sort}`}
                          defaultChecked={item[`monitor_${sort}`]}
                          className="accent-primary"
                        />
                        {sort}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="block text-xs font-semibold">
                  Internal notes
                  <textarea
                    name="internal_notes"
                    defaultValue={item.internal_notes}
                    maxLength={2000}
                    rows={3}
                    className="field-input mt-2"
                  />
                </label>
                <label className="block text-xs font-semibold">
                  Your interpretation of the rules
                  <textarea
                    name="internal_interpretation"
                    defaultValue={item.internal_interpretation}
                    maxLength={2000}
                    rows={3}
                    className="field-input mt-2"
                  />
                </label>
                <Button type="submit" size="sm">
                  {pending ? 'Saving…' : 'Save preferences'}
                </Button>
              </fieldset>
              <ResultNotice result={result} />
            </form>
          </details>
        ) : (
          <div className="mt-4 space-y-3 text-xs leading-6 text-muted-foreground">
            {item.internal_notes && (
              <p>
                <strong>Team notes:</strong> {item.internal_notes}
              </p>
            )}
            {item.internal_interpretation && (
              <p>
                <strong>Team interpretation:</strong> {item.internal_interpretation}
              </p>
            )}
          </div>
        )}
        {canManage && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            <SignalAction
              path={`/api/brand-subreddits/${item.id}`}
              method="PATCH"
              body={{ status: item.status === 'active' ? 'paused' : 'active' }}
              organizationId={organizationId}
            >
              {item.status === 'active' ? 'Pause' : 'Resume'}
            </SignalAction>
            <SignalAction
              path={`/api/brand-subreddits/${item.id}/refresh`}
              body={{ kind: 'sync' }}
              organizationId={organizationId}
            >
              <Radio size={13} />
              Sync now
            </SignalAction>
            <SignalAction
              path={`/api/brand-subreddits/${item.id}/refresh-rules`}
              organizationId={organizationId}
            >
              Refresh rules
            </SignalAction>
            <SignalAction
              path={`/api/brand-subreddits/${item.id}`}
              method="DELETE"
              organizationId={organizationId}
              confirm="Remove monitoring for this community? Existing opportunities remain in your workspace."
            >
              Remove
            </SignalAction>
          </div>
        )}
      </div>
    </article>
  );
}
