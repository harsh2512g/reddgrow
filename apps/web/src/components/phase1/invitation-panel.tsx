'use client';

import { unstable_rethrow } from 'next/navigation';

import { useState } from 'react';
import { ArrowRight, Copy, Check, Users } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { ResultNotice } from './primitives';
import type { ActionResult, FormAction } from './types';

export function InvitationLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
      <p className="text-sm font-semibold">Your invitation is ready.</p>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">
        Email delivery is in console mode. Share this private, email-bound link with the invited
        teammate. It is shown only after creation.
      </p>
      <Button
        type="button"
        className="mt-3"
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setError(false);
          } catch {
            setError(true);
          }
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? 'Invitation link copied' : 'Copy invitation link'}
      </Button>
      <p className="sr-only" role="status">
        {copied ? 'Invitation link copied to clipboard.' : ''}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-700">
          Clipboard access is unavailable. You can select and copy the link below.
        </p>
      )}
      {error && (
        <input
          readOnly
          aria-label="Private invitation link"
          value={url}
          className="field-input mt-3"
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </div>
  );
}

export function InvitationPanel({
  action,
  message = 'Accept your invitation to join this organization. You must be signed in with the email address the invitation was sent to.',
}: {
  action: FormAction;
  message?: string;
}) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <section className="panel mx-auto max-w-xl p-7 sm:p-10">
      <span className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-violet-50 text-primary">
        <Users size={26} />
      </span>
      <p className="eyebrow">Better, together</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">You’re invited.</h1>
      <p className="mb-6 mt-4 text-sm leading-7 text-muted-foreground">{message}</p>
      <ResultNotice result={result} />
      <form
        className="mt-6"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          try {
            setResult(await action(new FormData()));
          } catch (error) {
            unstable_rethrow(error);
            setResult({
              status: 'error',
              message:
                'This invitation could not be accepted. It may have expired or belong to a different email address.',
            });
          } finally {
            setPending(false);
          }
        }}
      >
        <Button type="submit" disabled={pending}>
          {pending ? 'Joining workspace…' : 'Accept invitation'}
          <ArrowRight size={16} />
        </Button>
      </form>
    </section>
  );
}
