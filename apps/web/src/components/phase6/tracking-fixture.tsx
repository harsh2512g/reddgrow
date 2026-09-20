'use client';

import { useRef, useState } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { ArrowLeft, Check, FlaskConical, ShieldCheck, ShoppingBag, UserPlus } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import type { ThreadSignalSnippet, TrackResult } from '@threadsignal/tracking';

export function TrackingFixture({
  brandId,
  attributionDays,
  apiOrigin,
}: {
  brandId: string;
  attributionDays: number;
  apiOrigin: string;
}) {
  const [ready, setReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Loading the local browser tracking script…');
  const [purchased, setPurchased] = useState(false);
  const client = useRef<ThreadSignalSnippet | null>(null);
  const identity = useRef('');
  function initialize() {
    if (client.current) return;
    const value: unknown = Reflect.get(window, 'threadSignal');
    if (
      !value ||
      typeof value !== 'object' ||
      !('init' in value) ||
      typeof value.init !== 'function'
    ) {
      setMessage('The tracking script could not be initialized. Reload the page to retry.');
      return;
    }
    const snippet = value as ThreadSignalSnippet;
    try {
      snippet.init({
        brandId,
        endpoint: `${apiOrigin}/api/v1/browser-events`,
        consent: false,
        cookieDays: attributionDays,
      });
      identity.current = crypto.randomUUID();
      client.current = snippet;
      setReady(true);
      setMessage(
        'No conversion event has been sent. Grant consent before recording a demo action.',
      );
    } catch {
      setMessage('The tracking configuration was refused. Reopen a valid local tracking link.');
    }
  }
  function setPermission(granted: boolean) {
    const accepted = client.current?.setConsent(granted) ?? false;
    setConsent(accepted);
    setMessage(
      !granted
        ? 'Consent withdrawn. Browser event requests have stopped.'
        : accepted
          ? 'Consent granted for this local demo. Choose an action to record.'
          : 'Tracking is disabled by a browser privacy signal. No conversion will be sent.',
    );
  }
  function resultMessage(result: TrackResult, event: 'signup' | 'purchase') {
    const name = event === 'signup' ? 'signup' : 'USD 99 purchase';
    if (result.status === 'sent') return `Demo ${name} recorded.`;
    if (result.status === 'duplicate')
      return `This demo ${name} was already recorded. No duplicate was added.`;
    if (result.reason === 'no_attribution')
      return 'No valid tracked click is available. Open this page through an active tracking link first.';
    if (result.reason === 'consent_required' || result.reason === 'privacy_signal')
      return 'Consent or a browser privacy signal prevented this event. Nothing was recorded.';
    return 'The demo event could not be recorded. Check your plan and local services, then retry.';
  }
  async function record(event: 'signup' | 'purchase') {
    if (!consent || busy || !client.current) return;
    setBusy(true);
    try {
      const result = await client.current.track(event, {
        externalId: `local-${event}-${identity.current}`,
        value: event === 'purchase' ? 99 : 0,
        currency: 'USD',
      });
      setMessage(resultMessage(result, event));
      if (event === 'purchase' && ['sent', 'duplicate'].includes(result.status)) setPurchased(true);
    } catch {
      setMessage('The demo event could not be recorded. Retry when the local app is available.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-5 py-10 sm:px-8 sm:py-16">
      <Script
        src="/threadsignal.js"
        strategy="afterInteractive"
        onReady={initialize}
        onError={() =>
          setMessage('The local tracking script failed to load. Reload the page to retry.')
        }
      />
      <Link
        href="/app/tracking"
        className="inline-flex items-center gap-2 text-xs font-semibold text-primary"
      >
        <ArrowLeft size={14} /> Back to ThreadSignal
      </Link>
      <section className="relative mt-8 overflow-hidden rounded-[28px] border border-violet-200 bg-[#f1eef9] p-7 sm:p-10">
        <div
          aria-hidden="true"
          className="absolute -right-20 -top-20 size-72 rounded-full border-[35px] border-white/45"
        />
        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-white/75 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
            <FlaskConical size={13} /> Local synthetic storefront
          </span>
          <h1 className="mt-6 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
            ClarityScale AI demo
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
            Practice attribution with an explicit signup and a USD 99 purchase. These are synthetic
            development events; no account is created, no payment is charged, and no Reddit action
            occurs.
          </p>
        </div>
      </section>
      <section className="panel mt-6 p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck size={18} className="text-primary" /> Your consent comes first
        </h2>
        <label className="mt-5 flex items-start gap-3 rounded-xl border border-border p-4 text-sm leading-7">
          <input
            type="checkbox"
            checked={consent}
            disabled={!ready || busy}
            onChange={(event) => setPermission(event.target.checked)}
            className="mt-2 accent-primary"
          />
          Allow this local demo to attribute this visit and its demo conversion events.
        </label>
        <p className="mt-3 text-xs leading-6 text-muted-foreground">
          Consent allows a first-party attribution cookie for up to {attributionDays} days. You can
          withdraw it here. No conversion is sent merely by loading this page.
        </p>
        <p
          role="status"
          aria-live="polite"
          className="mt-5 rounded-xl bg-violet-50 p-4 text-xs leading-6 text-primary"
        >
          {message}
        </p>
      </section>
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <section className="panel p-6">
          <UserPlus size={22} className="text-primary" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold">A new signup</h2>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            Record one synthetic signup attached to this tracked visit.
          </p>
          <Button
            type="button"
            disabled={!consent || busy}
            className="mt-5 w-full"
            onClick={() => void record('signup')}
          >
            Record demo signup
          </Button>
        </section>
        <section className="panel p-6">
          <ShoppingBag size={22} className="text-primary" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold">A USD 99 purchase</h2>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            Record a synthetic purchase. Repeating it reuses the same event identity.
          </p>
          <Button
            type="button"
            disabled={!consent || busy}
            className="mt-5 w-full"
            onClick={() => void record('purchase')}
          >
            Record demo purchase
          </Button>
          {purchased && (
            <Button
              type="button"
              disabled={!consent || busy}
              className="mt-2 w-full"
              variant="outline"
              onClick={() => void record('purchase')}
            >
              <Check size={14} />
              Repeat the same demo purchase
            </Button>
          )}
        </section>
      </div>
      <p className="mt-7 text-center text-[11px] leading-6 text-muted-foreground">
        This fixture sends events to your local Supabase-backed ThreadSignal application. It uses
        the same browser snippet and API as the product workflow.
      </p>
    </main>
  );
}
