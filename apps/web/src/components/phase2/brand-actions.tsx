'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, RotateCcw } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { ResultNotice } from '../phase1/primitives';
import type { ActionResult } from '../phase1/types';
import { knowledgeRequest, mutationSchema, requestMessage } from './api';
import type { Brand } from './types';

export function BrandArchiveAction({ brand }: { brand: Brand }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const archived = brand.status === 'archived';
  return (
    <section className="panel mt-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">
            {archived ? 'Bring this brand back into focus.' : 'Keep your studio focused.'}
          </h2>
          <p className="mt-2 max-w-xl text-xs leading-6 text-muted-foreground">
            {archived
              ? 'Restoring a brand counts toward your plan’s active brand limit.'
              : 'Archive a product you are no longer working on. Its profile and knowledge stay available to your team.'}
          </p>
        </div>
        <Button variant="outline" type="button" disabled={pending} onClick={() => setConfirm(true)}>
          {archived ? <RotateCcw size={15} /> : <Archive size={15} />}
          {archived ? 'Restore brand' : 'Archive brand'}
        </Button>
      </div>
      {confirm && (
        <div
          className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4"
          role="group"
          aria-label="Confirm brand status change"
        >
          <p className="text-sm font-medium text-warning">
            {archived
              ? `Restore “${brand.name}” as an active brand?`
              : `Archive “${brand.name}” and pause new knowledge additions?`}
          </p>
          <div className="mt-4 flex gap-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                setResult(null);
                try {
                  await knowledgeRequest(`/api/brands/${brand.id}`, mutationSchema, {
                    method: 'PATCH',
                    body: JSON.stringify({ archived: !archived }),
                  });
                  setConfirm(false);
                  setResult({
                    status: 'success',
                    message: archived
                      ? 'Brand restored.'
                      : 'Brand archived. Its existing knowledge is preserved.',
                  });
                  router.refresh();
                } catch (error) {
                  setResult({ status: 'error', message: requestMessage(error) });
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? 'Saving…' : archived ? 'Confirm restore' : 'Confirm archive'}
            </Button>
          </div>
        </div>
      )}
      <div className="mt-4">
        <ResultNotice result={result} />
      </div>
    </section>
  );
}
