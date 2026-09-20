'use client';
import { useState } from 'react';
import { Clock3 } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { activityPageSchema, type ActivityPage } from '@/lib/phase8/contracts';
import { knowledgeRequest, requestMessage } from '../phase2/api';
import { ResultNotice } from '../phase1/primitives';
import type { ActionResult } from '../phase1/types';
export function ActivityFeed({
  initial,
  organizationId,
}: {
  initial: ActivityPage;
  organizationId: string;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  async function load(next = false) {
    setBusy(true);
    setResult(null);
    const query = new URLSearchParams({ organizationId });
    if (next && data.next_cursor) {
      query.set('before', data.next_cursor.created_at);
      query.set('beforeId', data.next_cursor.id);
    }
    try {
      setData(await knowledgeRequest(`/api/activity?${query}`, activityPageSchema));
    } catch (error) {
      setResult({ status: 'error', message: requestMessage(error) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="font-semibold">Workspace history</h2>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>
          Refresh activity
        </Button>
      </div>
      <ResultNotice result={result} />
      {!data.items.length ? (
        <p className="py-8 text-sm text-muted-foreground">
          Important workspace actions will appear here.
        </p>
      ) : (
        <ol className="divide-y divide-border">
          {data.items.map((item) => (
            <li key={item.id} className="flex gap-4 py-5">
              <div className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-primary">
                <Clock3 size={16} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="break-words text-sm font-semibold capitalize">
                  {item.action.replaceAll(/[._]/g, ' ')}
                </h3>
                <p className="mt-1 text-xs capitalize text-muted-foreground">
                  {item.target_type.replaceAll('_', ' ')} ·{' '}
                  {item.actor_type === 'system' ? 'Background process' : 'Workspace member'}
                </p>
                <time
                  dateTime={item.created_at}
                  className="mt-2 block text-xs text-muted-foreground"
                >
                  {new Intl.DateTimeFormat('en', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'UTC',
                  }).format(new Date(item.created_at))}{' '}
                  UTC
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
      {data.next_cursor && (
        <Button variant="outline" disabled={busy} onClick={() => void load(true)}>
          Older activity
        </Button>
      )}
    </section>
  );
}
